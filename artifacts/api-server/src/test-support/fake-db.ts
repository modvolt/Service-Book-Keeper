/**
 * Hermetic in-memory stand-in for `@workspace/db`, used only by the test suite
 * (never bundled into the server — nothing in `src/index.ts` imports it).
 *
 * It mimics just enough of the Drizzle query-builder surface that the auth,
 * reminders and audit modules exercise:
 *   - `db.select().from(t)` / `.where(pred)`
 *   - `db.insert(t).values(v)` (awaited) / `.onConflictDoNothing().returning()`
 *     / `.onConflictDoUpdate({ set })`
 *   - `db.update(t).set(v).where(pred)`
 *
 * `where` predicates are ignored: the tables in this app are singletons keyed by
 * `id = 1` (app_auth, settings) or read in full (vehicles), so returning the
 * whole table is equivalent for these tests. Rows are shared by reference so an
 * `update` is visible to a subsequent `select` (mirrors real DB semantics).
 */

type Row = Record<string, unknown>;

class Store {
  private data = new Map<unknown, Row[]>();

  get(table: unknown): Row[] {
    let arr = this.data.get(table);
    if (!arr) {
      arr = [];
      this.data.set(table, arr);
    }
    return arr;
  }

  reset(): void {
    this.data.clear();
  }
}

export const appAuthTable: { id: object } = { id: {} };
export const settingsTable: { id: object } = { id: {} };
export const vehiclesTable: { id: object } = { id: {} };
export const auditLogTable: { id: object } = { id: {} };
export const customerReminderLogTable: { id: object } = { id: {} };
export const workOrdersTable: { id: object } = { id: {} };
export const serviceRecordsTable: { id: object } = { id: {} };

export const __store = new Store();

interface InsertValues extends Row {
  id?: unknown;
}

function makeDb(store: Store) {
  return {
    select() {
      return {
        from(table: unknown) {
          const read = (): Row[] => store.get(table).slice();
          return {
            where(_pred?: unknown): Promise<Row[]> {
              return Promise.resolve(read());
            },
            then<T>(onF: (v: Row[]) => T, onR?: (e: unknown) => T) {
              return Promise.resolve(read()).then(onF, onR);
            },
          };
        },
      };
    },

    insert(table: unknown) {
      return {
        values(vals: InsertValues | InsertValues[]) {
          const list = Array.isArray(vals) ? vals : [vals];
          const first = list[0] ?? {};
          const insertRow = (): Row => {
            const row: Row = { ...first };
            store.get(table).push(row);
            return row;
          };
          const insertAll = (): void => {
            for (const v of list) store.get(table).push({ ...v });
          };
          return {
            then<T>(onF: (v: undefined) => T, onR?: (e: unknown) => T) {
              insertAll();
              return Promise.resolve(undefined).then(onF, onR);
            },
            onConflictDoNothing() {
              // Awaitable (no .returning()) — used by batch inserts that ignore
              // the result; also exposes .returning() for single-row callers.
              return {
                then<T>(onF: (v: undefined) => T, onR?: (e: unknown) => T) {
                  insertAll();
                  return Promise.resolve(undefined).then(onF, onR);
                },
                returning: async (): Promise<Row[]> => {
                  const arr = store.get(table);
                  const existing =
                    first.id != null ? arr.find((r) => r.id === first.id) : undefined;
                  if (existing) return [];
                  return [insertRow()];
                },
              };
            },
            onConflictDoUpdate(args: { target?: unknown; set: Row }) {
              return {
                then<T>(onF: (v: undefined) => T, onR?: (e: unknown) => T) {
                  const arr = store.get(table);
                  const existing =
                    first.id != null ? arr.find((r) => r.id === first.id) : undefined;
                  if (existing) Object.assign(existing, args.set);
                  else insertRow();
                  return Promise.resolve(undefined).then(onF, onR);
                },
              };
            },
          };
        },
      };
    },

    update(table: unknown) {
      return {
        set(vals: Row) {
          return {
            where(_pred?: unknown): Promise<undefined> {
              for (const r of store.get(table)) Object.assign(r, vals);
              return Promise.resolve(undefined);
            },
          };
        },
      };
    },

    delete(table: unknown) {
      return {
        where(_pred?: unknown): Promise<undefined> {
          // Predicates are ignored (see file header); clear the whole table.
          store.get(table).length = 0;
          return Promise.resolve(undefined);
        },
      };
    },
  };
}

export const db = makeDb(__store);
