import { useRef, useState, useMemo } from "react";
import { Link } from "wouter";
import { QrCode } from "lucide-react";
import {
  useScanMaterials,
  useAddWorkOrderMaterial,
  useImportVehicleFromTp,
  useListWorkOrders,
  getListWorkOrderMaterialsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Camera, Upload, X, Loader2, ScanLine, ClipboardList,
  CheckCircle2, RotateCcw, Plus, Minus, Trash2, Sparkles, ArrowLeft, AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api-error";

const MAX_MAT_IMAGES = 8;
const MAX_IMAGE_DIM = 2000;
const JPEG_QUALITY = 0.82;

function compressImageToBase64(file: File): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const { width, height } = img;
        const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(width, height));
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          URL.revokeObjectURL(url);
          fallbackBase64(file).then(resolve);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        URL.revokeObjectURL(url);
        const comma = dataUrl.indexOf(",");
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
      } catch {
        URL.revokeObjectURL(url);
        fallbackBase64(file).then(resolve);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); fallbackBase64(file).then(resolve); };
    img.src = url;
  });
}

function fallbackBase64(file: File): Promise<string> {
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

type Step = 1 | 2 | 3;

type Suggestion = {
  name: string;
  quantity: string;
  unit: string | null;
  unitPrice: number | null;
  catalogId: number | null;
  selected: boolean;
};

type ScanResult = {
  workOrderId: number;
  suggestions: Suggestion[];
};

function StepIndicator({ step }: { step: Step }) {
  const steps = [
    { n: 1, label: "Vozidlo" },
    { n: 2, label: "Materiály" },
    { n: 3, label: "Potvrzení" },
  ];
  return (
    <div className="flex items-center gap-1 mb-6">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center gap-1">
          <div className={cn(
            "w-7 h-7 rounded-full flex items-center justify-center text-sm font-semibold",
            step === s.n
              ? "bg-primary text-primary-foreground"
              : step > s.n
              ? "bg-emerald-600 text-white"
              : "bg-muted text-muted-foreground",
          )}>
            {step > s.n ? <CheckCircle2 className="h-4 w-4" /> : s.n}
          </div>
          <span className={cn(
            "text-sm font-medium",
            step === s.n ? "text-foreground" : "text-muted-foreground",
          )}>{s.label}</span>
          {i < steps.length - 1 && (
            <div className={cn(
              "flex-1 h-px mx-2 w-8",
              step > s.n ? "bg-emerald-400" : "bg-border",
            )} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function SkenMaterialuPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>(1);

  // Step 1 — SPZ
  const [spzInput, setSpzInput] = useState("");
  // Set when user clicks "Potvrdit" — triggers work order lookup
  const [confirmedSpz, setConfirmedSpz] = useState("");
  const [spzPhotoLoading, setSpzPhotoLoading] = useState(false);
  const spzCamRef = useRef<HTMLInputElement>(null);
  const spzUploadRef = useRef<HTMLInputElement>(null);
  const importVehicle = useImportVehicleFromTp();

  const spzClean = confirmedSpz.replace(/\s+/g, "").toUpperCase();

  // Fetch work orders when SPZ is confirmed — search by plate, filter non-completed
  const { data: workOrders, isFetching: ordersFetching } = useListWorkOrders(
    { search: spzClean },
    { query: { enabled: spzClean.length >= 3 } as any },
  );

  const openWorkOrders = useMemo(() => {
    if (!workOrders || !spzClean) return [];
    return workOrders.filter(
      (o) =>
        (o.licensePlate ?? "").replace(/\s+/g, "").toUpperCase() === spzClean &&
        o.status !== "completed",
    );
  }, [workOrders, spzClean]);

  // Active work order (first open one found)
  const activeWorkOrder = openWorkOrders[0] ?? null;
  const workOrderResolved = spzClean.length >= 3 && !ordersFetching;
  const noOpenOrder = workOrderResolved && openWorkOrders.length === 0;

  // Step 2 — Material photos
  const [matFiles, setMatFiles] = useState<File[]>([]);
  const [matPreviews, setMatPreviews] = useState<string[]>([]);
  const scanMaterials = useScanMaterials();

  // Step 3 — Review
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const addMaterial = useAddWorkOrderMaterial();
  const [saveLoading, setSaveLoading] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [done, setDone] = useState(false);

  function handleSpzPhotoFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const file = list[0]!;
    setSpzPhotoLoading(true);
    compressImageToBase64(file)
      .then((b64) => {
        importVehicle.mutate({ data: { images: [b64] } }, {
          onSuccess: (res) => {
            if (res.licensePlate) {
              setSpzInput(res.licensePlate);
              toast({ title: "SPZ rozpoznána", description: res.licensePlate });
            } else {
              toast({ title: "SPZ nerozpoznána", description: "Zadejte SPZ ručně.", variant: "destructive" });
            }
          },
          onError: () => toast({ title: "Rozpoznání selhalo", description: "Zadejte SPZ ručně.", variant: "destructive" }),
          onSettled: () => setSpzPhotoLoading(false),
        });
      })
      .catch(() => {
        setSpzPhotoLoading(false);
        toast({ title: "Chyba načítání souboru", variant: "destructive" });
      });
  }

  function handleConfirmSpz() {
    const clean = spzInput.replace(/\s+/g, "").toUpperCase();
    if (clean.length < 3) return;
    setConfirmedSpz(clean);
  }

  function handleMatFiles(list: FileList | null) {
    if (!list) return;
    const imgs = Array.from(list).filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    const next = [...matFiles, ...imgs].slice(0, MAX_MAT_IMAGES);
    setMatFiles(next);
    const urls = next.map((f) => URL.createObjectURL(f));
    setMatPreviews(urls);
  }

  function removeMatFile(idx: number) {
    const next = matFiles.filter((_, i) => i !== idx);
    setMatFiles(next);
    const urls = next.map((f) => URL.createObjectURL(f));
    setMatPreviews(urls);
  }

  async function handleScanMaterials() {
    if (matFiles.length === 0) return;
    try {
      const images = await Promise.all(matFiles.map(compressImageToBase64));
      scanMaterials.mutate({ data: { licensePlate: confirmedSpz, images } }, {
        onSuccess: (res) => {
          setScanResult({
            workOrderId: res.workOrderId,
            suggestions: (res.suggestions as Array<{ name: string; quantity: string; unit: string | null; unitPrice: number | null; catalogId: number | null }>).map((s) => ({
              ...s,
              selected: true,
            })),
          });
          setStep(3);
        },
        onError: (err) => {
          toast({
            title: "Sken selhal",
            description: getApiErrorMessage(err, "Zkuste to znovu."),
            variant: "destructive",
          });
        },
      });
    } catch {
      toast({ title: "Chyba", description: "Soubor se nepodařilo načíst.", variant: "destructive" });
    }
  }

  function updateSuggestion(idx: number, field: keyof Omit<Suggestion, "selected" | "catalogId">, value: string) {
    setScanResult((prev) => {
      if (!prev) return prev;
      const suggestions = prev.suggestions.map((s, i) => {
        if (i !== idx) return s;
        if (field === "unitPrice") return { ...s, unitPrice: value ? parseInt(value, 10) : null };
        return { ...s, [field]: value };
      });
      return { ...prev, suggestions };
    });
  }

  function toggleSuggestion(idx: number) {
    setScanResult((prev) => {
      if (!prev) return prev;
      const suggestions = prev.suggestions.map((s, i) => i === idx ? { ...s, selected: !s.selected } : s);
      return { ...prev, suggestions };
    });
  }

  function adjustQty(idx: number, delta: number) {
    setScanResult((prev) => {
      if (!prev) return prev;
      const suggestions = prev.suggestions.map((s, i) => {
        if (i !== idx) return s;
        const cur = parseFloat((s.quantity || "0").replace(",", ".")) || 0;
        const next = Math.max(0, cur + delta);
        const qty = Number.isInteger(next) ? String(next) : next.toFixed(2).replace(/\.?0+$/, "");
        return { ...s, quantity: qty };
      });
      return { ...prev, suggestions };
    });
  }

  async function handleSaveAll() {
    if (!scanResult) return;
    const selected = scanResult.suggestions.filter((s) => s.selected);
    if (selected.length === 0) return;
    setSaveLoading(true);
    let count = 0;
    for (const s of selected) {
      await new Promise<void>((resolve) => {
        addMaterial.mutate({
          id: scanResult.workOrderId,
          data: { name: s.name, quantity: s.quantity || "1", unit: s.unit, unitPrice: s.unitPrice },
        }, {
          onSuccess: () => { count++; resolve(); },
          onError: () => resolve(),
        });
      });
    }
    queryClient.invalidateQueries({ queryKey: getListWorkOrderMaterialsQueryKey(scanResult.workOrderId) });
    setSavedCount(count);
    setSaveLoading(false);
    setDone(true);
  }

  function resetAll() {
    setStep(1);
    setSpzInput("");
    setConfirmedSpz("");
    setMatFiles([]);
    setMatPreviews([]);
    setScanResult(null);
    setDone(false);
    setSavedCount(0);
  }

  function resetToSpz() {
    setConfirmedSpz("");
  }

  const canAddMore = matFiles.length < MAX_MAT_IMAGES && !scanMaterials.isPending;

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <ScanLine className="h-7 w-7 text-primary shrink-0" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Sken materiálu</h1>
            <p className="text-muted-foreground text-sm">Vyfoťte materiály a přidejte je do zakázky.</p>
          </div>
        </div>
        <Link href="/sken-materialu/qr-stitky">
          <Button variant="outline" size="sm" className="shrink-0">
            <QrCode className="h-4 w-4 mr-1.5" />QR štítky
          </Button>
        </Link>
      </div>

      <StepIndicator step={step} />

      {/* STEP 1: SPZ + open work order lookup */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Krok 1 — Vozidlo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="spz-input">SPZ vozidla</Label>
              <Input
                id="spz-input"
                placeholder="Např. 1AB2345"
                value={spzInput}
                onChange={(e) => {
                  setSpzInput(e.target.value.toUpperCase());
                  setConfirmedSpz(""); // Reset lookup when SPZ changes
                }}
                className="font-mono text-lg h-12"
                autoCapitalize="characters"
                onKeyDown={(e) => { if (e.key === "Enter") handleConfirmSpz(); }}
              />
            </div>

            <div className="text-xs text-muted-foreground text-center">nebo naskenujte SPZ fotem</div>

            <div className="grid grid-cols-2 gap-2">
              <input
                ref={spzCamRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => { handleSpzPhotoFiles(e.target.files); e.target.value = ""; }}
              />
              <input
                ref={spzUploadRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { handleSpzPhotoFiles(e.target.files); e.target.value = ""; }}
              />
              <Button
                type="button"
                variant="outline"
                disabled={spzPhotoLoading || importVehicle.isPending}
                onClick={() => spzCamRef.current?.click()}
                className="h-12"
              >
                {spzPhotoLoading || importVehicle.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Zpracovávám…</>
                  : <><Camera className="h-4 w-4 mr-2" />Vyfotit SPZ</>}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={spzPhotoLoading || importVehicle.isPending}
                onClick={() => spzUploadRef.current?.click()}
                className="h-12"
              >
                <Upload className="h-4 w-4 mr-2" />Nahrát foto
              </Button>
            </div>

            {/* Work order lookup result */}
            {confirmedSpz.length >= 3 && (
              <div className="rounded-md border p-3 space-y-2">
                {ordersFetching && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Hledám otevřenou zakázku…
                  </div>
                )}

                {!ordersFetching && activeWorkOrder && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-4 w-4 shrink-0" />
                      <span className="font-medium">Nalezena otevřená zakázka</span>
                    </div>
                    <div className="text-sm pl-6 space-y-0.5">
                      <p>Zakázka #{activeWorkOrder.id}</p>
                      {activeWorkOrder.description && (
                        <p className="text-muted-foreground">{activeWorkOrder.description}</p>
                      )}
                    </div>
                    <Button
                      type="button"
                      className="w-full h-12 text-base mt-2"
                      onClick={() => setStep(2)}
                    >
                      Pokračovat na materiály
                    </Button>
                  </div>
                )}

                {!ordersFetching && noOpenOrder && (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 text-sm text-rose-700 dark:text-rose-400">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                      <span>Pro toto vozidlo neexistuje otevřená zakázka.</span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={resetToSpz}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />Zkusit jiné vozidlo
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Confirm SPZ button (shown only before lookup or if SPZ changed) */}
            {!confirmedSpz && (
              <Button
                type="button"
                className="w-full h-12 text-base"
                disabled={spzInput.replace(/\s+/g, "").length < 3}
                onClick={handleConfirmSpz}
              >
                Ověřit zakázku
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 2: Material photos */}
      {step === 2 && (
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Button variant="ghost" size="icon" onClick={() => setStep(1)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <CardTitle className="text-base">Krok 2 — Materiály</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeWorkOrder && (
              <div className="rounded-md bg-muted/40 border px-3 py-2 text-xs text-muted-foreground">
                Zakázka #{activeWorkOrder.id} — {confirmedSpz}
                {activeWorkOrder.description ? ` — ${activeWorkOrder.description}` : ""}
              </div>
            )}

            <p className="text-sm text-muted-foreground">
              Vyfoťte materiály, štítky nebo části. Přidejte až {MAX_MAT_IMAGES} fotek.
            </p>

            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              id="mat-cam"
              onChange={(e) => { handleMatFiles(e.target.files); e.target.value = ""; }}
            />
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              id="mat-upload"
              onChange={(e) => { handleMatFiles(e.target.files); e.target.value = ""; }}
            />

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="lg"
                className="h-14 text-base"
                disabled={!canAddMore}
                onClick={() => document.getElementById("mat-cam")?.click()}
              >
                <Camera className="h-5 w-5 mr-2" />Vyfotit
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-14"
                disabled={!canAddMore}
                onClick={() => document.getElementById("mat-upload")?.click()}
              >
                <Upload className="h-4 w-4 mr-2" />Nahrát
              </Button>
            </div>

            {matFiles.length > 0 && (
              <div className="grid grid-cols-4 gap-2">
                {matFiles.map((f, i) => (
                  <div key={i} className="relative aspect-square">
                    <div className="h-full w-full rounded border overflow-hidden bg-muted">
                      {matPreviews[i] && (
                        <img src={matPreviews[i]} alt={f.name} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="Odebrat"
                      className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-red-600 text-white flex items-center justify-center shadow-md ring-2 ring-white hover:bg-red-700"
                      onClick={() => removeMatFile(i)}
                      disabled={scanMaterials.isPending}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {matFiles.length === 0 && (
              <div className="border-2 border-dashed rounded-lg p-8 text-center text-muted-foreground">
                <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Přidejte fotky materiálů ke zpracování</p>
              </div>
            )}

            {scanMaterials.isPending && (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 rounded bg-muted animate-pulse" />
                ))}
              </div>
            )}

            <Button
              type="button"
              className="w-full h-12 text-base"
              disabled={matFiles.length === 0 || scanMaterials.isPending}
              onClick={handleScanMaterials}
            >
              {scanMaterials.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Zpracovávám…</>
                : <><Sparkles className="h-4 w-4 mr-2" />Rozpoznat materiály</>}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* STEP 3: Review & confirm */}
      {step === 3 && scanResult && !done && (
        <Card>
          <CardHeader className="flex-row items-center gap-2 space-y-0">
            <Button variant="ghost" size="icon" onClick={() => setStep(2)}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <CardTitle className="text-base">Krok 3 — Potvrzení</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {scanResult.suggestions.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <p className="mb-4">AI nenašla žádné materiály.</p>
                <Button variant="outline" onClick={() => setStep(2)}>
                  <RotateCcw className="h-4 w-4 mr-2" />Zkusit znovu
                </Button>
              </div>
            )}

            {scanResult.suggestions.length > 0 && (
              <>
                <p className="text-sm text-muted-foreground">
                  Zkontrolujte rozpoznané položky. Zaškrtnuté budou přidány do zakázky #{scanResult.workOrderId}.
                </p>

                <div className="space-y-3">
                  {scanResult.suggestions.map((s, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        "border rounded-lg p-3 space-y-2 transition-opacity",
                        !s.selected && "opacity-50",
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={s.selected}
                          onChange={() => toggleSuggestion(idx)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 cursor-pointer"
                        />
                        <div className="flex-1 min-w-0 space-y-2">
                          <Input
                            value={s.name}
                            onChange={(e) => updateSuggestion(idx, "name", e.target.value)}
                            className="h-8 text-sm font-medium"
                            disabled={!s.selected}
                          />
                          <div className="grid grid-cols-3 gap-2">
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                onClick={() => adjustQty(idx, -1)}
                                disabled={!s.selected}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <Input
                                value={s.quantity}
                                onChange={(e) => updateSuggestion(idx, "quantity", e.target.value)}
                                className="h-7 text-sm text-center px-1"
                                disabled={!s.selected}
                              />
                              <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                className="h-7 w-7 shrink-0"
                                onClick={() => adjustQty(idx, 1)}
                                disabled={!s.selected}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                            <Input
                              placeholder="ks"
                              value={s.unit ?? ""}
                              onChange={(e) => updateSuggestion(idx, "unit", e.target.value)}
                              className="h-7 text-sm"
                              disabled={!s.selected}
                            />
                            <div className="relative">
                              <Input
                                placeholder="Cena"
                                value={s.unitPrice != null ? String(s.unitPrice) : ""}
                                onChange={(e) => updateSuggestion(idx, "unitPrice", e.target.value)}
                                className="h-7 text-sm pr-8"
                                type="number"
                                min={0}
                                disabled={!s.selected}
                              />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">Kč</span>
                            </div>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => toggleSuggestion(idx)}
                          title="Odebrat"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep(2)}
                    disabled={saveLoading}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />Přidat foto
                  </Button>
                  <Button
                    type="button"
                    className="h-12"
                    disabled={saveLoading || scanResult.suggestions.filter((s) => s.selected).length === 0}
                    onClick={handleSaveAll}
                  >
                    {saveLoading
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Ukládám…</>
                      : <>
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Přidat vše do zakázky
                        </>}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Done */}
      {done && scanResult && (
        <Card>
          <CardContent className="py-10 text-center space-y-4">
            <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto" />
            <div>
              <p className="text-lg font-semibold">Hotovo!</p>
              <p className="text-muted-foreground text-sm mt-1">
                Přidáno {savedCount} {savedCount === 1 ? "položka" : savedCount < 5 ? "položky" : "položek"} do zakázky #{scanResult.workOrderId}.
              </p>
            </div>
            <div className="flex flex-col gap-2 items-center">
              <Link href={`/work-orders/${scanResult.workOrderId}`}>
                <Button>
                  <ClipboardList className="h-4 w-4 mr-2" />Otevřít zakázku
                </Button>
              </Link>
              <Button variant="outline" onClick={resetAll}>
                <ScanLine className="h-4 w-4 mr-2" />Skenovat další
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
