import { useEffect, useRef, useState } from "react";
import { useImportVehicleFromTp } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, Upload, X, Loader2, Sparkles, ScanLine, ClipboardPaste } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type TpExtractedData = {
  licensePlate: string | null;
  vin: string | null;
  registrationYear: number | null;
  engineDisplacement: number | null;
  make: string | null;
  model: string | null;
  odometerKm: number | null;
};

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

export function TpScanDialog({
  open, onOpenChange, onExtracted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onExtracted: (data: TpExtractedData) => void;
}) {
  const { toast } = useToast();
  const importFromTp = useImportVehicleFromTp();
  const inputRef = useRef<HTMLInputElement>(null);
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
    setFiles((p) => [...p, ...imgs].slice(0, 4));
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
      const images = await Promise.all(files.map(fileToBase64));
      importFromTp.mutate({ data: { images } }, {
        onSuccess: (res) => {
          onExtracted(res as TpExtractedData);
          setFiles([]);
          onOpenChange(false);
        },
        onError: () => toast({ title: "Načtení selhalo", description: "Zkuste pořídit ostřejší fotografii.", variant: "destructive" }),
      });
    } catch {
      toast({ title: "Chyba", description: "Soubor se nepodařilo načíst.", variant: "destructive" });
    }
  }

  function close(v: boolean) {
    if (!v) setFiles([]);
    onOpenChange(v);
  }

  const canAddMore = files.length < 4 && !importFromTp.isPending;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-primary" />Načtení vozu</DialogTitle>
          <DialogDescription>
            Vyfoťte malý technický průkaz (osvědčení o registraci, část I). Pokud není po ruce, stačí fotka SPZ a VIN (štítek, ražba nebo VIN za sklem). Přidejte i fotku přístrojové desky (tachometru) pro načtení stavu km. Můžete přidat až 4 obrázky.
            Automaticky se rozpozná SPZ, VIN, výrobce, model, rok registrace, objem motoru a stav tachometru.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <input
            ref={inputRef} type="file" accept="image/*" multiple className="hidden"
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
              onClick={() => { if (inputRef.current) { inputRef.current.setAttribute("capture", "environment"); inputRef.current.click(); } }}
              disabled={!canAddMore}>
              <Camera className="h-5 w-5 mr-2" />Vyfotit
            </Button>
            <Button type="button" variant="outline" className="w-full"
              onClick={() => { if (inputRef.current) { inputRef.current.removeAttribute("capture"); inputRef.current.click(); } }}
              disabled={!canAddMore}>
              <Upload className="h-4 w-4 mr-2" />Nahrát soubor
            </Button>
          </div>

          {files.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {files.map((f, i) => (
                <div key={i} className="relative group aspect-square rounded border overflow-hidden bg-muted">
                  {previews[i] && (
                    <img src={previews[i]} alt={f.name} className="w-full h-full object-cover" />
                  )}
                  <Button type="button" variant="secondary" size="icon"
                    className="absolute top-1 right-1 h-6 w-6 opacity-90"
                    onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))}
                    disabled={importFromTp.isPending}>
                    <X className="h-3 w-3" />
                  </Button>
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
