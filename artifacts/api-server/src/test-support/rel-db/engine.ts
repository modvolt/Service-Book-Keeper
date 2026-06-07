/**
 * A small relational in-memory stand-in for `@workspace/db` used by the loaner /
 * work-order / GDPR tests. Unlike the singleton `fake-db`, this engine actually
 * evaluates `where` predicates, supports `leftJoin` (with table aliases) and
 * `.returning()`, so it can faithfully exercise filter logic, overlap windows
 * and the work-order paid auto-close coupling.
 *
 * Only the subset of the Drizzle query-builder surface these routes use is
 * implemented: select (+ joins, where, orderBy, limit, count(*) aggregate),
 * insert (+ returning), update (+ returning), delete (+ returning) and a
 * pass-through transaction. The matching operator factories (`eq`, `and`, ...)
 * and `alias` live here too so the AST they produce is understood by the engine.
 */

type Row = Record<string, unknown>;

let instanceSeq = 0;

export interface ColumnRef {
  readonly __col: true;
  readonly __ownerId: number;
  readonly __tableKey: string;
  readonly __name: string;
}

export interface TableInstance {
  readonly __tableKey: string;
  readonly __ownerId: number;
  readonly [column: string]: unknown;
}

function makeTable(tableKey: string, columns: readonly string[]): TableInstance {
  const ownerId = instanceSeq++;
  const t: Record<string, unknown> = { __tableKey: tableKey, __ownerId: ownerId };
  for (const name of columns) {
    const ref: ColumnRef = { __col: true, __ownerId: ownerId, __tableKey: tableKey, __name: name };
    t[name] = ref;
  }
  return t as TableInstance;
}

/** Create a distinct alias of a table that shares the same underlying rows. */
export function alias(table: TableInstance, _name: string): TableInstance {
  const cols = Object.keys(table).filter((k) => k !== "__tableKey" && k !== "__ownerId");
  return makeTable(table.__tableKey, cols);
}

// ---------------------------------------------------------------------------
// Operator AST
// ---------------------------------------------------------------------------

type Pred =
  | { t: "cmp"; op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; a: unknown; b: unknown }
  | { t: "null"; col: unknown; neg: boolean }
  | { t: "and"; xs: (Pred | undefined)[] }
  | { t: "or"; xs: (Pred | undefined)[] }
  | { t: "in"; col: unknown; arr: unknown[] }
  | { t: "ilike"; col: unknown; pattern: string };

interface OrderSpec {
  t: "order";
  col: ColumnRef;
  dir: "asc" | "desc";
}

interface SqlMarker {
  __sql: true;
  text: string;
}

function isColumn(x: unknown): x is ColumnRef {
  return typeof x === "object" && x !== null && (x as { __col?: boolean }).__col === true;
}

function isSql(x: unknown): x is SqlMarker {
  return typeof x === "object" && x !== null && (x as { __sql?: boolean }).__sql === true;
}

export const eq = (a: unknown, b: unknown): Pred => ({ t: "cmp", op: "eq", a, b });
export const ne = (a: unknown, b: unknown): Pred => ({ t: "cmp", op: "ne", a, b });
export const gt = (a: unknown, b: unknown): Pred => ({ t: "cmp", op: "gt", a, b });
export const gte = (a: unknown, b: unknown): Pred => ({ t: "cmp", op: "gte", a, b });
export const lt = (a: unknown, b: unknown): Pred => ({ t: "cmp", op: "lt", a, b });
export const lte = (a: unknown, b: unknown): Pred => ({ t: "cmp", op: "lte", a, b });
export const isNull = (col: unknown): Pred => ({ t: "null", col, neg: false });
export const isNotNull = (col: unknown): Pred => ({ t: "null", col, neg: true });
export const and = (...xs: (Pred | undefined)[]): Pred => ({ t: "and", xs });
export const or = (...xs: (Pred | undefined)[]): Pred => ({ t: "or", xs });
export const inArray = (col: unknown, arr: unknown[]): Pred => ({ t: "in", col, arr });
export const ilike = (col: unknown, pattern: string): Pred => ({ t: "ilike", col, pattern });
export const asc = (col: ColumnRef): OrderSpec => ({ t: "order", col, dir: "asc" });
export const desc = (col: ColumnRef): OrderSpec => ({ t: "order", col, dir: "desc" });

