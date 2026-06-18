import { useState, useRef, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { takeVehiclePrefill } from "@/lib/scan-prefill";
import { useCreateVehicle, useImportVehicleFromTp, useListVehicleMakes, useListVehicleModels, getListVehiclesQueryKey } from "@workspace/api-client-react";
import { AutocompleteInput } from "@/components/autocomplete-input";
import { AresButton } from "@/components/ares-button";
import { fetchAres, normalizeIco } from "@/lib/ares";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FLEET_OWNER_NAME } from "@/lib/fleet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ArrowLeft, Sparkles, Upload, X, Loader2, Camera, ClipboardPaste, ShieldCheck, ScanLine, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

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

const DEFAULT_OIL_MONTHS = "12";
const DEFAULT_TRANS_KM = "60000";
const DEFAULT_TRANS_MONTHS = "48";
const DEFAULT_BRAKE_FLUID_MONTHS = "24";

export default function NewVehicle() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createVehicle = useCreateVehicle();
  const importFromTp = useImportVehicleFromTp();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    licensePlate: "", make: "", model: "", year: "", color: "", vin: "",
    engineDisplacement: "",
    transmission: "manual" as "manual" | "automatic",
    ownerType: "private" as "private" | "company",
    ownerName: "", ownerAddress: "", ownerIco: "", ownerDic: "", ownerPhone: "", ownerEmail: "",
    currentKm: "", notes: "", stkValidUntil: "",
    lastOilChangeKm: "", lastOilChangeDate: "", lastBrakesDate: "", lastTimingDate: "",
    lastTransmissionOilDate: "", lastTransmissionOilKm: "",
    lastBrakeFluidDate: "",
    oilChangeIntervalKm: "", oilChangeIntervalMonths: DEFAULT_OIL_MONTHS,
    transmissionOilIntervalKm: DEFAULT_TRANS_KM, transmissionOilIntervalMonths: DEFAULT_TRANS_MONTHS,
    brakesIntervalMonths: "", timingIntervalKm: "", timingIntervalMonths: "",
    brakeFluidIntervalMonths: DEFAULT_BRAKE_FLUID_MONTHS,
  });

  const fleetMode = new URLSearchParams(window.location.search).get("fleet") === "1";
  const isFleet = fleetMode;

  const [importOpen, setImportOpen] = useState(false);
  const [importFiles, setImportFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [ownerSource, setOwnerSource] = useState<"scan" | "ares" | null>(null);
  const [aresVerifying, setAresVerifying] = useState(false);
  // Set when the scan read one color from the TP but saw a different one on the
  // photo — surfaced as a warning next to the Barva field for the user to check.
  const [colorWarning, setColorWarning] = useState<{ tp: string; photo: string } | null>(null);
  const [aresWarning, setAresWarning] = useState<"notfound" | "error" | null>(null);

  async function autoVerifyFromAres(ico: string | null | undefined, ownerType: string | null | undefined) {
    if (ownerType !== "company") return;
    const clean = normalizeIco(ico ?? "");
    if (!/^\d{8}$/.test(clean)) return;
    setAresVerifying(true);
    setAresWarning(null);
    try {
      const result = await fetchAres(clean);
      if (result.ok) {
        setForm((f) => ({
          ...f,
          ownerName: result.data.name || f.ownerName,
          ownerAddress: result.data.address || f.ownerAddress,
          ownerDic: result.data.dic || f.ownerDic,
        }));
        setOwnerSource("ares");
        setAresWarning(null);
        toast({ title: "Údaje ověřeny v ARES", description: result.data.name });
      } else {
        setAresWarning(result.reason);
      }
    } finally {
      setAresVerifying(false);
    }
  }

  useEffect(() => {
    const pre = takeVehiclePrefill();
    if (!pre) return;
    setForm((f) => ({
      ...f,
      licensePlate: pre.licensePlate ?? f.licensePlate,
      vin: pre.vin ?? f.vin,
      year: pre.registrationYear != null ? String(pre.registrationYear) : f.year,
      engineDisplacement: pre.engineDisplacement != null ? String(pre.engineDisplacement) : f.engineDisplacement,
      make: pre.make ?? f.make,
      model: pre.model ?? f.model,
      color: pre.color ?? pre.colorObserved ?? f.color,
      currentKm: pre.currentKm != null ? String(pre.currentKm) : f.currentKm,
      ownerType: pre.ownerType === "company" || pre.ownerType === "private" ? pre.ownerType : f.ownerType,
      ownerName: pre.ownerName ?? f.ownerName,
      ownerAddress: pre.ownerAddress ?? f.ownerAddress,
      ownerIco: pre.ownerIco ?? f.ownerIco,
    }));
    if (pre.ownerName || pre.ownerAddress || pre.ownerIco) setOwnerSource("scan");
    if (pre.colorMismatch && pre.color && pre.colorObserved) setColorWarning({ tp: pre.color, photo: pre.colorObserved });
    toast({ title: "Údaje předvyplněny", description: "Zkontrolujte je a doplňte chybějící údaje." });
    void autoVerifyFromAres(pre.ownerIco, pre.ownerType);
  }, [toast]);

  const { data: makeOptions = [] } = useListVehicleMakes();
  const { data: modelOptions = [] } = useListVehicleModels(
    { make: form.make },
    { query: { enabled: form.make.trim().length > 0 } as any }
  );

  const toInt = (s: string) => s.trim() ? parseInt(s, 10) : null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const isCompany = !isFleet && form.ownerType === "company";
    createVehicle.mutate({
      data: {
        licensePlate: form.licensePlate.toUpperCase().trim(),
        make: form.make,
        model: form.model,
        year: toInt(form.year),
        color: form.color || null,
        vin: form.vin || null,
        engineDisplacement: toInt(form.engineDisplacement),
        transmission: form.transmission,
        ownerType: isFleet ? "private" : form.ownerType,
        ownerName: isFleet ? FLEET_OWNER_NAME : (form.ownerName || null),
        ownerAddress: isFleet ? null : (form.ownerAddress || null),
        ownerIco: isCompany ? (form.ownerIco || null) : null,
        ownerDic: isCompany ? (form.ownerDic || null) : null,
        ownerPhone: isFleet ? null : (form.ownerPhone || null),
        ownerEmail: isFleet ? null : (form.ownerEmail || null),
        currentKm: toInt(form.currentKm),
        notes: form.notes || null,
        stkValidUntil: form.stkValidUntil || null,
        lastOilChangeKm: toInt(form.lastOilChangeKm),
        lastOilChangeDate: form.lastOilChangeDate || null,
        lastBrakesDate: form.lastBrakesDate || null,
        lastTimingDate: form.lastTimingDate || null,
        lastTransmissionOilDate: form.transmission === "automatic" ? (form.lastTransmissionOilDate || null) : null,
        lastTransmissionOilKm: form.transmission === "automatic" ? toInt(form.lastTransmissionOilKm) : null,
        oilChangeIntervalKm: toInt(form.oilChangeIntervalKm),
        oilChangeIntervalMonths: toInt(form.oilChangeIntervalMonths),
        transmissionOilIntervalKm: form.transmission === "automatic" ? toInt(form.transmissionOilIntervalKm) : null,
        transmissionOilIntervalMonths: form.transmission === "automatic" ? toInt(form.transmissionOilIntervalMonths) : null,
        brakesIntervalMonths: toInt(form.brakesIntervalMonths),
        timingIntervalKm: toInt(form.timingIntervalKm),
        timingIntervalMonths: toInt(form.timingIntervalMonths),
        lastBrakeFluidDate: form.lastBrakeFluidDate || null,
        brakeFluidIntervalMonths: toInt(form.brakeFluidIntervalMonths),
        isFleet,
      }
    }, {
      onSuccess: (vehicle) => {
        queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
        toast({ title: isFleet ? "Vozidlo přidáno do vozového parku" : "Vozidlo přidáno" });
        navigate(`/vehicles/${vehicle.id}`);
      },
      onError: () => {
        toast({ title: "Chyba", description: "Vozidlo se nepodařilo přidat.", variant: "destructive" });
      }
    });
  }

  function handleAddFiles(files: FileList | File[] | null) {
    if (!files) return;
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    setImportFiles((prev) => [...prev, ...arr].slice(0, 4));
  }

  useEffect(() => {
    if (!importOpen) return;
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const it of Array.from(items)) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            const ext = (f.type.split("/")[1] || "png").split("+")[0];
            files.push(new File([f], f.name && f.name !== "image.png" ? f.name : `snimek-${Date.now()}.${ext}`, { type: f.type }));
          }
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        handleAddFiles(files);
        toast({ title: "Snímek vložen", description: `Přidáno ${files.length} ${files.length === 1 ? "obrázek" : "obrázků"}.` });
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [importOpen, toast]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    handleAddFiles(e.dataTransfer.files);
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
            vin: result.vin ?? f.vin,
            year: result.registrationYear != null ? String(result.registrationYear) : f.year,
            engineDisplacement: result.engineDisplacement != null ? String(result.engineDisplacement) : f.engineDisplacement,
            make: result.make ?? f.make,
            model: result.model ?? f.model,
            color: result.color ?? result.colorObserved ?? f.color,
            currentKm: result.odometerKm != null ? String(result.odometerKm) : f.currentKm,
            ownerType: result.ownerType === "company" || result.ownerType === "private" ? result.ownerType : f.ownerType,
            ownerName: result.ownerName ?? f.ownerName,
            ownerAddress: result.ownerAddress ?? f.ownerAddress,
            ownerIco: result.ownerIco ?? f.ownerIco,
          }));
          if (result.ownerName || result.ownerAddress || result.ownerIco) setOwnerSource("scan");
          if (result.colorMismatch && result.color && result.colorObserved) setColorWarning({ tp: result.color, photo: result.colorObserved });
          else setColorWarning(null);
          setImportOpen(false);
          setImportFiles([]);
          toast({ title: "Údaje načteny", description: "Předvyplnili jsme rozpoznané údaje. Zkontrolujte je a doplňte chybějící pole." });
          void autoVerifyFromAres(result.ownerIco, result.ownerType);
        },
        onError: () => {
          toast({ title: "Import selhal", description: "Zkuste znovu nebo vyplňte ručně.", variant: "destructive" });
        }
      });
    } catch {
      toast({ title: "Chyba", description: "Nepodařilo se načíst soubor.", variant: "destructive" });
    }
  }

  const isCompany = form.ownerType === "company";
  const isAutomatic = form.transmission === "automatic";

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
          <Sparkles className="h-4 w-4 mr-2" />Načíst z fotek
        </Button>
      </div>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>Údaje o vozidle</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {isFleet && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3 text-sm">
                Vozidlo vozového parku je vedeno na jméno <span className="font-medium">{FLEET_OWNER_NAME}</span>.
              </div>
            )}
            {!isFleet && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Vlastník</h3>
                {aresVerifying && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Ověřuji v ARES…
                  </span>
                )}
                {!aresVerifying && ownerSource === "ares" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                    <ShieldCheck className="h-3 w-3" />
                    Ověřeno z ARES
                  </span>
                )}
                {!aresVerifying && ownerSource === "scan" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    <ScanLine className="h-3 w-3" />
                    Načteno ze skenu
                  </span>
                )}
                {!aresVerifying && aresWarning && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    {aresWarning === "notfound" ? "IČO nenalezeno v ARES – zkontrolujte údaje" : "IČO se nepodařilo ověřit v ARES"}
                  </span>
                )}
              </div>
              <RadioGroup
                value={form.ownerType}
                onValueChange={(v) => { setForm(f => ({ ...f, ownerType: v as "private" | "company" })); setAresWarning(null); }}
                className="flex gap-6"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="private" id="own-private" />
                  <Label htmlFor="own-private" className="cursor-pointer">Soukromá osoba</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="company" id="own-company" />
                  <Label htmlFor="own-company" className="cursor-pointer">Firma</Label>
                </div>
              </RadioGroup>
              <div className="grid grid-cols-1 gap-4">
                <div className="space-y-1">
                  <Label>{isCompany ? "Název firmy" : "Jméno vlastníka / provozovatele"}</Label>
                  <Input
                    placeholder={isCompany ? "AutoFirma s.r.o." : "Jan Novák"}
                    value={form.ownerName}
                    onChange={e => { setForm(f => ({ ...f, ownerName: e.target.value })); setOwnerSource(null); setAresWarning(null); }}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{isCompany ? "Sídlo" : "Adresa"}</Label>
                  <Input
                    placeholder="Lubočinka 251, 251 68"
                    value={form.ownerAddress}
                    onChange={e => { setForm(f => ({ ...f, ownerAddress: e.target.value })); setOwnerSource(null); setAresWarning(null); }}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Telefon</Label>
                    <Input
                      type="tel" placeholder="+420 777 123 456"
                      value={form.ownerPhone}
                      onChange={e => setForm(f => ({ ...f, ownerPhone: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>E-mail</Label>
                    <Input
                      type="email" placeholder="jan.novak@email.cz"
                      value={form.ownerEmail}
                      onChange={e => setForm(f => ({ ...f, ownerEmail: e.target.value }))}
                    />
                  </div>
                </div>
                {isCompany && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <Label>IČO</Label>
                        <div className="flex gap-2">
                          <Input placeholder="12345678" value={form.ownerIco} onChange={e => { setForm(f => ({ ...f, ownerIco: e.target.value })); setAresWarning(null); }} />
                          <AresButton ico={form.ownerIco} onLoaded={(d) => { setForm(f => ({
                            ...f,
                            ownerName: d.name || f.ownerName,
                            ownerAddress: d.address || f.ownerAddress,
                            ownerDic: d.dic || f.ownerDic,
                          })); setOwnerSource("ares"); setAresWarning(null); }} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label>DIČ</Label>
                        <Input placeholder="CZ12345678" value={form.ownerDic} onChange={e => { setForm(f => ({ ...f, ownerDic: e.target.value })); setOwnerSource(null); setAresWarning(null); }} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            )}

            <div className="space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Vozidlo</h3>
              {fleetMode && (
                <div className="flex items-center gap-3 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3">
                  <div>
                    <span className="text-sm font-medium">Vozidlo vozového parku (náhradní vůz)</span>
                    <p className="text-xs text-muted-foreground">Vozidlo se zobrazí ve Vozidlech i ve Vozovém parku a lze ho půjčovat zákazníkům.</p>
                  </div>
                </div>
              )}
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
                  <AutocompleteInput
                    placeholder="Škoda"
                    value={form.make}
                    onChange={(v) => setForm(f => ({ ...f, make: v, model: f.make.trim().toLowerCase() === v.trim().toLowerCase() ? f.model : "" }))}
                    options={makeOptions}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>Model / typ *</Label>
                  <AutocompleteInput
                    placeholder="Octavia"
                    value={form.model}
                    onChange={(v) => setForm(f => ({ ...f, model: v }))}
                    options={modelOptions}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>Rok výroby</Label>
                  <Input type="number" placeholder="2018" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Barva</Label>
                  <Input placeholder="Bílá" value={form.color} onChange={e => { setForm(f => ({ ...f, color: e.target.value })); setColorWarning(null); }} />
                  {colorWarning && (
                    <p className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-500">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      <span>V TP je „{colorWarning.tp}", na fotografii vypadá „{colorWarning.photo}". Zkontrolujte.</span>
                    </p>
                  )}
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>VIN</Label>
                  <Input placeholder="VF3XCRHGA..." value={form.vin} onChange={e => setForm(f => ({ ...f, vin: e.target.value }))} className="font-mono" />
                </div>
                <div className="space-y-1">
                  <Label>Objem motoru (cm³)</Label>
                  <Input type="number" placeholder="1997" value={form.engineDisplacement} onChange={e => setForm(f => ({ ...f, engineDisplacement: e.target.value }))} />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label>Převodovka *</Label>
                  <RadioGroup
                    value={form.transmission}
                    onValueChange={(v) => setForm(f => ({ ...f, transmission: v as "manual" | "automatic" }))}
                    className="flex gap-6 pt-1"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="manual" id="trans-manual" />
                      <Label htmlFor="trans-manual" className="cursor-pointer">Manuální</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="automatic" id="trans-auto" />
                      <Label htmlFor="trans-auto" className="cursor-pointer">Automatická</Label>
                    </div>
                  </RadioGroup>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Provoz a poslední servis</h3>
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
                  <Label>Datum výměny motorového oleje</Label>
                  <Input type="date" value={form.lastOilChangeDate} onChange={e => setForm(f => ({ ...f, lastOilChangeDate: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Km při výměně oleje</Label>
                  <Input type="number" value={form.lastOilChangeKm} onChange={e => setForm(f => ({ ...f, lastOilChangeKm: e.target.value }))} />
                </div>
                {isAutomatic && (
                  <>
                    <div className="space-y-1">
                      <Label>Datum výměny oleje v převodovce</Label>
                      <Input type="date" value={form.lastTransmissionOilDate} onChange={e => setForm(f => ({ ...f, lastTransmissionOilDate: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Km při výměně oleje v převodovce</Label>
                      <Input type="number" value={form.lastTransmissionOilKm} onChange={e => setForm(f => ({ ...f, lastTransmissionOilKm: e.target.value }))} />
                    </div>
                  </>
                )}
                <div className="space-y-1">
                  <Label>Datum servisu brzd</Label>
                  <Input type="date" value={form.lastBrakesDate} onChange={e => setForm(f => ({ ...f, lastBrakesDate: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Datum servisu rozvodů</Label>
                  <Input type="date" value={form.lastTimingDate} onChange={e => setForm(f => ({ ...f, lastTimingDate: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Datum výměny brzdové kapaliny</Label>
                  <Input type="date" value={form.lastBrakeFluidDate} onChange={e => setForm(f => ({ ...f, lastBrakeFluidDate: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Servisní intervaly</h3>
              <p className="text-xs text-muted-foreground">Nastavte interval v km nebo v měsících. Prázdné pole znamená bez upozornění.</p>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Motorový olej</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <Input type="number" placeholder="km, např. 15000" value={form.oilChangeIntervalKm} onChange={e => setForm(f => ({ ...f, oilChangeIntervalKm: e.target.value }))} />
                    <Input type="number" placeholder="měsíců" value={form.oilChangeIntervalMonths} onChange={e => setForm(f => ({ ...f, oilChangeIntervalMonths: e.target.value }))} />
                  </div>
                </div>
                {isAutomatic && (
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Olej v převodovce</Label>
                    <div className="grid grid-cols-2 gap-3">
                      <Input type="number" placeholder="km" value={form.transmissionOilIntervalKm} onChange={e => setForm(f => ({ ...f, transmissionOilIntervalKm: e.target.value }))} />
                      <Input type="number" placeholder="měsíců" value={form.transmissionOilIntervalMonths} onChange={e => setForm(f => ({ ...f, transmissionOilIntervalMonths: e.target.value }))} />
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Brzdy</Label>
                  <Input type="number" placeholder="měsíců" value={form.brakesIntervalMonths} onChange={e => setForm(f => ({ ...f, brakesIntervalMonths: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Rozvody</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <Input type="number" placeholder="km, např. 120000" value={form.timingIntervalKm} onChange={e => setForm(f => ({ ...f, timingIntervalKm: e.target.value }))} />
                    <Input type="number" placeholder="měsíců" value={form.timingIntervalMonths} onChange={e => setForm(f => ({ ...f, timingIntervalMonths: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Brzdová kapalina</Label>
                  <Input type="number" placeholder="měsíců" value={form.brakeFluidIntervalMonths} onChange={e => setForm(f => ({ ...f, brakeFluidIntervalMonths: e.target.value }))} />
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
            <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-amber-500" />Načtení vozu z fotek</DialogTitle>
            <DialogDescription>
              Nahrajte fotografie malého technického průkazu (obě strany). Pokud není po ruce, můžete nahrát i fotku SPZ vozidla a fotku VIN (štítek, ražba nebo VIN za sklem). Přidejte i fotku přístrojové desky (tachometru) pro načtení stavu km. Načteme SPZ, VIN, výrobce, model, rok první registrace, objem motoru a stav tachometru. Ostatní údaje prosím doplňte ručně.
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
            <div
              onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
              onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
              onDrop={onDrop}
              className={cn(
                "rounded-lg border-2 border-dashed p-6 text-center transition-colors",
                dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/30 bg-muted/30",
              )}
            >
              <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm font-medium">Přetáhněte obrázky sem</p>
              <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
                <ClipboardPaste className="h-3 w-3" />
                nebo vložte snímek klávesovou zkratkou{" "}
                <kbd className="px-1 py-0.5 bg-background border rounded text-[10px] font-mono">Ctrl</kbd>
                +
                <kbd className="px-1 py-0.5 bg-background border rounded text-[10px] font-mono">V</kbd>
              </p>
            </div>
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
              Můžete nahrát až 4 fotografie. Doporučujeme přední i zadní stranu technického průkazu pro lepší výsledek.
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
