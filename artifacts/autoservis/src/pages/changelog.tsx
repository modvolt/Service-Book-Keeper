import { useState } from "react";
import {
  useListLogbookEntries,
  useCreateLogbookEntry,
  useUpdateLogbookEntry,
  useDeleteLogbookEntry,
  getListLogbookEntriesQueryKey,
  type LogbookEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { History, Plus, Pencil, Trash2, Loader2, NotebookPen } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { cs } from "date-fns/locale";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmtDate(d: string): string {
  try { return format(parseISO(d), "d. M. yyyy", { locale: cs }); } catch { return d; }
}

export default function ChangelogPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: entries, isLoading } = useListLogbookEntries();
  const createEntry = useCreateLogbookEntry();
  const updateEntry = useUpdateLogbookEntry();
  const deleteEntry = useDeleteLogbookEntry();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<LogbookEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<LogbookEntry | null>(null);
  const [form, setForm] = useState({ entryDate: todayIso(), title: "", content: "" });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListLogbookEntriesQueryKey() });

  function openNew() {
    setEditing(null);
    setForm({ entryDate: todayIso(), title: "", content: "" });
    setDialogOpen(true);
  }

  function openEdit(entry: LogbookEntry) {
    setEditing(entry);
    setForm({ entryDate: entry.entryDate, title: entry.title, content: entry.content ?? "" });
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.entryDate) return;
    const body = {
      entryDate: form.entryDate,
      title: form.title.trim(),
      content: form.content.trim() || null,
    };

    if (editing) {
      updateEntry.mutate({ id: editing.id, data: body }, {
        onSuccess: () => { invalidate(); setDialogOpen(false); toast({ title: "Záznam upraven" }); },
        onError: () => toast({ title: "Chyba", description: "Záznam se nepodařilo upravit.", variant: "destructive" }),
      });
    } else {
      createEntry.mutate({ data: body }, {
        onSuccess: () => { invalidate(); setDialogOpen(false); toast({ title: "Záznam přidán" }); },
        onError: () => toast({ title: "Chyba", description: "Záznam se nepodařilo přidat.", variant: "destructive" }),
      });
    }
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteEntry.mutate({ id: deleteTarget.id }, {
      onSuccess: () => { invalidate(); setDeleteTarget(null); toast({ title: "Záznam smazán" }); },
      onError: () => toast({ title: "Chyba", description: "Záznam se nepodařilo smazat.", variant: "destructive" }),
    });
  }

  const saving = createEntry.isPending || updateEntry.isPending;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <History className="h-6 w-6" /> Záznam změn
          </h1>
          <p className="text-muted-foreground">Deník provozu a změn. Zapisujte si, co se ve firmě nebo v aplikaci událo.</p>
        </div>
        <Button onClick={openNew}>
          <Plus className="h-4 w-4 mr-2" />Nový záznam
        </Button>
      </div>

      {isLoading ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Načítání…</CardContent></Card>
      ) : !entries || entries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <NotebookPen className="h-12 w-12 text-muted-foreground mx-auto opacity-40" />
            <p className="text-muted-foreground">Zatím tu nejsou žádné záznamy.</p>
            <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Přidat první záznam</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <Card key={entry.id} className="group">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs font-medium rounded-full bg-primary/10 text-primary px-2.5 py-0.5">
                        {fmtDate(entry.entryDate)}
                      </span>
                      <h3 className="font-semibold">{entry.title}</h3>
                    </div>
                    {entry.content && (
                      <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{entry.content}</p>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(entry)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(entry)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>{editing ? "Upravit záznam" : "Nový záznam"}</DialogTitle>
              <DialogDescription>
                Zapište datum, krátký název a podrobnosti záznamu.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1">
                <Label>Datum *</Label>
                <Input
                  type="date"
                  value={form.entryDate}
                  onChange={(e) => setForm((f) => ({ ...f, entryDate: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Název *</Label>
                <Input
                  placeholder="Stručný název záznamu"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label>Popis</Label>
                <Textarea
                  placeholder="Podrobnosti…"
                  rows={5}
                  value={form.content}
                  onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>Zrušit</Button>
              <Button type="submit" disabled={saving || !form.title.trim() || !form.entryDate}>
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Ukládám…</> : (editing ? "Uložit změny" : "Přidat záznam")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat záznam?</AlertDialogTitle>
            <AlertDialogDescription>
              Záznam „{deleteTarget?.title}" bude trvale odstraněn. Tuto akci nelze vrátit zpět.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteEntry.isPending}>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); confirmDelete(); }} disabled={deleteEntry.isPending}>
              {deleteEntry.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Mažu…</> : "Smazat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
