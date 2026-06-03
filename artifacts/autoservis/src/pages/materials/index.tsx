import { useState } from "react";
import {
  useListMaterials, useCreateMaterial, useDeleteMaterial,
  getListMaterialsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Package, Plus, Search, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiErrorMessage } from "@/lib/api-error";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { MaterialsImportDialog } from "@/components/materials-import-dialog";

export default function MaterialsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [productNumber, setProductNumber] = useState("");
  const [unit, setUnit] = useState("");
  const [defaultPrice, setDefaultPrice] = useState("");

  const { data: items = [], isLoading } = useListMaterials({ search: search || undefined });
  const createMutation = useCreateMaterial();
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
      }
    }, {
      onSuccess: () => {
        toast({ title: "Materiál přidán" });
        setName(""); setProductNumber(""); setUnit(""); setDefaultPrice("");
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
                  <div key={it.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">{it.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {it.productNumber ? `Č. produktu: ${it.productNumber}` : "Bez čísla produktu"}
                        {it.unit && ` · ${it.unit}`}
                        {it.defaultPrice != null && ` · ${it.defaultPrice.toLocaleString("cs-CZ")} Kč`}
                        {it.supplier && ` · ${it.supplier}`}
                      </p>
                    </div>
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
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
