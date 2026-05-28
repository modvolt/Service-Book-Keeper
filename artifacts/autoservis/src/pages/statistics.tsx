import { useMemo, useState } from "react";
import {
  useListVehicles,
  useListWorkOrders,
  useGetSettings,
  listWorkOrderMaterials,
  getVehicle,
} from "@workspace/api-client-react";
import type { WorkOrder, Vehicle, Settings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { LicensePlate } from "@/components/license-plate";
import { Badge } from "@/components/ui/badge";
import { BarChart3, FileText, FileSpreadsheet, Loader2, Search, TrendingUp, Wrench, Receipt, Car as CarIcon } from "lucide-react";
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
  { key: "brakeFluid", label: "Brzdová kapalina" },
  { key: "tireChange", label: "Přezutí pneumatik" },
  { key: "diagnostics", label: "Diagnostika" },
  { key: "lightsCheck", label: "Kontrola osvětlení" },
  { key: "frontAxleCheck", label: "Přední náprava" },
  { key: "rearAxleCheck", label: "Zadní náprava" },
  { key: "frontShocksCheck", label: "Přední tlumiče" },
  { key: "rearShocksCheck", label: "Zadní tlumiče" },
  { key: "geometry", label: "Geometrie" },
  { key: "headlightAlignment", label: "Seřízení světlometů" },
  { key: "stk", label: "STK" },
];

