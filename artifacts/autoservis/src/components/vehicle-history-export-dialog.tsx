import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Printer, FileDown, Loader2 } from "lucide-react";
import type { VehicleDetail, WorkOrder, WorkOrderMaterial, Settings, ServiceRecord } from "@workspace/api-client-react";
import { listWorkOrderMaterials } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { cs } from "date-fns/locale";

const STATUS_LABEL: Record<string, string> = {
  open: "Otevřená",
  in_progress: "Probíhá",
  waiting_parts: "Čeká na díly",
  needs_return: "Nutný návrat",
  completed: "Dokončená",
};

type ExportOptions = {
  shopHeader: boolean;
  vehicleInfo: boolean;
  ownerInfo: boolean;
  serviceStatus: boolean;
  workOrders: boolean;
  serviceItems: boolean;
  materials: boolean;
  materialPrices: boolean;
  labor: boolean;
  perOrderTotal: boolean;
  grandTotal: boolean;
  serviceRecords: boolean;
  signature: boolean;
};

const FIELDS: Array<{ key: keyof ExportOptions; label: string; hint?: string }> = [
  { key: "shopHeader", label: "Hlavička dílny", hint: "Název, adresa, IČO, DIČ" },
  { key: "vehicleInfo", label: "Údaje o vozidle", hint: "SPZ, značka, model, VIN" },
  { key: "ownerInfo", label: "Údaje o vlastníkovi", hint: "Jméno, adresa, kontakt" },
  { key: "serviceStatus", label: "Aktuální stav servisu", hint: "STK, olej, brzdy, rozvody" },
  { key: "workOrders", label: "Seznam zakázek (vždy)" },
  { key: "serviceItems", label: "Provedené úkony u zakázek" },
  { key: "materials", label: "Materiály v zakázkách" },
  { key: "materialPrices", label: "Ceny materiálu" },
  { key: "labor", label: "Práce (hodiny a cena)" },
  { key: "perOrderTotal", label: "Celkem za jednotlivou zakázku" },
  { key: "grandTotal", label: "Celkový součet za všechny zakázky" },
  { key: "serviceRecords", label: "Záznamy servisu (mimo zakázky)" },
  { key: "signature", label: "Místo pro podpis" },
];

