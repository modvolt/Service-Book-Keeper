import { useListAuditLog } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { History } from "lucide-react";
import { actionLabel, formatDateTime } from "@/lib/audit-labels";

const ACTOR_LABELS: Record<string, string> = {
  admin: "Správce",
  scanner: "Skener",
  system: "Systém",
};

function actorLabel(actor: string | null | undefined): string {
  if (!actor) return "—";
  return ACTOR_LABELS[actor] ?? actor;
}

/**
 * "Historie změn" panel — audit entries scoped to a single entity row. Shown on
 * the vehicle detail and work-order detail pages.
 */
export function ChangeHistory({ entity, entityId }: { entity: string; entityId: number }) {
  const { data, isLoading } = useListAuditLog({ entity, entityId: String(entityId), limit: 100 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          Historie změn
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Načítání…
          </div>
        ) : (data?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">Žádné záznamy.</p>
        ) : (
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">Čas</TableHead>
                  <TableHead>Akce</TableHead>
                  <TableHead>Kdo</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                      {formatDateTime(entry.createdAt)}
                    </TableCell>
                    <TableCell>{actionLabel(entry.action)}</TableCell>
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
  );
}
