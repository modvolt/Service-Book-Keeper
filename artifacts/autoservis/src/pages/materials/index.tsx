import { useState } from "react";
import {
  useListMaterials, useCreateMaterial, useDeleteMaterial, useUpdateMaterial,
  getListMaterialsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Package, Plus, Search, Trash2, Pencil, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/api-error";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { MaterialsImportDialog } from "@/components/materials-import-dialog";

type MaterialItem = {
  id: number;
  name: string;
  productNumber?: string | null;
  unit?: string | null;
  defaultPrice?: number | null;
  supplier?: string | null;
  askQuantityOnScan?: boolean;
};

type EditState = {
  id: number;
  name: string;
  productNumber: string;
  unit: string;
  defaultPrice: string;
  askQuantityOnScan: boolean;
};

export default function MaterialsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [productNumber, setProductNumber] = useState("");
  const [unit, setUnit] = useState("");
  const [defaultPrice, setDefaultPrice] = useState("");
  const [askQuantityOnScan, setAskQuantityOnScan] = useState(false);
  const [editState, setEditState] = useState<EditState | null>(null);

  const { data: items = [], isLoading } = useListMaterials({ search: search || undefined });
  const createMutation = useCreateMaterial();
  const updateMutation = useUpdateMaterial();
  const deleteMutation = useDeleteMaterial();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListMaterialsQueryKey() });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate({
      data: {
        name: name.trim(),
        productNumber: productNumber.trim() || null,
        unit: unit.trim() || null,
        defaultPrice: defaultPrice ? parseInt(defaultPrice, 10) : null,
        askQuantityOnScan,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Materiál přidán" });
        setName(""); setProductNumber(""); setUnit(""); setDefaultPrice(""); setAskQuantityOnScan(false);
        invalidate();
      },
      onError: (err) => {
        toast({ title: "Chyba", description: getApiErrorMessage(err, "Materiál se nepodařilo přidat (možná již existuje)."), variant: "destructive" });
      }
    });
  }

  function handleDelete(id: number) {
    deleteMutation.mutate({ id }, {
      onSuccess: () => { toast({ title: "Smazáno" }); invalidate(); },
      onError: (err) => toast({ title: "Chyba", description: getApiErrorMessage(err, "Materiál se nepodařilo smazat."), variant: "destructive" }),
    });
  }

  function startEdit(it: MaterialItem) {
    setEditState({
      id: it.id,
      name: it.name,
      productNumber: it.productNumber ?? "",
      unit: it.unit ?? "",
      defaultPrice: it.defaultPrice != null ? String(it.defaultPrice) : "",
      askQuantityOnScan: it.askQuantityOnScan ?? false,
    });
  }

  function cancelEdit() {
    setEditState(null);
  }

  function handleSaveEdit() {
    if (!editState || !editState.name.trim()) return;
    updateMutation.mutate({
      id: editState.id,
      data: {
        name: editState.name.trim(),
        productNumber: editState.productNumber.trim() || null,
        unit: editState.unit.trim() || null,
        defaultPrice: editState.defaultPrice ? parseInt(editState.defaultPrice, 10) : null,
        askQuantityOnScan: editState.askQuantityOnScan,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Materiál uložen" });
        setEditState(null);
        invalidate();
      },
      onError: (err) => {
        toast({ title: "Chyba", description: getApiErrorMessage(err, "Materiál se nepodařilo uložit (možná již existuje)."), variant: "destructive" });
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Package className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Sklad / katalog materiálu</h1>
            <p className="text-muted-foreground">Často používaný materiál a díly. Položky se nabízí při zápisu zakázek.</p>
          </div>
        </div>
        <MaterialsImportDialog />
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader><CardTitle>Přidat materiál</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="space-y-1">
                <Label>Název *</Label>
                <Input placeholder="Olejový filtr Mann W712" value={name} onChange={e => setName(e.target.value)} required />
              </div>
              <div className="space-y-1">
                <Label>Číslo produktu</Label>
                <Input placeholder="Např. W712/52" value={productNumber} onChange={e => setProductNumber(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Jednotka</Label>
                  <Input placeholder="ks, l, kg" value={unit} onChange={e => setUnit(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Cena (Kč)</Label>
                  <Input type="number" placeholder="450" value={defaultPrice} onChange={e => setDefaultPrice(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2">
                <div>
                  <p className="text-sm font-medium">Ptát se na množství při skenování</p>
                  <p className="text-xs text-muted-foreground">Při QR skenu zobrazí pole pro zadání množství</p>
                </div>
                <Switch
                  checked={askQuantityOnScan}
                  onCheckedChange={setAskQuantityOnScan}
                  aria-label="Ptát se na množství při skenování"
                />
              </div>
              <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                <Plus className="h-4 w-4 mr-2" />Přidat do skladu
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle>Položky ({items.length})</CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input className="pl-9" placeholder="Hledat..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                {[1,2,3].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded" />)}
              </div>
            ) : items.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground border-2 border-dashed rounded-lg">
                <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Žádné položky.</p>
              </div>
            ) : (
              <div className="divide-y border rounded-lg">
                {items.map(it => (
                  <div key={it.id}>
                    {editState?.id === it.id ? (
                      /* ── Inline edit form ── */
                      <div className="px-4 py-3 space-y-3 bg-muted/30">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="col-span-2 space-y-1">
                            <Label className="text-xs">Název *</Label>
                            <Input
                              value={editState.name}
                              onChange={e => setEditState(s => s ? { ...s, name: e.target.value } : s)}
                              className="h-8 text-sm"
                              autoFocus
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Č. produktu</Label>
                            <Input
                              value={editState.productNumber}
                              onChange={e => setEditState(s => s ? { ...s, productNumber: e.target.value } : s)}
                              className="h-8 text-sm"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Jednotka</Label>
                            <Input
                              value={editState.unit}
                              onChange={e => setEditState(s => s ? { ...s, unit: e.target.value } : s)}
                              className="h-8 text-sm"
                              placeholder="ks, l, kg"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Cena (Kč)</Label>
                            <Input
                              type="number"
                              value={editState.defaultPrice}
                              onChange={e => setEditState(s => s ? { ...s, defaultPrice: e.target.value } : s)}
                              className="h-8 text-sm"
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 bg-background">
                          <p className="text-sm">Ptát se na množství při skenování</p>
                          <Switch
                            checked={editState.askQuantityOnScan}
                            onCheckedChange={v => setEditState(s => s ? { ...s, askQuantityOnScan: v } : s)}
                          />
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="flex-1"
                            onClick={handleSaveEdit}
                            disabled={updateMutation.isPending || !editState.name.trim()}
                          >
                            <Check className="h-3.5 w-3.5 mr-1.5" />Uložit
                          </Button>
                          <Button size="sm" variant="outline" onClick={cancelEdit} disabled={updateMutation.isPending}>
                            <X className="h-3.5 w-3.5 mr-1.5" />Zrušit
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* ── Normal row ── */
                      <div className="flex items-center justify-between gap-4 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">{it.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {it.productNumber ? `Č. produktu: ${it.productNumber}` : "Bez čísla produktu"}
                            {it.unit && ` · ${it.unit}`}
                            {it.defaultPrice != null && ` · ${it.defaultPrice.toLocaleString("cs-CZ")} Kč`}
                            {it.supplier && ` · ${it.supplier}`}
                            {it.askQuantityOnScan && ` · ptát se na množství`}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" onClick={() => startEdit(it)} title="Upravit">
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon"><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Smazat materiál?</AlertDialogTitle>
                                <AlertDialogDescription>"{it.name}" bude odebrán z katalogu. Materiály již použité na zakázkách zůstanou zachovány.</AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(it.id)}>Smazat</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
