import { useMemo, useState } from "react";
import {
  useListVehicles,
  useListWorkOrders,
  listWorkOrderMaterials,
  getVehicle,
} from "@workspace/api-client-react";
import type { WorkOrder, Vehicle } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { LicensePlate } from "@/components/license-plate";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Download, FileSpreadsheet, Loader2, Search, TrendingUp, Wrench, Receipt, Car as CarIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO, startOfMonth, subMonths } from "date-fns";
import { cs } from "date-fns/locale";

const FIELD_KEYS = [
  { key: "date", label: "Datum" },
  { key: "status", label: "Stav" },
  { key: "km", label: "Stav km" },
  { key: "description", label: "Popis" },
  { key: "services", label: "Servisní úkony (olej, brzdy, ...)" },
  { key: "otherWork", label: "Další práce / poznámky" },
  { key: "labor", label: "Práce (hodiny + cena)" },
  { key: "materials", label: "Materiály (název, množství, cena)" },
  { key: "materialsTotal", label: "Souhrn ceny materiálu" },
  { key: "total", label: "Celková cena (práce + materiál)" },
  { key: "photos", label: "Počet fotek" },
] as const;
type FieldKey = typeof FIELD_KEYS[number]["key"];

const STATUS_LABEL: Record<string, string> = {
  open: "Otevřená",
  in_progress: "Probíhá",
  waiting_parts: "Čeká na díly",
  needs_return: "Nutný návrat",
  completed: "Dokončená",
};

const SERVICE_FLAGS: Array<{ key: keyof WorkOrder; label: string }> = [
  { key: "oilChange", label: "Olej motor" },
  { key: "transmissionOil", label: "Olej převodovka" },
  { key: "brakes", label: "Brzdy" },
  { key: "timing", label: "Rozvody" },
  { key: "airFilter", label: "Filtr vzduchu" },
  { key: "cabinFilter", label: "Filtr kabiny" },
  { key: "stk", label: "STK" },
];

function csvEscape(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  // Neutralize formula-injection attempts (Excel/Sheets treat = + - @ as formulas)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (s.includes(";") || s.includes("\n") || s.includes("\"")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = "\uFEFF" + rows.map((r) => r.map(csvEscape).join(";")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatCzk(n: number | null | undefined): string {
  if (n == null) return "";
  return new Intl.NumberFormat("cs-CZ").format(n) + " Kč";
}

