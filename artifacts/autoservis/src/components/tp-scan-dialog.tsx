import { useRef, useState } from "react";
import { useImportVehicleFromTp } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Camera, Upload, X, Loader2, Sparkles, ScanLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export type TpExtractedData = {
  licensePlate: string | null;
  vin: string | null;
  registrationYear: number | null;
  engineDisplacement: number | null;
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

  function handleAdd(list: FileList | null) {
    if (!list) return;
    const next = Array.from(list).slice(0, 4 - files.length);
    setFiles((p) => [...p, ...next].slice(0, 4));
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

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ScanLine className="h-5 w-5 text-primary" />Načtení technického průkazu</DialogTitle>
          <DialogDescription>
            Vyfoťte malý technický průkaz (osvědčení o registraci, část I). Můžete přidat až 4 fotografie (přední i zadní stranu).
            Automaticky se rozpozná SPZ, VIN, rok registrace a objem motoru.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <input
            ref={inputRef} type="file" accept="image/*" multiple className="hidden"
            onChange={(e) => { handleAdd(e.target.files); e.target.value = ""; }}
          />
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1"
              onClick={() => { if (inputRef.current) { inputRef.current.removeAttribute("capture"); inputRef.current.click(); } }}
              disabled={files.length >= 4 || importFromTp.isPending}>
              <Upload className="h-4 w-4 mr-2" />Nahrát fotografii
            </Button>
            <Button type="button" variant="outline" className="flex-1"
              onClick={() => { if (inputRef.current) { inputRef.current.setAttribute("capture", "environment"); inputRef.current.click(); } }}
              disabled={files.length >= 4 || importFromTp.isPending}>
              <Camera className="h-4 w-4 mr-2" />Vyfotit z telefonu
            </Button>
          </div>

          {files.length > 0 && (
            <div className="space-y-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center justify-between bg-muted/40 rounded px-3 py-2 text-sm">
                  <span className="truncate">{f.name}</span>
                  <Button type="button" variant="ghost" size="sm"
                    onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))}
                    disabled={importFromTp.isPending}>
                    <X className="h-4 w-4" />
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
