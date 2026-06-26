import { Fragment, useState } from "react";
import { useListAuditLog } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { actionLabel, formatDateTime, formatSnapshot } from "@/lib/audit-labels";

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
  const [openId, setOpenId] = useState<number | null>(null);

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
                  <TableHead className="w-28 text-right">Data</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.map((entry) => {
                  const snapshot = formatSnapshot(entry.snapshot);
                  const open = openId === entry.id;
                  return (
                    <Fragment key={entry.id}>
                      <TableRow>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {formatDateTime(entry.createdAt)}
                        </TableCell>
                        <TableCell>{actionLabel(entry.action)}</TableCell>
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
                          <TableCell colSpan={5} className="bg-muted/40">
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
  );
}