export default function StatisticsPage() {
  const { toast } = useToast();
  const { data: vehicles = [] } = useListVehicles({});
  const { data: workOrders = [] } = useListWorkOrders({});

  // ---------- Aggregate stats ----------
  const stats = useMemo(() => {
    const completed = workOrders.filter((o) => o.status === "completed");
    const totalRevenue = completed.reduce((s, o) => s + (o.laborPrice ?? 0), 0);
    const byStatus: Record<string, number> = {};
    for (const o of workOrders) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

    const months: { label: string; count: number; revenue: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const start = startOfMonth(subMonths(new Date(), i));
      const end = startOfMonth(subMonths(new Date(), i - 1));
      const inMonth = completed.filter((o) => {
        const d = o.completedAt ?? o.serviceDate ?? o.createdAt;
        if (!d) return false;
        const dt = new Date(d);
        return dt >= start && dt < end;
      });
      months.push({
        label: format(start, "LLLL yyyy", { locale: cs }),
        count: inMonth.length,
        revenue: inMonth.reduce((s, o) => s + (o.laborPrice ?? 0), 0),
      });
    }

    const byVehicle: Record<string, { plate: string; count: number; revenue: number }> = {};
    for (const o of workOrders) {
      const k = o.licensePlate;
      if (!byVehicle[k]) byVehicle[k] = { plate: k, count: 0, revenue: 0 };
      byVehicle[k].count++;
      if (o.status === "completed") byVehicle[k].revenue += o.laborPrice ?? 0;
    }
    const topVehicles = Object.values(byVehicle).sort((a, b) => b.count - a.count).slice(0, 5);

    return { totalRevenue, completedCount: completed.length, total: workOrders.length, byStatus, months, topVehicles };
  }, [workOrders]);

  // ---------- Export ----------
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [fields, setFields] = useState<Record<FieldKey, boolean>>({
    date: true, status: true, km: true, description: true, services: true,
    otherWork: true, labor: true, materials: true, materialsTotal: true, total: true, photos: false,
  });
  const [exporting, setExporting] = useState(false);

  const filteredVehicles: Vehicle[] = useMemo(() => {
    const q = vehicleSearch.trim().toLowerCase();
    if (!q) return vehicles.slice(0, 10);
    return vehicles
      .filter((v) => {
        return (
          v.licensePlate.toLowerCase().includes(q) ||
          v.make.toLowerCase().includes(q) ||
          v.model.toLowerCase().includes(q) ||
          (v.ownerName?.toLowerCase().includes(q) ?? false)
        );
      })
      .slice(0, 10);
  }, [vehicles, vehicleSearch]);

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId) ?? null;

  function toggleField(k: FieldKey) {
    setFields((f) => ({ ...f, [k]: !f[k] }));
  }

  const selectedFieldCount = Object.values(fields).filter(Boolean).length;

  async function handleExport() {
    if (!selectedVehicle) return;
    if (selectedFieldCount === 0) {
      toast({ title: "Vyberte alespoň jednu položku", description: "Označte, co má export obsahovat.", variant: "destructive" });
      return;
    }
    setExporting(true);
    try {
      const detail = await getVehicle(selectedVehicle.id);
      const allOrders: WorkOrder[] = [...(detail.completedWorkOrders ?? []), ...(detail.openWorkOrders ?? [])]
        .sort((a, b) => {
          const da = new Date(a.serviceDate ?? a.completedAt ?? a.createdAt).getTime();
          const db = new Date(b.serviceDate ?? b.completedAt ?? b.createdAt).getTime();
          return db - da;
        });

      const needsMaterials = fields.materials || fields.materialsTotal || fields.total;
      const materialsMap = new Map<number, Awaited<ReturnType<typeof listWorkOrderMaterials>>>();
      if (needsMaterials) {
        await Promise.all(
          allOrders.map(async (o) => {
            try { materialsMap.set(o.id, await listWorkOrderMaterials(o.id)); }
            catch { materialsMap.set(o.id, []); }
          }),
        );
      }

      const header: string[] = [];
      // Track column indices for summary row placement
      const idx: { laborPrice?: number; materialsTotal?: number; total?: number; first?: number } = {};
      const push = (label: string) => { const i = header.length; header.push(label); return i; };
      idx.first = 0;
      if (fields.date) push("Datum");
      if (fields.status) push("Stav");
      if (fields.km) push("Najeto km");
      if (fields.description) push("Popis");
      if (fields.services) push("Servisní úkony");
      if (fields.otherWork) push("Další práce");
      if (fields.labor) { push("Hodiny práce"); idx.laborPrice = push("Cena práce (Kč)"); }
      if (fields.materials) push("Materiály");
      if (fields.materialsTotal) idx.materialsTotal = push("Materiál celkem (Kč)");
      if (fields.total) idx.total = push("Celkem (Kč)");
      if (fields.photos) push("Počet fotek");

      const rows: string[][] = [];
      rows.push([`Servisní historie — ${selectedVehicle.licensePlate} ${selectedVehicle.make} ${selectedVehicle.model}`]);
      if (selectedVehicle.ownerName) rows.push([`Vlastník: ${selectedVehicle.ownerName}`]);
      rows.push([`Vygenerováno: ${format(new Date(), "d. M. yyyy HH:mm", { locale: cs })}`]);
      rows.push([]);
      rows.push(header);

      let grandLabor = 0, grandMaterial = 0;
      for (const o of allOrders) {
        const mats = materialsMap.get(o.id) ?? [];
        const matTotal = mats.reduce((s, m) => s + (m.unitPrice ?? 0) * (parseFloat(m.quantity) || 0), 0);
        const labor = o.laborPrice ?? 0;
        grandLabor += labor;
        grandMaterial += matTotal;

        const row: string[] = [];
        const date = o.serviceDate ?? o.completedAt ?? o.createdAt;
        if (fields.date) row.push(date ? format(new Date(date), "d. M. yyyy", { locale: cs }) : "");
        if (fields.status) row.push(STATUS_LABEL[o.status] ?? o.status);
        if (fields.km) row.push(o.km != null ? String(o.km) : "");
        if (fields.description) row.push(o.description ?? "");
        if (fields.services) {
          const svc = SERVICE_FLAGS.filter((f) => o[f.key]).map((f) => f.label).join(", ");
          row.push(svc);
        }
        if (fields.otherWork) row.push([o.otherWork, o.otherServices].filter(Boolean).join(" — "));
        if (fields.labor) {
          row.push(o.laborHours ?? "");
          row.push(labor ? String(labor) : "");
        }
        if (fields.materials) {
          const ms = mats.map((m) => {
            const qty = m.quantity;
            const unit = m.unit ? ` ${m.unit}` : "";
            const price = m.unitPrice != null ? ` (${m.unitPrice} Kč/ks)` : "";
            return `${m.name} — ${qty}${unit}${price}`;
          }).join("; ");
          row.push(ms);
        }
        if (fields.materialsTotal) row.push(matTotal ? String(Math.round(matTotal)) : "");
        if (fields.total) row.push(String(Math.round(labor + matTotal)));
        if (fields.photos) row.push(String(o.photos?.length ?? 0));
        rows.push(row);
      }

      const hasAnyTotal = idx.laborPrice != null || idx.materialsTotal != null || idx.total != null;
      if (hasAnyTotal) {
        rows.push([]);
        const summary: string[] = Array(header.length).fill("");
        summary[0] = "CELKEM";
        if (idx.laborPrice != null) summary[idx.laborPrice] = String(grandLabor);
        if (idx.materialsTotal != null) summary[idx.materialsTotal] = String(Math.round(grandMaterial));
        if (idx.total != null) summary[idx.total] = String(Math.round(grandLabor + grandMaterial));
        rows.push(summary);
      }

      const fname = `servisni-historie_${selectedVehicle.licensePlate.replace(/\s+/g, "")}_${format(new Date(), "yyyy-MM-dd")}.csv`;
      downloadCsv(fname, rows);
      toast({ title: "Export hotov", description: `${allOrders.length} zakázek exportováno do CSV.` });
    } catch (e: any) {
      toast({ title: "Chyba exportu", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Statistiky</h1>
          <p className="text-muted-foreground">Přehled výkonu dílny a export servisní historie vozidel.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Tržby z dokončených</CardTitle>
            <Receipt className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCzk(stats.totalRevenue)}</div>
            <p className="text-xs text-muted-foreground">jen práce (bez materiálu)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Dokončené zakázky</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.completedCount}</div>
            <p className="text-xs text-muted-foreground">z {stats.total} celkem</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Průměr na zakázku</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCzk(stats.completedCount > 0 ? Math.round(stats.totalRevenue / stats.completedCount) : 0)}
            </div>
            <p className="text-xs text-muted-foreground">průměrná cena práce</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Vozidla v evidenci</CardTitle>
            <CarIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vehicles.length}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Posledních 6 měsíců</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const maxCount = Math.max(1, ...stats.months.map((m) => m.count));
              return (
                <div className="space-y-2">
                  {stats.months.map((m) => (
                    <div key={m.label} className="grid grid-cols-[110px_1fr_90px] items-center gap-3 text-sm">
                      <span className="capitalize text-muted-foreground">{m.label}</span>
                      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary" style={{ width: `${(m.count / maxCount) * 100}%` }} />
                      </div>
                      <span className="text-right tabular-nums">
                        <span className="font-medium">{m.count}</span>
                        <span className="text-muted-foreground"> · {formatCzk(m.revenue)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stav zakázek</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2">
              {Object.entries(stats.byStatus).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <Badge variant="outline">{STATUS_LABEL[k] ?? k}</Badge>
                  <span className="tabular-nums font-medium">{v}</span>
                </div>
              ))}
              {Object.keys(stats.byStatus).length === 0 && (
                <p className="text-sm text-muted-foreground">Zatím žádné zakázky.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {stats.topVehicles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nejčastěji servisovaná vozidla</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.topVehicles.map((v) => (
                <div key={v.plate} className="flex items-center justify-between gap-3">
                  <LicensePlate plate={v.plate} size="sm" />
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary/70" style={{ width: `${(v.count / stats.topVehicles[0].count) * 100}%` }} />
                  </div>
                  <span className="tabular-nums text-sm w-20 text-right">
                    {v.count}× · {formatCzk(v.revenue)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Export servisní historie</CardTitle>
          <CardDescription>
            Vyberte vozidlo a položky, které chcete v exportu. Soubor se stáhne jako CSV (otevřít v Excelu nebo Google Sheets).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <Label className="text-sm">Vozidlo</Label>
            <div className="relative mt-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Hledat podle SPZ, značky nebo vlastníka…"
                className="pl-9"
                value={vehicleSearch}
                onChange={(e) => { setVehicleSearch(e.target.value); setSelectedVehicleId(null); }}
              />
            </div>
            {!selectedVehicle && (
              <div className="mt-2 border rounded-md divide-y max-h-64 overflow-auto">
                {filteredVehicles.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground">Žádné vozidlo neodpovídá.</div>
                ) : (
                  filteredVehicles.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => { setSelectedVehicleId(v.id); setVehicleSearch(""); }}
                      className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-accent"
                    >
                      <LicensePlate plate={v.licensePlate} size="sm" />
                      <span className="flex-1">
                        <span className="font-medium">{v.make} {v.model}</span>
                        {v.ownerName && <span className="text-muted-foreground"> · {v.ownerName}</span>}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
            {selectedVehicle && (
              <div className="mt-2 flex items-center gap-3 p-3 border rounded-md bg-muted/40">
                <LicensePlate plate={selectedVehicle.licensePlate} size="md" />
                <span className="flex-1">
                  <span className="font-medium">{selectedVehicle.make} {selectedVehicle.model}</span>
                  {selectedVehicle.ownerName && <span className="text-muted-foreground"> · {selectedVehicle.ownerName}</span>}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setSelectedVehicleId(null)}>Změnit</Button>
              </div>
            )}
          </div>

          <div>
            <Label className="text-sm">Položky v exportu</Label>
            <div className="grid sm:grid-cols-2 gap-2 mt-2">
              {FIELD_KEYS.map((f) => (
                <label key={f.key} className="flex items-center gap-2 p-2 border rounded-md hover:bg-accent cursor-pointer">
                  <Checkbox checked={fields[f.key]} onCheckedChange={() => toggleField(f.key)} />
                  <span className="text-sm">{f.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2">
            <span className="text-sm text-muted-foreground mr-auto">
              {selectedFieldCount === 0 ? "Vyberte alespoň jednu položku." : `Vybráno: ${selectedFieldCount}`}
            </span>
            <Button onClick={handleExport} disabled={!selectedVehicle || exporting || selectedFieldCount === 0}>
              {exporting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Připravuji…</> : <><Download className="h-4 w-4 mr-2" />Stáhnout CSV</>}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