export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlMarker {
  return { __sql: true, text: strings.join(" ") + " " + values.join(" ") };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

class Store {
  private data = new Map<string, Row[]>();
  private nextId = new Map<string, number>();

  rows(tableKey: string): Row[] {
    let arr = this.data.get(tableKey);
    if (!arr) {
      arr = [];
      this.data.set(tableKey, arr);
    }
    return arr;
  }

  allocId(tableKey: string): number {
    const next = (this.nextId.get(tableKey) ?? 0) + 1;
    this.nextId.set(tableKey, next);
    return next;
  }

  reset(): void {
    this.data.clear();
    this.nextId.clear();
  }
}

export const __store = new Store();

/** Seed rows directly, keeping the id sequence ahead of any explicit ids. */
export function seed(table: TableInstance, rows: Row[]): void {
  const arr = __store.rows(table.__tableKey);
  for (const r of rows) {
    arr.push(r);
    if (typeof r.id === "number") {
      // Bump the sequence so future inserts don't collide.
      while (__store.allocId(table.__tableKey) <= r.id) {
        /* advance */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

type Namespace = Map<number, Row | null>;

function resolve(x: unknown, ns: Namespace): unknown {
  if (isColumn(x)) {
    const row = ns.get(x.__ownerId);
    return row == null ? null : row[x.__name];
  }
  return x;
}

function compare(a: unknown, b: unknown): number {
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function likeToRegExp(pattern: string): RegExp {
  let out = "";
  for (const ch of pattern) {
    if (ch === "%") out += ".*";
    else if (ch === "_") out += ".";
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`, "i");
}

function evalPred(pred: Pred | undefined, ns: Namespace): boolean {
  if (!pred) return true;
  switch (pred.t) {
    case "cmp": {
      const a = resolve(pred.a, ns);
      const b = resolve(pred.b, ns);
      const c = compare(a, b);
      switch (pred.op) {
        case "eq": return c === 0;
        case "ne": return c !== 0;
        case "gt": return c > 0;
        case "gte": return c >= 0;
        case "lt": return c < 0;
        case "lte": return c <= 0;
      }
      return false;
    }
    case "null": {
      const v = resolve(pred.col, ns);
      const nul = v == null;
      return pred.neg ? !nul : nul;
    }
    case "and":
      return pred.xs.every((x) => evalPred(x, ns));
    case "or":
      return pred.xs.some((x) => evalPred(x, ns));
    case "in": {
      const v = resolve(pred.col, ns);
      return pred.arr.some((x) => compare(v, x) === 0);
    }
    case "ilike": {
      const v = resolve(pred.col, ns);
      if (v == null) return false;
      return likeToRegExp(pred.pattern).test(String(v));
    }
  }
}

// ---------------------------------------------------------------------------
// Query builders
// ---------------------------------------------------------------------------

interface Join {
  table: TableInstance;
  on: Pred;
}

type SelectShape = "*" | Record<string, ColumnRef | SqlMarker>;

class SelectBuilder {
  private joins: Join[] = [];
  private whereP: Pred | undefined;
  private orders: OrderSpec[] = [];
  private limitN: number | undefined;

  constructor(private shape: SelectShape, private base: TableInstance) {}

  leftJoin(table: TableInstance, on: Pred): this {
    this.joins.push({ table, on });
    return this;
  }

  where(pred: Pred | undefined): this {
    this.whereP = pred;
    return this;
  }

  orderBy(...specs: (OrderSpec | ColumnRef | SqlMarker)[]): this {
    for (const s of specs) {
      if (isColumn(s)) this.orders.push({ t: "order", col: s, dir: "asc" });
      else if ((s as OrderSpec).t === "order") this.orders.push(s as OrderSpec);
      // SqlMarker order-bys are ignored (not exercised by the tested routes).
    }
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  private run(): Row[] {
    let namespaces: Namespace[] = __store.rows(this.base.__tableKey).map((row) => {
      const ns: Namespace = new Map();
      ns.set(this.base.__ownerId, row);
      return ns;
    });

    for (const join of this.joins) {
      const next: Namespace[] = [];
      for (const ns of namespaces) {
        const matches = __store
          .rows(join.table.__tableKey)
          .filter((r) => {
            const probe = new Map(ns);
            probe.set(join.table.__ownerId, r);
            return evalPred(join.on, probe);
          });
        if (matches.length === 0) {
          const left = new Map(ns);
          left.set(join.table.__ownerId, null);
          next.push(left);
        } else {
          for (const m of matches) {
            const joined = new Map(ns);
            joined.set(join.table.__ownerId, m);
            next.push(joined);
          }
        }
      }
      namespaces = next;
    }

    namespaces = namespaces.filter((ns) => evalPred(this.whereP, ns));

    if (this.orders.length) {
      namespaces.sort((x, y) => {
        for (const o of this.orders) {
          const c = compare(resolve(o.col, x), resolve(o.col, y));
          if (c !== 0) return o.dir === "asc" ? c : -c;
        }
        return 0;
      });
    }

    if (this.limitN != null) namespaces = namespaces.slice(0, this.limitN);

    if (this.shape === "*") {
      // Return the live base-table row references so later updates are visible.
      return namespaces.map((ns) => ns.get(this.base.__ownerId) as Row);
    }

    const shape = this.shape;
    const aggKey = Object.keys(shape).find((k) => {
      const v = shape[k];
      return isSql(v) && /count\s*\(\s*\*\s*\)/i.test(v.text);
    });
    if (aggKey) {
      return [{ [aggKey]: namespaces.length }];
    }

    return namespaces.map((ns) => {
      const out: Row = {};
      for (const [key, col] of Object.entries(shape)) {
        out[key] = isColumn(col) ? resolve(col, ns) : null;
      }
      return out;
    });
  }

  private settle(): Promise<Row[]> {
    return Promise.resolve(this.run());
  }

  then<TR1 = Row[], TR2 = never>(
    onF?: ((v: Row[]) => TR1 | PromiseLike<TR1>) | null,
    onR?: ((e: unknown) => TR2 | PromiseLike<TR2>) | null,
  ): Promise<TR1 | TR2> {
    return this.settle().then(onF, onR);
  }
}

class InsertBuilder {
  constructor(private table: TableInstance) {}

  values(vals: Row | Row[]) {
    const list = Array.isArray(vals) ? vals : [vals];
    const table = this.table;
    const insert = (): Row[] => {
      const inserted: Row[] = [];
      for (const v of list) {
        const row: Row = { ...v };
        if (row.id == null) row.id = __store.allocId(table.__tableKey);
        if (row.createdAt == null) row.createdAt = new Date();
        __store.rows(table.__tableKey).push(row);
        inserted.push(row);
      }
      return inserted;
    };
    return {
      returning: (): Promise<Row[]> => Promise.resolve(insert()),
      then<TR1 = undefined, TR2 = never>(
        onF?: ((v: undefined) => TR1 | PromiseLike<TR1>) | null,
        onR?: ((e: unknown) => TR2 | PromiseLike<TR2>) | null,
      ): Promise<TR1 | TR2> {
        insert();
        return Promise.resolve(undefined).then(onF, onR);
      },
    };
  }
}

class UpdateBuilder {
  private vals: Row = {};
  constructor(private table: TableInstance) {}

  set(vals: Row): this {
    this.vals = vals;
    return this;
  }

  where(pred: Pred | undefined) {
    const table = this.table;
    const vals = this.vals;
    const apply = (): Row[] => {
      const matched: Row[] = [];
      for (const row of __store.rows(table.__tableKey)) {
        const ns: Namespace = new Map([[table.__ownerId, row]]);
        if (evalPred(pred, ns)) {
          Object.assign(row, vals);
          matched.push(row);
        }
      }
      return matched;
    };
    return {
      returning: (): Promise<Row[]> => Promise.resolve(apply()),
      then<TR1 = undefined, TR2 = never>(
        onF?: ((v: undefined) => TR1 | PromiseLike<TR1>) | null,
        onR?: ((e: unknown) => TR2 | PromiseLike<TR2>) | null,
      ): Promise<TR1 | TR2> {
        apply();
        return Promise.resolve(undefined).then(onF, onR);
      },
    };
  }
}

class DeleteBuilder {
  constructor(private table: TableInstance) {}

  where(pred: Pred | undefined) {
    const table = this.table;
    const apply = (): Row[] => {
      const arr = __store.rows(table.__tableKey);
      const removed: Row[] = [];
      for (let i = arr.length - 1; i >= 0; i--) {
        const ns: Namespace = new Map([[table.__ownerId, arr[i]]]);
        if (evalPred(pred, ns)) {
          removed.unshift(arr[i]);
          arr.splice(i, 1);
        }
      }
      return removed;
    };
    return {
      returning: (): Promise<Row[]> => Promise.resolve(apply()),
      then<TR1 = undefined, TR2 = never>(
        onF?: ((v: undefined) => TR1 | PromiseLike<TR1>) | null,
        onR?: ((e: unknown) => TR2 | PromiseLike<TR2>) | null,
      ): Promise<TR1 | TR2> {
        apply();
        return Promise.resolve(undefined).then(onF, onR);
      },
    };
  }
}

interface MemDb {
  select(shape?: Record<string, ColumnRef | SqlMarker>): { from(table: TableInstance): SelectBuilder };
  insert(table: TableInstance): InsertBuilder;
  update(table: TableInstance): UpdateBuilder;
  delete(table: TableInstance): DeleteBuilder;
  transaction<T>(fn: (tx: MemDb) => Promise<T>): Promise<T>;
}

export const db: MemDb = {
  select(shape?: Record<string, ColumnRef | SqlMarker>) {
    return {
      from(table: TableInstance) {
        return new SelectBuilder(shape ?? "*", table);
      },
    };
  },
  insert(table: TableInstance) {
    return new InsertBuilder(table);
  },
  update(table: TableInstance) {
    return new UpdateBuilder(table);
  },
  delete(table: TableInstance) {
    return new DeleteBuilder(table);
  },
  async transaction<T>(fn: (tx: typeof db) => Promise<T>): Promise<T> {
    return fn(db);
  },
};

// ---------------------------------------------------------------------------
// Table definitions (only the columns the tested routes touch)
// ---------------------------------------------------------------------------

export const loanersTable = makeTable("loaners", [
  "id", "fleetVehicleId", "workOrderId", "customerVehicleId", "customerName",
  "customerPhone", "startDate", "endDate", "manualEndDate", "status", "note",
  "createdAt",
]);

export const vehiclesTable = makeTable("vehicles", [
  "id", "licensePlate", "make", "model", "isFleet", "ownerType", "ownerName",
  "ownerAddress", "ownerPhone", "ownerEmail", "ownerIco", "ownerDic",
  "consentGivenAt", "consentNote", "currentKm",
]);

export const workOrdersTable = makeTable("work_orders", [
  "id", "vehicleId", "licensePlate", "status", "paid", "completedAt",
  "serviceDate", "createdAt", "description",
]);

export const photosTable = makeTable("photos", ["id", "workOrderId", "url"]);

export const serviceRecordsTable = makeTable("service_records", ["id", "vehicleId"]);

export const appointmentsTable = makeTable("appointments", [
  "id", "vehicleId", "customerName", "customerPhone",
]);

export const auditLogTable = makeTable("audit_log", [
  "id", "action", "entity", "entityId", "detail", "createdAt",
]);

export const customerReminderLogTable = makeTable("customer_reminder_log", [
  "id", "vehicleId",
]);