function esc(v: unknown): string {
  if (v == null) return "";
  return String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatCzk(n: number | null | undefined): string {
  if (n == null) return "";
  return new Intl.NumberFormat("cs-CZ").format(n) + " Kč";
}

function formatNum(n: number | null | undefined): string {
  if (n == null) return "";
  return new Intl.NumberFormat("cs-CZ").format(n);
}

type FieldsState = {
  date: boolean; status: boolean; km: boolean; description: boolean; services: boolean;
  otherWork: boolean; labor: boolean; materials: boolean; materialsTotal: boolean; total: boolean; photos: boolean;
};

function buildPrintHtml(opts: {
  vehicle: Vehicle;
  orders: WorkOrder[];
  materialsMap: Map<number, Awaited<ReturnType<typeof listWorkOrderMaterials>>>;
  fields: FieldsState;
  settings: Settings | null;
}): string {
  const { vehicle, orders, materialsMap, fields, settings } = opts;

  type Col = { header: string; key: string; align?: "left" | "right" | "center"; width?: string };
  const cols: Col[] = [];
  if (fields.date) cols.push({ header: "Datum", key: "date", align: "center", width: "11%" });
  if (fields.status) cols.push({ header: "Stav", key: "status", width: "10%" });
  if (fields.km) cols.push({ header: "Najeto km", key: "km", align: "right", width: "9%" });
  if (fields.description) cols.push({ header: "Popis zakázky", key: "description" });
  if (fields.services) cols.push({ header: "Servisní úkony", key: "services" });
  if (fields.otherWork) cols.push({ header: "Další práce / poznámky", key: "otherWork" });
  if (fields.labor) {
    cols.push({ header: "Hodiny", key: "laborHours", align: "right", width: "7%" });
    cols.push({ header: "Cena práce", key: "laborPrice", align: "right", width: "11%" });
  }
  if (fields.materials) cols.push({ header: "Materiály", key: "materials" });
  if (fields.materialsTotal) cols.push({ header: "Materiál celkem", key: "materialsTotal", align: "right", width: "12%" });
  if (fields.total) cols.push({ header: "Celkem zakázka", key: "total", align: "right", width: "13%" });
  if (fields.photos) cols.push({ header: "Fotek", key: "photos", align: "center", width: "7%" });

  let grandLabor = 0, grandMaterial = 0;
  const bodyRows = orders.map((o) => {
    const mats = materialsMap.get(o.id) ?? [];
    const matTotal = mats.reduce((s, m) => s + (m.unitPrice ?? 0) * (parseFloat(m.quantity) || 0), 0);
    const labor = o.laborPrice ?? 0;
    grandLabor += labor;
    grandMaterial += matTotal;
    const date = o.serviceDate ?? o.completedAt ?? o.createdAt;

    const cellValue = (key: string): string => {
      switch (key) {
        case "date": return date ? format(new Date(date), "d. M. yyyy", { locale: cs }) : "";
        case "status": return STATUS_LABEL[o.status] ?? o.status;
        case "km": return o.km != null ? formatNum(o.km) : "";
        case "description": return esc(o.description ?? "");
        case "services": return esc(SERVICE_FLAGS.filter((f) => o[f.key]).map((f) => f.label).join(", "));
        case "otherWork": return esc([o.otherWork, o.otherServices].filter(Boolean).join(" — "));
        case "laborHours": return esc(o.laborHours ?? "");
        case "laborPrice": return labor ? formatCzk(labor) : "";
        case "materials": return esc(mats.map((m) => {
          const unit = m.unit ? ` ${m.unit}` : "";
          const price = m.unitPrice != null ? ` (${formatCzk(m.unitPrice)}/ks)` : "";
          return `${m.name} — ${m.quantity}${unit}${price}`;
        }).join("; "));
        case "materialsTotal": return matTotal ? formatCzk(Math.round(matTotal)) : "";
        case "total": return formatCzk(Math.round(labor + matTotal));
        case "photos": return String(o.photos?.length ?? 0);
        default: return "";
      }
    };

    return `<tr>${cols.map((c) => `<td class="${c.align ?? "left"}">${cellValue(c.key)}</td>`).join("")}</tr>`;
  }).join("");

  const showTotals = (fields.labor || fields.materialsTotal || fields.total) && orders.length > 0;
  const totalsRow = showTotals ? `
    <tr class="totals-row">
      ${cols.map((c) => {
        let v = "";
        if (c.key === cols[0].key) v = "CELKEM";
        else if (c.key === "laborPrice" && fields.labor) v = formatCzk(grandLabor);
        else if (c.key === "materialsTotal") v = formatCzk(Math.round(grandMaterial));
        else if (c.key === "total") v = formatCzk(Math.round(grandLabor + grandMaterial));
        return `<td class="${c.align ?? "left"}">${v}</td>`;
      }).join("")}
    </tr>` : "";

  const shopLine = [settings?.companyAddress, settings?.companyPhone, settings?.companyEmail].filter(Boolean).map((v) => esc(v as string)).join(" · ");
  const idLine = [settings?.companyIco ? `IČO: ${esc(settings.companyIco)}` : null, settings?.companyDic ? `DIČ: ${esc(settings.companyDic)}` : null].filter(Boolean).join(" · ");
  const companyName = esc(settings?.companyName ?? "AutoServis");

  const css = `
    @page { size: A4 landscape; margin: 12mm 10mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #111827; font-size: 10.5pt; line-height: 1.4; padding: 18px 22px; }
    .toolbar { position: sticky; top: 0; background: #f3f4f6; border-bottom: 1px solid #d1d5db; padding: 10px 16px; margin: -18px -22px 16px; display: flex; gap: 8px; justify-content: flex-end; z-index: 10; }
    .btn { background: #b91c1c; color: white; border: 0; padding: 8px 16px; border-radius: 6px; font-size: 11pt; cursor: pointer; font-weight: 500; }
    .btn.secondary { background: white; color: #111827; border: 1px solid #d1d5db; }
    .brand { background: #111827; color: white; padding: 14px 20px; display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
    .brand h1 { margin: 0; font-size: 18pt; font-weight: 700; }
    .brand .sub { font-size: 9pt; color: #d1d5db; margin-top: 2px; line-height: 1.5; }
    .brand .right { text-align: right; font-size: 9pt; color: #fca5a5; }
    .docTitle { background: #fef2f2; color: #b91c1c; padding: 10px 20px; font-size: 13pt; font-weight: 700; letter-spacing: 0.05em; border-bottom: 2px solid #b91c1c; text-align: center; }
    .info { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 14px 20px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
    .info .block .label { font-size: 8.5pt; text-transform: uppercase; color: #6b7280; letter-spacing: 0.06em; margin-bottom: 4px; font-weight: 600; }
    .info .block .row { display: flex; gap: 6px; font-size: 10pt; padding: 1px 0; }
    .info .block .row .k { color: #6b7280; min-width: 90px; }
    .info .block .row .v { color: #111827; font-weight: 500; }
    .meta { font-size: 8.5pt; color: #6b7280; padding: 6px 20px; text-align: right; border-bottom: 1px solid #e5e7eb; }
    table.data { width: 100%; border-collapse: collapse; margin: 0; }
    table.data thead th { background: #b91c1c; color: white; font-weight: 600; font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.03em; padding: 8px 6px; text-align: left; border: 1px solid #7f1d1d; }
    table.data thead th.right { text-align: right; }
    table.data thead th.center { text-align: center; }
    table.data tbody td { padding: 6px; border: 1px solid #e5e7eb; vertical-align: top; font-size: 9.5pt; word-wrap: break-word; }
    table.data tbody td.right { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    table.data tbody td.center { text-align: center; }
    table.data tbody tr:nth-child(even) td { background: #f9fafb; }
    table.data tbody tr.totals-row td { background: #fef3c7 !important; font-weight: 700; font-size: 10.5pt; border-top: 2px solid #b91c1c; border-bottom: 2px solid #b91c1c; }
    .empty { padding: 30px; text-align: center; color: #6b7280; font-style: italic; }
    .footer { margin-top: 22px; padding: 12px 20px 0; }
    .footer .note { font-size: 8.5pt; color: #6b7280; font-style: italic; margin-bottom: 36px; }
    .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; }
    .sigs .sig { border-top: 1px solid #111827; padding-top: 6px; font-size: 9pt; color: #6b7280; text-align: center; }
    @media print {
      .no-print { display: none !important; }
      body { padding: 0; }
      table.data thead { display: table-header-group; }
      table.data tbody tr { page-break-inside: avoid; }
    }
  `;

  const headerCells = cols.map((c) => `<th class="${c.align ?? "left"}" ${c.width ? `style="width:${c.width}"` : ""}>${esc(c.header)}</th>`).join("");

  const vehBlock = `
    <div class="block">
      <div class="label">Vozidlo</div>
      <div class="row"><span class="k">SPZ:</span><span class="v">${esc(vehicle.licensePlate)}</span></div>
      <div class="row"><span class="k">Vozidlo:</span><span class="v">${esc(vehicle.make)} ${esc(vehicle.model)}${vehicle.year ? `, ${vehicle.year}` : ""}</span></div>
      ${vehicle.vin ? `<div class="row"><span class="k">VIN:</span><span class="v">${esc(vehicle.vin)}</span></div>` : ""}
      ${vehicle.currentKm != null ? `<div class="row"><span class="k">Najeto:</span><span class="v">${formatNum(vehicle.currentKm)} km</span></div>` : ""}
    </div>`;

  const ownBlock = vehicle.ownerName || vehicle.ownerAddress ? `
    <div class="block">
      <div class="label">Vlastník</div>
      ${vehicle.ownerName ? `<div class="row"><span class="k">Jméno:</span><span class="v">${esc(vehicle.ownerName)}</span></div>` : ""}
      ${vehicle.ownerAddress ? `<div class="row"><span class="k">Adresa:</span><span class="v">${esc(vehicle.ownerAddress)}</span></div>` : ""}
      ${vehicle.ownerPhone ? `<div class="row"><span class="k">Telefon:</span><span class="v">${esc(vehicle.ownerPhone)}</span></div>` : ""}
      ${vehicle.ownerEmail ? `<div class="row"><span class="k">E-mail:</span><span class="v">${esc(vehicle.ownerEmail)}</span></div>` : ""}
    </div>` : "<div></div>";

  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>Servisní historie ${esc(vehicle.licensePlate)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="toolbar no-print">
    <button class="btn secondary" onclick="window.close()">Zavřít</button>
    <button class="btn" onclick="window.print()">Tisk / Uložit jako PDF</button>
  </div>
  <div class="brand">
    <div>
      <h1>${companyName}</h1>
      <div class="sub">${shopLine}</div>
      <div class="sub">${idLine}</div>
    </div>
    <div class="right">Servisní dokumentace</div>
  </div>
  <div class="docTitle">SERVISNÍ HISTORIE VOZIDLA</div>
  <div class="info">${vehBlock}${ownBlock}</div>
  <div class="meta">Vygenerováno: ${esc(format(new Date(), "d. M. yyyy HH:mm", { locale: cs }))} · Počet zakázek: ${orders.length}</div>
  ${orders.length === 0 ? `<div class="empty">Žádné zakázky pro toto vozidlo.</div>` : `
    <table class="data">
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}${totalsRow}</tbody>
    </table>`}
  <div class="footer">
    <div class="note">Tento dokument je výpisem servisních záznamů a slouží jako příloha k fakturaci.</div>
    <div class="sigs">
      <div class="sig">Podpis zákazníka, datum</div>
      <div class="sig">Podpis mechanika, datum</div>
    </div>
  </div>
</body>
</html>`;
}

export default function StatisticsPage() {
  const { toast } = useToast();
  const { data: vehicles = [] } = useListVehicles({});
  const { data: workOrders = [] } = useListWorkOrders({});
  const { data: settings } = useGetSettings();

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

      const html = buildPrintHtml({
        vehicle: selectedVehicle,
        orders: allOrders,
        materialsMap,
        fields,
        settings: settings ?? null,
      });
      const blob = new Blob(["\ufeff" + html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank", "width=1100,height=1200");
      if (!w) {
        URL.revokeObjectURL(url);
        toast({ title: "Vyskakovací okno blokováno", description: "Povolte vyskakovací okna pro tuto stránku.", variant: "destructive" });
        return;
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast({ title: "Export připraven", description: `${allOrders.length} zakázek — v okně zvolte „Uložit jako PDF".` });
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
            Vyberte vozidlo a položky, které chcete v exportu. Otevře se okno s tiskovou verzí — v dialogu prohlížeče zvolte „Uložit jako PDF" (s plnou podporou českých znaků).
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
              {exporting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Připravuji…</> : <><FileText className="h-4 w-4 mr-2" />Exportovat PDF</>}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
