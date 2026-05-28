import { useMemo, useState } from "react";
import {
  useListVehicles,
  useListWorkOrders,
  useGetSettings,
  listWorkOrderMaterials,
  getVehicle,
} from "@workspace/api-client-react";
import type { WorkOrder, Vehicle, Settings } from "@workspace/api-client-react";
import ExcelJS from "exceljs";
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

function sanitizeCell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  // Neutralize formula-injection attempts (Excel treats = + - @ as formulas)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function downloadBlob(filename: string, blob: Blob) {
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

type FieldsState = {
  date: boolean; status: boolean; km: boolean; description: boolean; services: boolean;
  otherWork: boolean; labor: boolean; materials: boolean; materialsTotal: boolean; total: boolean; photos: boolean;
};

const BRAND = {
  primary: "FFB91C1C",      // red-700
  primaryDark: "FF7F1D1D",  // red-900
  accent: "FFF59E0B",       // amber-500
  headerBg: "FF111827",     // gray-900
  headerText: "FFFFFFFF",
  zebra: "FFF9FAFB",        // gray-50
  border: "FFE5E7EB",       // gray-200
  muted: "FF6B7280",        // gray-500
  totalBg: "FFFEF3C7",      // amber-100
};

async function buildXlsx(opts: {
  vehicle: Vehicle;
  orders: WorkOrder[];
  materialsMap: Map<number, Awaited<ReturnType<typeof listWorkOrderMaterials>>>;
  fields: FieldsState;
  settings: Settings | null;
}): Promise<Blob> {
  const { vehicle, orders, materialsMap, fields, settings } = opts;
  const wb = new ExcelJS.Workbook();
  wb.creator = settings?.companyName ?? "AutoServis";
  wb.created = new Date();

  const ws = wb.addWorksheet("Servisní historie", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    properties: { defaultRowHeight: 18 },
    views: [{ state: "frozen", ySplit: 0 }],
  });

  // ---------- Build column definitions based on selected fields ----------
  type Col = { header: string; key: string; width: number; align?: "left" | "right" | "center"; money?: boolean; numeric?: boolean };
  const cols: Col[] = [];
  const idx: Record<string, number> = {};
  const add = (c: Col) => { cols.push(c); idx[c.key] = cols.length; };

  if (fields.date) add({ header: "Datum", key: "date", width: 13, align: "center" });
  if (fields.status) add({ header: "Stav", key: "status", width: 14 });
  if (fields.km) add({ header: "Najeto km", key: "km", width: 11, align: "right", numeric: true });
  if (fields.description) add({ header: "Popis zakázky", key: "description", width: 32 });
  if (fields.services) add({ header: "Servisní úkony", key: "services", width: 26 });
  if (fields.otherWork) add({ header: "Další práce / poznámky", key: "otherWork", width: 28 });
  if (fields.labor) {
    add({ header: "Hodiny", key: "laborHours", width: 9, align: "right", numeric: true });
    add({ header: "Cena práce", key: "laborPrice", width: 13, align: "right", money: true });
  }
  if (fields.materials) add({ header: "Materiály", key: "materials", width: 38 });
  if (fields.materialsTotal) add({ header: "Materiál celkem", key: "materialsTotal", width: 15, align: "right", money: true });
  if (fields.total) add({ header: "Celkem zakázka", key: "total", width: 16, align: "right", money: true });
  if (fields.photos) add({ header: "Fotky", key: "photos", width: 8, align: "center", numeric: true });

  ws.columns = cols.map((c) => ({ key: c.key, width: c.width }));
  const lastCol = cols.length;
  const lastColLetter = ws.getColumn(lastCol).letter;

  // ---------- 1) Brand header ----------
  ws.mergeCells(1, 1, 1, lastCol);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = settings?.companyName ?? "AutoServis";
  titleCell.font = { name: "Calibri", size: 22, bold: true, color: { argb: BRAND.headerText } };
  titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.headerBg } };
  ws.getRow(1).height = 38;

  // Shop sub-line
  const shopLine = [settings?.companyAddress, settings?.companyPhone, settings?.companyEmail].filter(Boolean).join(" · ");
  const idLine = [settings?.companyIco ? `IČO: ${settings.companyIco}` : null, settings?.companyDic ? `DIČ: ${settings.companyDic}` : null].filter(Boolean).join(" · ");
  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value = [shopLine, idLine].filter(Boolean).join("    ");
  sub.font = { size: 10, color: { argb: BRAND.headerText }, italic: true };
  sub.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  sub.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.primaryDark } };
  ws.getRow(2).height = 20;

  // ---------- 2) Document title row ----------
  ws.mergeCells(3, 1, 3, lastCol);
  const docTitle = ws.getCell(3, 1);
  docTitle.value = "SERVISNÍ HISTORIE VOZIDLA";
  docTitle.font = { size: 16, bold: true, color: { argb: BRAND.primary } };
  docTitle.alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(3).height = 30;

  // ---------- 3) Vehicle + owner info box (two columns) ----------
  const infoRowStart = 4;
  const mid = Math.max(1, Math.floor(lastCol / 2));
  const vehInfo = [
    ["SPZ:", vehicle.licensePlate],
    ["Vozidlo:", `${vehicle.make} ${vehicle.model}${vehicle.year ? `, ${vehicle.year}` : ""}`],
    vehicle.vin ? ["VIN:", vehicle.vin] : null,
    vehicle.currentKm != null ? ["Aktuálně najeto:", `${vehicle.currentKm.toLocaleString("cs-CZ")} km`] : null,
  ].filter(Boolean) as string[][];
  const ownInfo = [
    vehicle.ownerName ? ["Vlastník:", vehicle.ownerName] : null,
    vehicle.ownerAddress ? ["Adresa:", vehicle.ownerAddress] : null,
    vehicle.ownerPhone ? ["Telefon:", vehicle.ownerPhone] : null,
    vehicle.ownerEmail ? ["E-mail:", vehicle.ownerEmail] : null,
  ].filter(Boolean) as string[][];

  const infoLines = Math.max(vehInfo.length, ownInfo.length, 1);
  for (let i = 0; i < infoLines; i++) {
    const r = infoRowStart + i;
    const row = ws.getRow(r);
    row.height = 18;
    if (mid >= 2) ws.mergeCells(r, 2, r, mid);
    if (lastCol >= mid + 2) ws.mergeCells(r, mid + 2, r, lastCol);

    const lk = ws.getCell(r, 1);
    lk.value = vehInfo[i]?.[0] ?? "";
    lk.font = { size: 10, bold: true, color: { argb: BRAND.muted } };
    lk.alignment = { horizontal: "right", vertical: "middle" };

    const lv = ws.getCell(r, 2);
    lv.value = sanitizeCell(vehInfo[i]?.[1] ?? "");
    lv.font = { size: 11, bold: i === 0 };
    lv.alignment = { horizontal: "left", vertical: "middle", indent: 1 };

    if (lastCol >= mid + 2) {
      const rk = ws.getCell(r, mid + 1);
      rk.value = ownInfo[i]?.[0] ?? "";
      rk.font = { size: 10, bold: true, color: { argb: BRAND.muted } };
      rk.alignment = { horizontal: "right", vertical: "middle" };

      const rv = ws.getCell(r, mid + 2);
      rv.value = sanitizeCell(ownInfo[i]?.[1] ?? "");
      rv.font = { size: 11, bold: i === 0 };
      rv.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    }
  }

  // Generated line
  const genRow = infoRowStart + infoLines;
  ws.mergeCells(genRow, 1, genRow, lastCol);
  const genCell = ws.getCell(genRow, 1);
  genCell.value = `Vygenerováno: ${format(new Date(), "d. M. yyyy HH:mm", { locale: cs })}    ·    Počet zakázek: ${orders.length}`;
  genCell.font = { size: 9, italic: true, color: { argb: BRAND.muted } };
  genCell.alignment = { horizontal: "right", vertical: "middle" };
  ws.getRow(genRow).height = 16;

  // Spacer row
  const headerRowIdx = genRow + 2;

  // ---------- 4) Table header ----------
  const headerRow = ws.getRow(headerRowIdx);
  cols.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: BRAND.headerText }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.primary } };
    cell.alignment = { horizontal: c.align ?? "left", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: BRAND.primaryDark } },
      bottom: { style: "medium", color: { argb: BRAND.primaryDark } },
      left: { style: "thin", color: { argb: BRAND.primaryDark } },
      right: { style: "thin", color: { argb: BRAND.primaryDark } },
    };
  });
  headerRow.height = 28;

  // ---------- 5) Data rows ----------
  let grandLabor = 0, grandMaterial = 0;
  let r = headerRowIdx + 1;
  orders.forEach((o, i) => {
    const mats = materialsMap.get(o.id) ?? [];
    const matTotal = mats.reduce((s, m) => s + (m.unitPrice ?? 0) * (parseFloat(m.quantity) || 0), 0);
    const labor = o.laborPrice ?? 0;
    grandLabor += labor;
    grandMaterial += matTotal;
    const date = o.serviceDate ?? o.completedAt ?? o.createdAt;

    const data: Record<string, any> = {};
    if (fields.date) data.date = date ? format(new Date(date), "d. M. yyyy", { locale: cs }) : "";
    if (fields.status) data.status = STATUS_LABEL[o.status] ?? o.status;
    if (fields.km) data.km = o.km ?? null;
    if (fields.description) data.description = sanitizeCell(o.description ?? "");
    if (fields.services) data.services = SERVICE_FLAGS.filter((f) => o[f.key]).map((f) => f.label).join(", ");
    if (fields.otherWork) data.otherWork = sanitizeCell([o.otherWork, o.otherServices].filter(Boolean).join(" — "));
    if (fields.labor) {
      data.laborHours = o.laborHours ? Number(o.laborHours) || sanitizeCell(o.laborHours) : null;
      data.laborPrice = labor || null;
    }
    if (fields.materials) {
      data.materials = sanitizeCell(mats.map((m) => {
        const qty = m.quantity;
        const unit = m.unit ? ` ${m.unit}` : "";
        const price = m.unitPrice != null ? ` (${m.unitPrice} Kč/ks)` : "";
        return `${m.name} — ${qty}${unit}${price}`;
      }).join("; "));
    }
    if (fields.materialsTotal) data.materialsTotal = matTotal || null;
    if (fields.total) data.total = Math.round(labor + matTotal) || null;
    if (fields.photos) data.photos = o.photos?.length ?? 0;

    const row = ws.getRow(r);
    cols.forEach((c, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = data[c.key] ?? "";
      cell.alignment = { horizontal: c.align ?? "left", vertical: "top", wrapText: !c.numeric && !c.money };
      cell.font = { size: 10 };
      if (c.money) cell.numFmt = '#,##0" Kč"';
      else if (c.numeric) cell.numFmt = "#,##0";
      if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.zebra } };
      cell.border = {
        top: { style: "thin", color: { argb: BRAND.border } },
        bottom: { style: "thin", color: { argb: BRAND.border } },
        left: { style: "thin", color: { argb: BRAND.border } },
        right: { style: "thin", color: { argb: BRAND.border } },
      };
    });
    // Auto-ish row height based on longest wrap field
    const wrapLengths = ["description", "services", "otherWork", "materials"]
      .filter((k) => idx[k])
      .map((k) => String(data[k] ?? "").length);
    const maxLen = wrapLengths.length ? Math.max(...wrapLengths) : 0;
    row.height = Math.min(80, Math.max(20, Math.ceil(maxLen / 40) * 16));
    r++;
  });

  // ---------- 6) Totals row ----------
  const showTotals = (fields.labor || fields.materialsTotal || fields.total) && orders.length > 0;
  if (showTotals) {
    const totalRow = ws.getRow(r);
    cols.forEach((c, ci) => {
      const cell = totalRow.getCell(ci + 1);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.totalBg } };
      cell.font = { bold: true, size: 11 };
      cell.border = {
        top: { style: "medium", color: { argb: BRAND.primary } },
        bottom: { style: "medium", color: { argb: BRAND.primary } },
        left: { style: "thin", color: { argb: BRAND.border } },
        right: { style: "thin", color: { argb: BRAND.border } },
      };
      cell.alignment = { horizontal: c.align ?? "left", vertical: "middle" };
      if (c.money) cell.numFmt = '#,##0" Kč"';
    });
    totalRow.getCell(1).value = "CELKEM";
    if (idx.laborPrice) totalRow.getCell(idx.laborPrice).value = grandLabor || null;
    if (idx.materialsTotal) totalRow.getCell(idx.materialsTotal).value = Math.round(grandMaterial) || null;
    if (idx.total) totalRow.getCell(idx.total).value = Math.round(grandLabor + grandMaterial) || null;
    totalRow.height = 24;
    r++;
  }

  // ---------- 7) Footer / signature area ----------
  r += 1;
  ws.mergeCells(r, 1, r, lastCol);
  const note = ws.getCell(r, 1);
  note.value = "Tento dokument je výpisem servisních záznamů a slouží jako příloha k fakturaci.";
  note.font = { size: 9, italic: true, color: { argb: BRAND.muted } };
  note.alignment = { horizontal: "left", vertical: "middle" };
  r += 3;

  if (lastCol >= 4) {
    const half = Math.max(2, Math.floor(lastCol / 2));
    ws.mergeCells(r, 1, r, half);
    ws.mergeCells(r, half + 1, r, lastCol);
    const s1 = ws.getCell(r, 1);
    const s2 = ws.getCell(r, half + 1);
    [s1, s2].forEach((c) => {
      c.border = { top: { style: "thin", color: { argb: "FF000000" } } };
      c.font = { size: 9, color: { argb: BRAND.muted } };
      c.alignment = { horizontal: "center", vertical: "top" };
    });
    s1.value = "Podpis zákazníka, datum";
    s2.value = "Podpis mechanika, datum";
  }

  // Print area
  ws.pageSetup.printArea = `A1:${lastColLetter}${r}`;
  // Repeat header rows when printing
  ws.pageSetup.printTitlesRow = `${headerRowIdx}:${headerRowIdx}`;

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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

      const blob = await buildXlsx({
        vehicle: selectedVehicle,
        orders: allOrders,
        materialsMap,
        fields,
        settings: settings ?? null,
      });
      const fname = `servisni-historie_${selectedVehicle.licensePlate.replace(/\s+/g, "")}_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
      downloadBlob(fname, blob);
      toast({ title: "Export hotov", description: `${allOrders.length} zakázek exportováno do Excelu.` });
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
            Vyberte vozidlo a položky, které chcete v exportu. Soubor se stáhne jako formátovaný Excel (.xlsx) s hlavičkou dílny, barevnými řádky a souhrnem.
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
              {exporting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Připravuji…</> : <><Download className="h-4 w-4 mr-2" />Stáhnout Excel</>}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
