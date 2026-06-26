import { useEffect, useRef, useState } from "react";
import { useImportVehicleFromTp } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, Upload, X, Loader2, Sparkles, ScanLine, ClipboardPaste } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api-error";

export type TpExtractedData = {
  licensePlate: string | null;
  vin: string | null;
  registrationYear: number | null;
  engineDisplacement: number | null;
  make: string | null;
  model: string | null;
  odometerKm: number | null;
  ownerName: string | null;
  ownerIco: string | null;
  ownerAddress: string | null;
  ownerType: string | null;
  color: string | null;
  colorObserved: string | null;
  colorMismatch: boolean;
};

const MAX_IMAGES = 8;

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

// Longest-edge cap (px) for uploaded scans. Large enough to keep small text
// (VIN, SPZ, TP fields) legible for the AI, small enough to keep the base64
// payload well under the server body limit even with several photos.
const MAX_IMAGE_DIM = 2000;
const JPEG_QUALITY = 0.82;

// Downscale + re-encode a photo to JPEG before upload. Modern phone photos are
// several MB each; with up to 8 images the raw base64 payload easily exceeds the
// server limit and is rejected (413). Compressing client-side keeps the request
// small while preserving enough detail for OCR. Falls back to the raw file if
// the browser can't decode/encode it (e.g. unsupported format).
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
          fileToBase64(file).then(resolve);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
        URL.revokeObjectURL(url);
        const comma = dataUrl.indexOf(",");
        resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
      } catch {
        URL.revokeObjectURL(url);
        fileToBase64(file).then(resolve);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      fileToBase64(file).then(resolve);
    };
    img.src = url;
  });
}

export function TpScanDialog({
  open, onOpenChange, onExtracted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onExtracted: (data: TpExtractedData) => void;
}) {
  const { toast } = useToast();
  const importFromTp = useImportVehicleFromTp();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [dragActive, setDragActive] = useState(false);

  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)); };
  }, [files]);

  function addImages(list: File[]) {
    const imgs = list.filter((f) => f.type.startsWith("image/"));
    if (imgs.length === 0) return;
    setFiles((p) => [...p, ...imgs].slice(0, MAX_IMAGES));
  }

  function handleAdd(list: FileList | null) {
    if (!list) return;
    addImages(Array.from(list));
  }

  // Paste screenshot from clipboard (Ctrl+V) while dialog is open
  useEffect(() => {
    if (!open) return;
    function onPaste(e: ClipboardEvent) {
      if (!e.clipboardData) return;
      const items = Array.from(e.clipboardData.items);
      const imageFiles: File[] = [];
      for (const it of items) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) {
            const ext = f.type.split("/")[1] ?? "png";
            const named = f.name && f.name !== "image.png"
              ? f
              : new File([f], `snimek-${Date.now()}.${ext}`, { type: f.type });
            imageFiles.push(named);
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        addImages(imageFiles);
        toast({ title: "Snímek vložen", description: `Přidáno ${imageFiles.length} ze schránky.` });
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, toast]);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    const dropped = e.dataTransfer?.files;
    if (dropped && dropped.length > 0) {
      addImages(Array.from(dropped));
    }
  }

  async function handleRun() {
    if (files.length === 0) return;
    try {
      const images = await Promise.all(files.map(compressImageToBase64));
      importFromTp.mutate({ data: { images } }, {
        onSuccess: (res) => {
          onExtracted(res as TpExtractedData);
          setFiles([]);
          onOpenChange(false);
        },
        onError: (err) => toast({ title: "Načtení selhalo", description: getApiErrorMessage(err, "Zkuste pořídit ostřejší fotografii."), variant: "destructive" }),
      });
    } catch {
      toast({ title: "Chyba", description: "Soubor se nepodařilo načíst.", variant: "destructive" });
    }
  }

  function close(v: boolean) {
    if (!v) setFiles([]);
    onOpenChange(v);
  }

  const canAddMore = files.length < MAX_IMAGES && !importFromTp.isPending;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-primary" />Načtení vozu</DialogTitle>
          <DialogDescription>
            Vyfoťte malý technický průkaz (osvědčení o registraci, část I). Pokud není po ruce, stačí fotka SPZ a VIN (štítek, ražba nebo VIN za sklem). Přidejte i fotku přístrojové desky (tachometru) pro načtení stavu km. Můžete přidat až 8 obrázků.
            Automaticky se rozpozná SPZ, VIN, výrobce, model, rok registrace, objem motoru a stav tachometru.
          </DialogDescription>
          <p className="text-xs text-muted-foreground border-t pt-2 mt-1">
            Údaje z technického průkazu jsou osobní údaje – ukládejte je jen pokud k tomu máte zákonný důvod.
          </p>
        </DialogHeader>

        <div className="space-y-3">
          <input
            ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { handleAdd(e.target.files); e.target.value = ""; }}
          />
          <input
            ref={uploadInputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { handleAdd(e.target.files); e.target.value = ""; }}
          />

          {/* Drop / paste zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); if (canAddMore) setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            className={cn(
              "border-2 border-dashed rounded-lg p-6 text-center transition-colors",
              dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/30 bg-muted/20",
              !canAddMore && "opacity-60",
            )}
          >
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">Přetáhněte obrázky sem</p>
            <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
              <ClipboardPaste className="h-3 w-3" />
              nebo vložte snímek klávesovou zkratkou <kbd className="px-1.5 py-0.5 bg-muted rounded border text-[10px] font-mono">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 bg-muted rounded border text-[10px] font-mono">V</kbd>
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Button type="button" size="lg" className="w-full h-14 text-base"
              onClick={() => cameraInputRef.current?.click()}
              disabled={!canAddMore}>
              <Camera className="h-5 w-5 mr-2" />Vyfotit
            </Button>
            <Button type="button" variant="outline" className="w-full"
              onClick={() => uploadInputRef.current?.click()}
              disabled={!canAddMore}>
              <Upload className="h-4 w-4 mr-2" />Nahrát soubor
            </Button>
          </div>

          {files.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {files.map((f, i) => (
                <div key={i} className="relative aspect-square">
                  <div className="h-full w-full rounded border overflow-hidden bg-muted">
                    {previews[i] && (
                      <img src={previews[i]} alt={f.name} className="w-full h-full object-cover" />
                    )}
                  </div>
                  <button type="button"
                    aria-label="Odebrat fotografii"
                    className="absolute -top-1.5 -right-1.5 h-6 w-6 rounded-full bg-red-600 text-white flex items-center justify-center shadow-md ring-2 ring-white hover:bg-red-700 disabled:opacity-50"
                    onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))}
                    disabled={importFromTp.isPending}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)} disabled={importFromTp.isPending}>Zrušit</Button>
          <Button type="button" onClick={handleRun} disabled={files.length === 0 || importFromTp.isPending}>
            {importFromTp.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Zpracovávám…</> : <><Sparkles className="h-4 w-4 mr-2" />Načíst údaje</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
