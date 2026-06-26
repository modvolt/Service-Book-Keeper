import { useMemo, useState } from "react";
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
import { ScrollText } from "lucide-react";
import { AUDIT_ACTIONS } from "@workspace/audit-actions";
import { ACTION_LABELS, ENTITY_LABELS, actionLabel, entityLabel, formatDateTime } from "@/lib/audit-labels";

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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDateTime(entry.createdAt)}
                      </TableCell>
                      <TableCell>{actionLabel(entry.action)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{entityLabel(entry.entity)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{actorLabel(entry.actor)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{entry.detail || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
