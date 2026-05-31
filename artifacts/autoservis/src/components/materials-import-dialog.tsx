import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useImportMaterials, getListMaterialsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, Upload, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const NONE = "__none__";

type ParsedSheet = {
  headers: string[];
  rows: string[][];
};

function parsePrice(raw: string): number | null {
  if (!raw) return null;
  // Keep digits, comma, dot, minus; treat comma as decimal separator.
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? Math.round(n) : null;
}

export function MaterialsImportDialog() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importMutation = useImportMaterials();

  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [colName, setColName] = useState<string>(NONE);
  const [colUnit, setColUnit] = useState<string>(NONE);
  const [colPrice, setColPrice] = useState<string>(NONE);
  const [colSupplier, setColSupplier] = useState<string>(NONE);
  const [supplierOverride, setSupplierOverride] = useState("");

  function reset() {
    setFileName("");
    setSheet(null);
    setColName(NONE);
    setColUnit(NONE);
    setColPrice(NONE);
    setColSupplier(NONE);
    setSupplierOverride("");
  }

  function guessColumn(headers: string[], keywords: string[]): string {
    const idx = headers.findIndex((h) => keywords.some((k) => h.toLowerCase().includes(k)));
    return idx >= 0 ? String(idx) : NONE;
  }

  async function handleFile(file: File) {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const firstSheet = wb.Sheets[wb.SheetNames[0]!];
      if (!firstSheet) throw new Error("empty");
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1, blankrows: false, defval: "" });
      if (matrix.length === 0) {
        toast({ title: "Prázdný soubor", description: "Soubor neobsahuje žádná data.", variant: "destructive" });
        return;
      }
      const headers = (matrix[0] as unknown[]).map((c) => String(c ?? "").trim());
      const rows = matrix.slice(1).map((r) => (r as unknown[]).map((c) => String(c ?? "").trim()));
      setFileName(file.name);
      setSheet({ headers, rows });
      setColName(guessColumn(headers, ["název", "nazev", "name", "položka", "polozka", "popis", "artikl"]));
      setColUnit(guessColumn(headers, ["jednotka", "unit", "mj", "m.j."]));
      setColPrice(guessColumn(headers, ["cena", "price", "kč", "kc"]));
      setColSupplier(guessColumn(headers, ["dodavatel", "supplier", "výrobce", "vyrobce"]));
    } catch {
      toast({ title: "Chyba", description: "Soubor se nepodařilo načíst. Podporované formáty: CSV, XLSX, XLS.", variant: "destructive" });
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = "";
  }

  function cell(row: string[], col: string): string {
    if (col === NONE) return "";
    const idx = parseInt(col, 10);
    return row[idx] ?? "";
  }

  function buildItems() {
    if (!sheet) return [];
    return sheet.rows.map((row) => ({
      name: cell(row, colName),
      unit: cell(row, colUnit) || null,
      defaultPrice: parsePrice(cell(row, colPrice)),
      supplier: supplierOverride.trim() || cell(row, colSupplier) || null,
    }));
  }

  const items = buildItems();
  const validCount = items.filter((it) => it.name.trim()).length;

  function handleImport() {
    if (colName === NONE) {
      toast({ title: "Vyberte sloupec s názvem", variant: "destructive" });
      return;
    }
    importMutation.mutate({ data: { items } }, {
      onSuccess: (res) => {
        toast({
          title: "Ceník naimportován",
          description: `Přidáno: ${res.imported}, aktualizováno: ${res.updated}, přeskočeno: ${res.skipped}.`,
        });
        queryClient.invalidateQueries({ queryKey: getListMaterialsQueryKey() });
        setOpen(false);
        reset();
      },
      onError: () => toast({ title: "Chyba", description: "Import ceníku se nepodařil.", variant: "destructive" }),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FileSpreadsheet className="h-4 w-4 mr-2" />Import ceníku
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import ceníku dodavatele</DialogTitle>
          <DialogDescription>
            Nahrajte soubor CSV nebo XLSX. Přiřaďte sloupce a položky se uloží do skladu. Existující materiály (podle názvu) se aktualizují.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden" onChange={handleFileChange}
        />

        {!sheet ? (
          <div className="text-center py-10 border-2 border-dashed rounded-lg">
            <FileSpreadsheet className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
            <p className="text-sm text-muted-foreground mb-4">Vyberte soubor s ceníkem (CSV, XLSX, XLS).</p>
            <Button onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4 mr-2" />Vybrat soubor
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground truncate">Soubor: <span className="font-medium text-foreground">{fileName}</span> ({sheet.rows.length} řádků)</span>
              <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>Změnit soubor</Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <ColumnSelect label="Název *" headers={sheet.headers} value={colName} onChange={setColName} />
              <ColumnSelect label="Jednotka" headers={sheet.headers} value={colUnit} onChange={setColUnit} />
              <ColumnSelect label="Cena" headers={sheet.headers} value={colPrice} onChange={setColPrice} />
              <ColumnSelect label="Dodavatel" headers={sheet.headers} value={colSupplier} onChange={setColSupplier} />
            </div>

            <div className="space-y-1">
              <Label>Dodavatel pro všechny položky (volitelné)</Label>
              <Input placeholder="Např. AutoDíly s.r.o." value={supplierOverride} onChange={(e) => setSupplierOverride(e.target.value)} />
              <p className="text-xs text-muted-foreground">Pokud vyplníte, přepíše sloupec dodavatele u všech řádků.</p>
            </div>

            {colName !== NONE && (
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted px-3 py-2 text-xs font-medium">Náhled (první 5 řádků)</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-3 py-1.5">Název</th>
                      <th className="px-3 py-1.5">Jedn.</th>
                      <th className="px-3 py-1.5">Cena</th>
                      <th className="px-3 py-1.5">Dodavatel</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.slice(0, 5).map((it, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-3 py-1.5 truncate max-w-[220px]">{it.name || <span className="text-muted-foreground italic">(přeskočeno)</span>}</td>
                        <td className="px-3 py-1.5">{it.unit ?? "—"}</td>
                        <td className="px-3 py-1.5">{it.defaultPrice != null ? `${it.defaultPrice.toLocaleString("cs-CZ")} Kč` : "—"}</td>
                        <td className="px-3 py-1.5 truncate max-w-[160px]">{it.supplier ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {sheet && (
            <Button onClick={handleImport} disabled={importMutation.isPending || colName === NONE || validCount === 0}>
              {importMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              Naimportovat {validCount} položek
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColumnSelect({ label, headers, value, onChange }: { label: string; headers: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue placeholder="Vyberte sloupec" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— Nepřiřazeno —</SelectItem>
          {headers.map((h, i) => (
            <SelectItem key={i} value={String(i)}>{h || `Sloupec ${i + 1}`}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
