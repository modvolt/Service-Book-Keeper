import { useState, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useCreateVehicle, useImportVehicleFromTp, getListVehiclesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, Sparkles, Upload, X, Loader2, Camera } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function NewVehicle() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createVehicle = useCreateVehicle();
  const importFromTp = useImportVehicleFromTp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    licensePlate: "", make: "", model: "", year: "", color: "", vin: "",
    engineDisplacement: "", registrationDate: "",
    ownerName: "", ownerAddress: "",
    currentKm: "", notes: "", stkValidUntil: "",
    lastOilChangeKm: "", lastOilChangeDate: "", lastBrakesDate: "", lastTimingDate: ""
  });

  const [importOpen, setImportOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createVehicle.mutate({
      data: {
        licensePlate: form.licensePlate.toUpperCase().trim(),
        make: form.make,
        model: form.model,
        year: form.year ? parseInt(form.year) : null,
        color: form.color || null,
        vin: form.vin || null,
        engineDisplacement: form.engineDisplacement ? parseInt(form.engineDisplacement) : null,
        registrationDate: form.registrationDate || null,
        ownerName: form.ownerName || null,
        ownerAddress: form.ownerAddress || null,
        currentKm: form.currentKm ? parseInt(form.currentKm) : null,
        notes: form.notes || null,
        stkValidUntil: form.stkValidUntil || null,
        lastOilChangeKm: form.lastOilChangeKm ? parseInt(form.lastOilChangeKm) : null,
        lastOilChangeDate: form.lastOilChangeDate || null,
        lastBrakesDate: form.lastBrakesDate || null,
        lastTimingDate: form.lastTimingDate || null,
      }
    }, {
      onSuccess: (vehicle) => {
        queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
        toast({ title: "Vozidlo přidáno" });
        navigate(`/vehicles/${vehicle.id}`);
      },
      onError: () => {
        toast({ title: "Chyba", description: "Vozidlo se nepodařilo přidat.", variant: "destructive" });
      }
    });
  }

  function handleAddFiles(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files).slice(0, 4 - importFiles.length);
    setImportFiles((prev) => [...prev, ...list].slice(0, 4));
  }

  async function handleImport() {
    if (importFiles.length === 0) return;
    try {
      const images = await Promise.all(importFiles.map(fileToBase64));
      importFromTp.mutate({ data: { images } }, {
        onSuccess: (result) => {
          setForm((f) => ({
            ...f,
            licensePlate: result.licensePlate ?? f.licensePlate,
            make: result.make ?? f.make,
            model: result.model ?? f.model,
            year: result.year != null ? String(result.year) : f.year,
            color: result.color ?? f.color,
            vin: result.vin ?? f.vin,
            engineDisplacement: result.engineDisplacement != null ? String(result.engineDisplacement) : f.engineDisplacement,
            registrationDate: result.registrationDate ?? f.registrationDate,
            ownerName: result.ownerName ?? f.ownerName,
            ownerAddress: result.ownerAddress ?? f.ownerAddress,
          }));
          setImportOpen(false);
          setImportFiles([]);
          toast({ title: "Údaje načteny", description: "Zkontrolujte prosím vyplněné údaje." });
        },
        onError: () => {
          toast({ title: "Import selhal", description: "Zkuste znovu nebo vyplňte ručně.", variant: "destructive" });
        }
      });
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se načíst soubor.", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/vehicles">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Nové vozidlo</h1>
          <p className="text-muted-foreground">Přidejte nové vozidlo do evidence.</p>
        </div>
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <Sparkles className="h-4 w-4 mr-2" />Importovat z TP
        </Button>
      </div>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>Údaje o vozidle</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Vlastník</h3>
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-1">
                  <Label>Jméno vlastníka / provozovatele</Label>
                  <Input placeholder="Jan Novák" value={form.ownerName} onChange={e => setForm(f => ({ ...f, ownerName: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Adresa</Label>
                  <Input placeholder="Lubočinka 251, 251 68" value={form.ownerAddress} onChange={e => setForm(f => ({ ...f, ownerAddress: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Vozidlo</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1 col-span-2">
                  <Label>SPZ *</Label>
                  <Input
                    placeholder="1A2 3456"
                    value={form.licensePlate}
                    onChange={e => setForm(f => ({ ...f, licensePlate: e.target.value }))}
                    required
                    className="font-mono uppercase"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Výrobce *</Label>
                  <Input placeholder="Škoda" value={form.make} onChange={e => setForm(f => ({ ...f, make: e.target.value }))} required />
                </div>
                <div className="space-y-1">
                  <Label>Model / typ *</Label>
                  <Input placeholder="Octavia" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} required />
                </div>
                <div className="space-y-1">
                  <Label>Rok výroby</Label>
                  <Input type="number" placeholder="2018" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Barva</Label>
                  <Input placeholder="Bílá" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>VIN</Label>
                  <Input placeholder="VF3XCRHGA..." value={form.vin} onChange={e => setForm(f => ({ ...f, vin: e.target.value }))} className="font-mono" />
                </div>
                <div className="space-y-1">
                  <Label>Objem motoru (cm³)</Label>
                  <Input type="number" placeholder="1997" value={form.engineDisplacement} onChange={e => setForm(f => ({ ...f, engineDisplacement: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Datum první registrace</Label>
                  <Input type="date" value={form.registrationDate} onChange={e => setForm(f => ({ ...f, registrationDate: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Provoz a servis</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Aktuální km</Label>
                  <Input type="number" placeholder="85000" value={form.currentKm} onChange={e => setForm(f => ({ ...f, currentKm: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>STK platná do</Label>
                  <Input type="date" value={form.stkValidUntil} onChange={e => setForm(f => ({ ...f, stkValidUntil: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Datum výměny oleje</Label>
                  <Input type="date" value={form.lastOilChangeDate} onChange={e => setForm(f => ({ ...f, lastOilChangeDate: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Km při výměně oleje</Label>
                  <Input type="number" value={form.lastOilChangeKm} onChange={e => setForm(f => ({ ...f, lastOilChangeKm: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Datum servisu brzd</Label>
                  <Input type="date" value={form.lastBrakesDate} onChange={e => setForm(f => ({ ...f, lastBrakesDate: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Datum servisu rozvodů</Label>
                  <Input type="date" value={form.lastTimingDate} onChange={e => setForm(f => ({ ...f, lastTimingDate: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Poznámky</Label>
              <Textarea placeholder="Libovolné poznámky k vozidlu..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Link href="/vehicles"><Button type="button" variant="outline">Zrušit</Button></Link>
              <Button type="submit" disabled={createVehicle.isPending}>Přidat vozidlo</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) setImportFiles([]); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-amber-500" />Import z technického průkazu</DialogTitle>
            <DialogDescription>
              Nahrajte fotografie malého technického průkazu (obě strany). Údaje se automaticky vyplní do formuláře.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { handleAddFiles(e.target.files); e.target.value = ""; }}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => { if (fileInputRef.current) { fileInputRef.current.removeAttribute("capture"); fileInputRef.current.click(); } }}
                disabled={importFiles.length >= 4 || importFromTp.isPending}
              >
                <Upload className="h-4 w-4 mr-2" />Vybrat soubor
              </Button>
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => { if (fileInputRef.current) { fileInputRef.current.setAttribute("capture", "environment"); fileInputRef.current.click(); } }}
                disabled={importFiles.length >= 4 || importFromTp.isPending}
              >
                <Camera className="h-4 w-4 mr-2" />Fotit
              </Button>
            </div>

            {importFiles.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {importFiles.map((f, i) => (
                  <div key={i} className="relative aspect-video rounded-lg border bg-muted overflow-hidden">
                    <img src={URL.createObjectURL(f)} alt={f.name} className="w-full h-full object-cover" />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute top-1 right-1 h-6 w-6"
                      onClick={() => setImportFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      disabled={importFromTp.isPending}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Můžete nahrát až 4 fotografie. Doporučujeme přední i zadní stranu TP pro lepší výsledek.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setImportOpen(false)} disabled={importFromTp.isPending}>Zrušit</Button>
            <Button type="button" onClick={handleImport} disabled={importFiles.length === 0 || importFromTp.isPending}>
              {importFromTp.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Zpracovávám...</> : <><Sparkles className="h-4 w-4 mr-2" />Načíst údaje</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