function fmtCzk(n: number): string {
  return new Intl.NumberFormat("cs-CZ").format(Math.round(n)) + " Kč";
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const SERVICE_FLAGS: Array<[keyof WorkOrder, string]> = [
  ["oilChange", "Olej motor"],
  ["transmissionOil", "Olej převodovka"],
  ["brakes", "Brzdy"],
  ["timing", "Rozvody"],
  ["airFilter", "Filtr vzduchový"],
  ["cabinFilter", "Filtr kabinový"],
  ["stk", "STK"],
];

function buildHtml(opts: {
  vehicle: VehicleDetail;
  orders: WorkOrder[];
  materialsByOrder: Map<number, WorkOrderMaterial[]>;
  serviceRecords: ServiceRecord[];
  settings: Settings | null | undefined;
  options: ExportOptions;
}): string {
  const { vehicle, orders, materialsByOrder, serviceRecords, settings, options } = opts;

  const css = `
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; margin: 0; padding: 24px; font-size: 11pt; line-height: 1.4; }
    h1 { font-size: 20pt; margin: 0 0 4px; }
    h2 { font-size: 13pt; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #d4d4d8; }
    h3 { font-size: 11.5pt; margin: 8px 0 4px; }
    .row { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
    .muted { color: #6b7280; font-size: 9.5pt; }
    .meta { text-align: right; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; }
    .box .label { font-size: 9pt; text-transform: uppercase; color: #6b7280; letter-spacing: 0.04em; margin-bottom: 2px; }
    .order { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; margin: 10px 0; page-break-inside: avoid; }
    .order .order-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; margin-bottom: 6px; }
    .order .order-head .left { font-weight: 600; font-size: 11.5pt; }
    .order .order-head .right { color: #6b7280; font-size: 10pt; white-space: nowrap; }
    table { width: 100%; border-collapse: collapse; margin: 4px 0 6px; }
    th, td { padding: 4px 6px; text-align: left; border-bottom: 1px solid #f1f5f9; vertical-align: top; font-size: 10pt; }
    th { background: #f3f4f6; font-size: 9.5pt; }
    td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    ul.checks { list-style: none; padding: 0; margin: 4px 0; }
    ul.checks li { display: inline-block; padding: 1px 8px 1px 0; }
    ul.checks li::before { content: "✓ "; color: #16a34a; font-weight: bold; }
    .order-total { text-align: right; font-weight: 600; margin-top: 4px; }
    .totals { margin-top: 12px; width: 360px; margin-left: auto; }
    .totals td { border: none; padding: 4px 8px; }
    .totals tr.grand td { border-top: 2px solid #111; font-weight: bold; font-size: 13pt; padding-top: 8px; }
    .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 32px; }
    .sig .line { border-top: 1px solid #111; margin-top: 48px; padding-top: 4px; font-size: 10pt; color: #6b7280; }
    @media print {
      body { padding: 14mm; font-size: 10.5pt; }
      .no-print { display: none; }
      h2 { page-break-after: avoid; }
    }
    .toolbar { position: sticky; top: 0; background: #f9fafb; border-bottom: 1px solid #e5e7eb; padding: 10px 16px; margin: -24px -24px 16px; display: flex; gap: 8px; justify-content: flex-end; }
    .btn { background: #111; color: white; border: 0; padding: 8px 14px; border-radius: 6px; font-size: 11pt; cursor: pointer; }
    .btn.secondary { background: white; color: #111; border: 1px solid #d4d4d8; }
  `;

  const shopHeader = options.shopHeader && settings ? `
    <div>
      ${settings.companyName ? `<div style="font-weight:600">${esc(settings.companyName)}</div>` : ""}
      ${settings.companyAddress ? `<div class="muted">${esc(settings.companyAddress)}</div>` : ""}
      <div class="muted">${[settings.companyPhone, settings.companyEmail].filter(Boolean).map((v) => esc(v as string)).join(" · ")}</div>
      <div class="muted">${[settings.companyIco ? `IČO: ${esc(settings.companyIco)}` : null, settings.companyDic ? `DIČ: ${esc(settings.companyDic)}` : null].filter(Boolean).join(" · ")}</div>
    </div>` : "<div></div>";

  const vehicleBlock = options.vehicleInfo ? `
    <div class="box">
      <div class="label">Vozidlo</div>
      <div style="font-size:13pt;font-weight:600">${esc(vehicle.licensePlate)}</div>
      <div>${esc(vehicle.make)} ${esc(vehicle.model)}${vehicle.year ? `, ${vehicle.year}` : ""}</div>
      ${vehicle.vin ? `<div class="muted">VIN: ${esc(vehicle.vin)}</div>` : ""}
      ${vehicle.engineDisplacement ? `<div class="muted">Objem: ${vehicle.engineDisplacement} cm³</div>` : ""}
      ${vehicle.currentKm != null ? `<div class="muted">Najeto: ${vehicle.currentKm.toLocaleString("cs-CZ")} km</div>` : ""}
    </div>` : "";

  const ownerBlock = options.ownerInfo && (vehicle.ownerName || vehicle.ownerAddress) ? `
    <div class="box">
      <div class="label">Vlastník</div>
      ${vehicle.ownerName ? `<div style="font-weight:600">${esc(vehicle.ownerName)}</div>` : ""}
      ${vehicle.ownerAddress ? `<div class="muted">${esc(vehicle.ownerAddress)}</div>` : ""}
      <div class="muted">${[vehicle.ownerPhone, vehicle.ownerEmail].filter(Boolean).map((v) => esc(v as string)).join(" · ")}</div>
      <div class="muted">${[vehicle.ownerIco ? `IČO: ${esc(vehicle.ownerIco)}` : null, vehicle.ownerDic ? `DIČ: ${esc(vehicle.ownerDic)}` : null].filter(Boolean).join(" · ")}</div>
    </div>` : "";

  const dateOnly = (s?: string | null) => {
    if (!s) return "";
    try { return format(parseISO(s), "d. M. yyyy", { locale: cs }); } catch { return s; }
  };

  const statusHtml = options.serviceStatus ? `
    <h2>Aktuální stav servisu</h2>
    <table>
      <tr><td>STK platná do</td><td>${dateOnly(vehicle.stkValidUntil) || "-"}</td></tr>
      <tr><td>Poslední výměna oleje</td><td>${dateOnly(vehicle.lastOilChangeDate) || "-"}${vehicle.lastOilChangeKm != null ? ` (${vehicle.lastOilChangeKm.toLocaleString("cs-CZ")} km)` : ""}</td></tr>
      <tr><td>Poslední servis brzd</td><td>${dateOnly(vehicle.lastBrakesDate) || "-"}</td></tr>
      <tr><td>Poslední výměna rozvodů</td><td>${dateOnly(vehicle.lastTimingDate) || "-"}</td></tr>
      ${vehicle.transmission === "automatic" ? `<tr><td>Poslední olej v převodovce</td><td>${dateOnly(vehicle.lastTransmissionOilDate) || "-"}${vehicle.lastTransmissionOilKm != null ? ` (${vehicle.lastTransmissionOilKm.toLocaleString("cs-CZ")} km)` : ""}</td></tr>` : ""}
    </table>
  ` : "";

  let grandLabor = 0, grandMaterial = 0;
  const ordersHtml = orders.length > 0 ? orders.map((o) => {
    const mats = materialsByOrder.get(o.id) ?? [];
    const matTotal = mats.reduce((s, m) => s + (m.unitPrice ?? 0) * (parseFloat(m.quantity) || 0), 0);
    const laborPrice = o.laborPrice ?? 0;
    grandLabor += options.labor ? laborPrice : 0;
    grandMaterial += options.materials ? matTotal : 0;
    const orderTotal = (options.labor ? laborPrice : 0) + (options.materials ? matTotal : 0);

    const date = o.serviceDate ?? o.completedAt ?? o.createdAt;
    const performed = SERVICE_FLAGS.filter(([k]) => o[k]).map(([, l]) => l);

    return `
      <div class="order">
        <div class="order-head">
          <div class="left">Zakázka #${o.id} · ${dateOnly(date)}</div>
          <div class="right">${STATUS_LABEL[o.status] ?? o.status}${o.km != null ? ` · ${o.km.toLocaleString("cs-CZ")} km` : ""}</div>
        </div>
        ${o.description ? `<div style="margin-bottom:4px">${esc(o.description)}</div>` : ""}
        ${options.serviceItems && performed.length > 0 ? `<ul class="checks">${performed.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
        ${options.serviceItems && o.otherServices ? `<div class="muted"><strong>Další úkony:</strong> ${esc(o.otherServices)}</div>` : ""}
        ${options.serviceItems && o.otherWork ? `<div class="muted"><strong>Ostatní práce:</strong> ${esc(o.otherWork)}</div>` : ""}
        ${options.materials && mats.length > 0 ? `
          <table>
            <thead><tr><th>Materiál</th><th class="num">Množství</th>${options.materialPrices ? `<th class="num">Cena / ks</th><th class="num">Celkem</th>` : ""}</tr></thead>
            <tbody>
              ${mats.map((m) => {
                const qty = parseFloat(m.quantity) || 0;
                const total = (m.unitPrice ?? 0) * qty;
                return `<tr>
                  <td>${esc(m.name)}</td>
                  <td class="num">${esc(m.quantity)}${m.unit ? ` ${esc(m.unit)}` : ""}</td>
                  ${options.materialPrices ? `<td class="num">${m.unitPrice != null ? fmtCzk(m.unitPrice) : "-"}</td><td class="num">${fmtCzk(total)}</td>` : ""}
                </tr>`;
              }).join("")}
            </tbody>
          </table>` : ""}
        ${options.labor && (o.laborHours || laborPrice) ? `<div class="muted">Práce: ${o.laborHours ?? "-"} h${laborPrice ? ` · ${fmtCzk(laborPrice)}` : ""}</div>` : ""}
        ${options.perOrderTotal && orderTotal > 0 ? `<div class="order-total">Celkem za zakázku: ${fmtCzk(orderTotal)}</div>` : ""}
      </div>
    `;
  }).join("") : `<p class="muted">Žádné zakázky.</p>`;

  const grandTotal = grandLabor + grandMaterial;
  const totalsHtml = options.grandTotal && grandTotal > 0 ? `
    <table class="totals">
      ${options.materials && grandMaterial > 0 ? `<tr><td>Materiál celkem</td><td class="num">${fmtCzk(grandMaterial)}</td></tr>` : ""}
      ${options.labor && grandLabor > 0 ? `<tr><td>Práce celkem</td><td class="num">${fmtCzk(grandLabor)}</td></tr>` : ""}
      <tr class="grand"><td>Celkem za období</td><td class="num">${fmtCzk(grandTotal)}</td></tr>
    </table>
  ` : "";

  const recordsHtml = options.serviceRecords && serviceRecords.length > 0 ? `
    <h2>Další servisní záznamy</h2>
    <table>
      <thead><tr><th>Datum</th><th>Km</th><th>Popis / úkony</th><th>Technik</th></tr></thead>
      <tbody>
        ${serviceRecords.map((r) => {
          const ops = [
            r.oilChanged ? "olej" : null,
            r.brakesServiced ? "brzdy" : null,
            r.timingServiced ? "rozvody" : null,
            r.transmissionOilChanged ? "převodovka" : null,
            r.stkPassed ? "STK" : null,
          ].filter(Boolean).join(", ");
          const text = [r.description, ops, r.otherWork].filter(Boolean).join(" — ");
          return `<tr>
            <td>${dateOnly(r.date)}</td>
            <td class="num">${r.km != null ? r.km.toLocaleString("cs-CZ") : "-"}</td>
            <td>${esc(text)}</td>
            <td>${r.technician ? esc(r.technician) : "-"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  ` : "";

  const signatureHtml = options.signature ? `
    <div class="sig">
      <div><div class="line">Podpis zákazníka, datum</div></div>
      <div><div class="line">Podpis mechanika, datum</div></div>
    </div>` : "";

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
  <div class="row">
    ${shopHeader}
    <div class="meta">
      <h1>Servisní historie</h1>
      <div class="muted">${esc(vehicle.licensePlate)} · ${esc(vehicle.make)} ${esc(vehicle.model)}</div>
      <div class="muted">Vygenerováno: ${format(new Date(), "d. M. yyyy", { locale: cs })}</div>
    </div>
  </div>
  ${(vehicleBlock || ownerBlock) ? `<div class="grid2" style="margin-top:16px">${vehicleBlock}${ownerBlock}</div>` : ""}
  ${statusHtml}
  ${options.workOrders ? `<h2>Servisní zakázky (${orders.length})</h2>${ordersHtml}${totalsHtml}` : ""}
  ${recordsHtml}
  ${signatureHtml}
</body>
</html>`;
}

type Props = {
  vehicle: VehicleDetail;
  settings: Settings | null | undefined;
  trigger: React.ReactNode;
};

export function VehicleHistoryExportDialog({ vehicle, settings, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [opts, setOpts] = useState<ExportOptions>({
    shopHeader: true,
    vehicleInfo: true,
    ownerInfo: true,
    serviceStatus: true,
    workOrders: true,
    serviceItems: true,
    materials: true,
    materialPrices: true,
    labor: true,
    perOrderTotal: true,
    grandTotal: true,
    serviceRecords: true,
    signature: true,
  });

  function toggle(k: keyof ExportOptions) {
    setOpts((o) => ({ ...o, [k]: !o[k] }));
  }

  async function handlePrint() {
    setPreparing(true);
    try {
      const orders = [...(vehicle.completedWorkOrders ?? []), ...(vehicle.openWorkOrders ?? [])]
        .sort((a, b) => {
          const da = new Date(a.serviceDate ?? a.completedAt ?? a.createdAt).getTime();
          const db = new Date(b.serviceDate ?? b.completedAt ?? b.createdAt).getTime();
          return db - da;
        });

      const needsMaterials = opts.materials || opts.perOrderTotal || opts.grandTotal;
      const materialsByOrder = new Map<number, WorkOrderMaterial[]>();
      if (needsMaterials) {
        await Promise.all(
          orders.map(async (o) => {
            try { materialsByOrder.set(o.id, await listWorkOrderMaterials(o.id)); }
            catch { materialsByOrder.set(o.id, []); }
          }),
        );
      }

      const html = buildHtml({
        vehicle,
        orders,
        materialsByOrder,
        serviceRecords: vehicle.serviceRecords ?? [],
        settings,
        options: opts,
      });

      const w = window.open("", "_blank", "width=900,height=1100");
      if (!w) {
        alert("Vyskakovací okno bylo zablokováno. Povolte vyskakovací okna pro tuto stránku.");
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      setOpen(false);
    } finally {
      setPreparing(false);
    }
  }

  const count = Object.values(opts).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileDown className="h-5 w-5" /> Export servisní historie vozidla</DialogTitle>
          <DialogDescription>
            Vyberte, co má dokument obsahovat. Otevře se okno s tiskovou verzí — v dialogu prohlížeče zvolte „Uložit jako PDF" a přiložte k faktuře.
          </DialogDescription>
        </DialogHeader>

        <div className="grid sm:grid-cols-2 gap-2 max-h-[60vh] overflow-auto">
          {FIELDS.map((f) => (
            <label key={f.key} className="flex items-start gap-2 p-3 border rounded-md hover:bg-accent cursor-pointer">
              <Checkbox checked={opts[f.key]} onCheckedChange={() => toggle(f.key)} className="mt-0.5" />
              <span>
                <Label className="cursor-pointer">{f.label}</Label>
                {f.hint && <span className="block text-xs text-muted-foreground mt-0.5">{f.hint}</span>}
              </span>
            </label>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <span className="text-sm text-muted-foreground mr-auto self-center">Vybráno: {count}</span>
          <Button variant="outline" onClick={() => setOpen(false)}>Zrušit</Button>
          <Button onClick={handlePrint} disabled={count === 0 || preparing}>
            {preparing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Připravuji…</> : <><Printer className="h-4 w-4 mr-2" /> Otevřít k tisku</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
