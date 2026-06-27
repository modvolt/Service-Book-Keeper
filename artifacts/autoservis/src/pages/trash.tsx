import { useQueryClient } from "@tanstack/react-query";
import {
  useListTrash,
  getListTrashQueryKey,
  useRestoreTrashItem,
  usePurgeTrashItem,
} from "@workspace/api-client-react";
import type { TrashItem } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Trash2, RotateCcw } from "lucide-react";
import { entityLabel, formatDateTime } from "@/lib/audit-labels";
import { getApiErrorMessage } from "@/lib/api-error";

export default function TrashPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useListTrash();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListTrashQueryKey() });
  };

  const restore = useRestoreTrashItem();
  const purge = usePurgeTrashItem();

  const handleRestore = async (item: TrashItem, cascade = false) => {
    try {
      const result = await restore.mutateAsync({
        entity: item.entity,
        id: item.id,
        data: { cascade },
      });
      const restoredCount = result.restoredCount ?? 0;
      toast({
        title: "Obnoveno",
        description:
          cascade && restoredCount > 0
            ? `${entityLabel(item.entity)} „${item.label}" obnoven(a) včetně ${restoredCount} souvisejících záznamů.`
            : `${entityLabel(item.entity)} „${item.label}" byl(a) obnoven(a).`,
      });
      invalidate();
    } catch (err) {
      toast({
        title: "Chyba",
        description: getApiErrorMessage(err, "Obnovení se nezdařilo."),
        variant: "destructive",
      });
    }
  };

  const handlePurge = async (item: TrashItem) => {
    try {
      await purge.mutateAsync({ entity: item.entity, id: item.id });
      toast({ title: "Trvale smazáno", description: `${entityLabel(item.entity)} „${item.label}" byl(a) trvale smazán(a).` });
      invalidate();
    } catch {
      toast({ title: "Chyba", description: "Trvalé smazání se nezdařilo.", variant: "destructive" });
    }
  };

  const items = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Trash2 className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Koš / Obnova</h1>
          <p className="text-sm text-muted-foreground">
            Smazané záznamy lze obnovit, nebo je trvale odstranit. Trvalé smazání nelze vrátit zpět.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Smazané záznamy</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Načítání…
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Koš je prázdný.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">Typ</TableHead>
                    <TableHead>Záznam</TableHead>
                    <TableHead className="w-44">Smazáno</TableHead>
                    <TableHead>Důvod</TableHead>
                    <TableHead className="text-right w-40">Akce</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={`${item.entity}-${item.id}`}>
                      <TableCell>
                        <Badge variant="secondary">{entityLabel(item.entity)}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{item.label}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDateTime(item.deletedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.deleteReason || "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {item.childCount && item.childCount > 0 ? (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={restore.isPending}
                                  title="Obnovit"
                                  className="text-emerald-600 dark:text-emerald-400"
                                >
                                  <RotateCcw className="h-4 w-4 mr-1" /> Obnovit
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Obnovit i související záznamy?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {entityLabel(item.entity)} „{item.label}" má v koši {item.childCount}{" "}
                                    souvisejících záznamů (zakázky, servisní záznamy, fotky…). Můžete obnovit
                                    pouze tento záznam, nebo jej obnovit i se souvisejícími záznamy.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter className="sm:justify-between">
                                  <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                  <div className="flex gap-2">
                                    <AlertDialogAction
                                      className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
                                      onClick={() => handleRestore(item, false)}
                                    >
                                      Pouze tento záznam
                                    </AlertDialogAction>
                                    <AlertDialogAction onClick={() => handleRestore(item, true)}>
                                      Obnovit vše ({item.childCount})
                                    </AlertDialogAction>
                                  </div>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRestore(item)}
                              disabled={restore.isPending}
                              title="Obnovit"
                              className="text-emerald-600 dark:text-emerald-400"
                            >
                              <RotateCcw className="h-4 w-4 mr-1" /> Obnovit
                            </Button>
                          )}

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Trvale smazat"
                                className="text-rose-600 dark:text-rose-400"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Trvale smazat tento záznam?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {entityLabel(item.entity)} „{item.label}" bude trvale odstraněn(a) i se souvisejícími
                                  záznamy. Tuto akci nelze vrátit zpět.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-rose-600 hover:bg-rose-700"
                                  onClick={() => handlePurge(item)}
                                >
                                  Trvale smazat
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
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
