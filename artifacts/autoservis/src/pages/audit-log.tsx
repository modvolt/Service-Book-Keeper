import { Fragment, useMemo, useState } from "react";
import { useListAuditLog } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, ScrollText } from "lucide-react";
import { AUDIT_ACTIONS } from "@workspace/audit-actions";
import { ACTION_LABELS, ENTITY_LABELS, actionLabel, entityLabel, formatDateTime, formatSnapshot } from "@/lib/audit-labels";

const ACTOR_LABELS: Record<string, string> = {
  admin: "Správce",
  scanner: "Skener",
  system: "Systém",
};

function actorLabel(actor: string | null | undefined): string {
  if (!actor) return "—";
  return ACTOR_LABELS[actor] ?? actor;
}

const ALL = "__all__";

export default function AuditLogPage() {
  const [entity, setEntity] = useState<string>(ALL);
  const [action, setAction] = useState<string>(ALL);
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [openId, setOpenId] = useState<number | null>(null);

  // Translate the date-only inputs into an inclusive ISO range.
  const params = useMemo(() => {
    const p: { entity?: string; action?: string; from?: string; to?: string; limit: number } = { limit: 300 };
    if (entity !== ALL) p.entity = entity;
    if (action !== ALL) p.action = action;
    if (from) p.from = new Date(`${from}T00:00:00`).toISOString();
    if (to) p.to = new Date(`${to}T23:59:59.999`).toISOString();
    return p;
  }, [entity, action, from, to]);

  const { data, isLoading } = useListAuditLog(params);

  const reset = () => {
    setEntity(ALL);
    setAction(ALL);
    setFrom("");
    setTo("");
  };

  const rows = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ScrollText className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Záznam o činnostech</h1>
          <p className="text-sm text-muted-foreground">
            Úplná historie změn napříč aplikací s možností filtrování.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtr</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
            <div className="space-y-1.5">
              <Label>Typ záznamu</Label>
              <Select value={entity} onValueChange={setEntity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Vše</SelectItem>
                  {Object.entries(ENTITY_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Akce</Label>
              <Select value={action} onValueChange={setAction}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Vše</SelectItem>
                  {AUDIT_ACTIONS.map((code) => (
                    <SelectItem key={code} value={code}>
                      {ACTION_LABELS[code]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from">Od</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">Do</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <Button variant="outline" onClick={reset}>
              Zrušit filtr
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Záznamy</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Načítání…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné záznamy.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">Čas</TableHead>
                    <TableHead>Akce</TableHead>
                    <TableHead>Typ</TableHead>
                    <TableHead>Kdo</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead className="w-28 text-right">Data</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((entry) => {
                    const snapshot = formatSnapshot(entry.snapshot);
                    const open = openId === entry.id;
                    return (
                      <Fragment key={entry.id}>
                        <TableRow>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {formatDateTime(entry.createdAt)}
                          </TableCell>
                          <TableCell>{actionLabel(entry.action)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{entityLabel(entry.entity)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{actorLabel(entry.actor)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{entry.detail || "—"}</TableCell>
                          <TableCell className="text-right">
                            {snapshot ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2"
                                onClick={() => setOpenId(open ? null : entry.id)}
                              >
                                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                <span className="ml-1">{open ? "Skrýt" : "Zobrazit"}</span>
                              </Button>
                            ) : (
                              <span className="text-sm text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                        {open && snapshot ? (
                          <TableRow>
                            <TableCell colSpan={6} className="bg-muted/40">
                              <p className="mb-1 text-xs font-medium text-muted-foreground">Stav před změnou</p>
                              <pre className="max-h-80 overflow-auto rounded-md bg-background p-3 text-xs">{snapshot}</pre>
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
