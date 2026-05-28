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

function plateHtml(plate: string, size: "md" | "lg" = "md"): string {
  const cleaned = (plate ?? "").replace(/\s+/g, "").toUpperCase();
  const formatted = cleaned.length === 7
    ? cleaned.slice(0, 3) + " " + cleaned.slice(3)
    : cleaned.length === 8
      ? cleaned.slice(0, 4) + " " + cleaned.slice(4)
      : cleaned;
  const stars = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * 2 * Math.PI - Math.PI / 2;
    const r = 5;
    const cx = 6 + Math.cos(a) * r;
    const cy = 6 + Math.sin(a) * r;
    return `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="0.8" fill="#FFCC00"/>`;
  }).join("");
  return `<span class="lp lp-${size}"><span class="lp-eu"><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">${stars}</svg><span class="lp-cz">CZ</span></span><span class="lp-num">${esc(formatted)}</span></span>`;
}

const PLATE_CSS = `
  .lp { display:inline-flex; align-items:stretch; border:1px solid #d4d4d8; border-radius:3px; background:white; overflow:hidden; vertical-align:middle; line-height:1; box-shadow:0 1px 2px rgba(0,0,0,0.06); }
  .lp-md { height:22pt; } .lp-lg { height:30pt; }
  .lp-eu { display:flex; flex-direction:column; align-items:center; justify-content:center; background:#003399; color:white; gap:1px; padding:2px 0; }
  .lp-md .lp-eu { width:16pt; } .lp-lg .lp-eu { width:22pt; }
  .lp-cz { font-weight:700; letter-spacing:0.5px; font-family:Arial,sans-serif; }
  .lp-md .lp-cz { font-size:7pt; } .lp-lg .lp-cz { font-size:9pt; }
  .lp-num { display:flex; align-items:center; color:#000; font-weight:700; letter-spacing:0.05em; font-family:"Courier New", Consolas, monospace; }
  .lp-md .lp-num { padding:0 8pt; font-size:13pt; }
  .lp-lg .lp-num { padding:0 12pt; font-size:18pt; }
`;

const SERVICE_FLAGS: Array<[keyof WorkOrder, string]> = [
  ["oilChange", "Olej motor"],
  ["transmissionOil", "Olej převodovka"],
  ["brakes", "Brzdy"],
  ["timing", "Rozvody"],
  ["airFilter", "Filtr vzduchový"],
  ["cabinFilter", "Filtr kabinový"],
  ["brakeFluid", "Brzdová kapalina"],
  ["tireChange", "Přezutí pneumatik"],
  ["diagnostics", "Diagnostika"],
  ["lightsCheck", "Kontrola osvětlení"],
  ["frontAxleCheck", "Přední náprava"],
  ["rearAxleCheck", "Zadní náprava"],
  ["frontShocksCheck", "Přední tlumiče"],
  ["rearShocksCheck", "Zadní tlumiče"],
  ["geometry", "Geometrie"],
  ["headlightAlignment", "Seřízení světlometů"],
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
    @page { size: A4 portrait; margin: 14mm 12mm 16mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #f3f4f6; }
    body { font-family: "Segoe UI", -apple-system, "Helvetica Neue", Roboto, Arial, sans-serif; color: #1f2937; font-size: 10.5pt; line-height: 1.5; }
    .page { max-width: 210mm; margin: 0 auto; background: white; padding: 22px 26px 30px; box-shadow: 0 2px 18px rgba(15, 23, 42, 0.08); }

    .toolbar { position: sticky; top: 0; z-index: 20; background: rgba(255,255,255,0.95); backdrop-filter: blur(6px); border-bottom: 1px solid #e5e7eb; padding: 10px 16px; margin: -22px -26px 18px; display: flex; gap: 8px; justify-content: flex-end; }
    .btn { background: #b91c1c; color: white; border: 0; padding: 8px 16px; border-radius: 6px; font-size: 10.5pt; cursor: pointer; font-weight: 500; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
    .btn.secondary { background: white; color: #1f2937; border: 1px solid #d1d5db; }

    .brand { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; padding-bottom: 12px; border-bottom: 3px solid #b91c1c; margin-bottom: 16px; }
    .brand .name { font-size: 18pt; font-weight: 700; color: #0f172a; letter-spacing: -0.01em; margin-bottom: 4px; }
    .brand .lines { font-size: 9pt; color: #6b7280; line-height: 1.55; }
    .brand .badge { text-align: right; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #b91c1c; font-weight: 600; padding-top: 4px; }
    .brand .badge .date { display: block; margin-top: 6px; color: #6b7280; font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 9pt; }

    .doc-title { text-align: center; margin: 18px 0 14px; }
    .doc-title h1 { font-size: 17pt; font-weight: 700; margin: 0; color: #0f172a; letter-spacing: 0.02em; }
    .doc-title .subtitle { font-size: 10pt; color: #6b7280; margin-top: 4px; }

    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 14px 0; }
    .info-card { background: #f9fafb; border: 1px solid #e5e7eb; border-left: 3px solid #b91c1c; border-radius: 8px; padding: 12px 14px; }
    .info-card .label { font-size: 8pt; text-transform: uppercase; color: #9ca3af; letter-spacing: 0.1em; margin-bottom: 6px; font-weight: 600; }
    .info-card .primary { font-size: 12.5pt; font-weight: 700; color: #0f172a; margin-bottom: 3px; }
    .info-card .secondary { font-size: 10pt; color: #374151; margin-bottom: 2px; }
    .info-card .muted { font-size: 9pt; color: #6b7280; }

    h2.section { font-size: 11pt; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.08em; margin: 22px 0 10px; padding-left: 10px; border-left: 3px solid #b91c1c; }

    .status-table { width: 100%; border-collapse: collapse; background: #fafafa; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
    .status-table td { padding: 7px 12px; border-bottom: 1px solid #f1f5f9; font-size: 10pt; }
    .status-table tr:last-child td { border-bottom: none; }
    .status-table td:first-child { color: #6b7280; width: 45%; }
    .status-table td:last-child { color: #1f2937; font-weight: 500; text-align: right; }

    .order { border: 1px solid #e5e7eb; border-radius: 8px; margin: 12px 0; page-break-inside: avoid; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
    .order .order-head { background: linear-gradient(to right, #fef2f2, #fafafa); padding: 10px 14px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
    .order .order-head .left { font-weight: 700; font-size: 11pt; color: #0f172a; }
    .order .order-head .left .label { color: #b91c1c; text-transform: uppercase; font-size: 8.5pt; letter-spacing: 0.08em; display: block; font-weight: 600; margin-bottom: 1px; }
    .order .order-head .right { font-size: 9.5pt; color: #6b7280; white-space: nowrap; text-align: right; }
    .order .order-head .right .pill { display: inline-block; background: white; border: 1px solid #d1d5db; color: #374151; padding: 1px 8px; border-radius: 10px; font-size: 8.5pt; font-weight: 500; margin-left: 6px; }
    .order .body { padding: 10px 14px 12px; }
    .order .desc { font-size: 10pt; color: #1f2937; margin: 2px 0 8px; }

    ul.checks { list-style: none; padding: 0; margin: 6px 0; }
    ul.checks li { display: inline-block; margin: 2px 6px 2px 0; padding: 2px 9px 2px 7px; background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; border-radius: 12px; font-size: 9pt; font-weight: 500; }
    ul.checks li::before { content: "✓ "; }

    .meta-line { font-size: 9pt; color: #6b7280; margin: 3px 0; }
    .meta-line strong { color: #374151; font-weight: 600; }

    table.mat { width: 100%; border-collapse: collapse; margin: 8px 0 4px; border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden; }
    table.mat th { background: #f3f4f6; padding: 5px 8px; text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
    table.mat td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; font-size: 9.5pt; vertical-align: top; }
    table.mat tbody tr:last-child td { border-bottom: none; }
    table.mat td.num, table.mat th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

    .order-total { text-align: right; font-size: 10.5pt; font-weight: 700; color: #0f172a; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #d1d5db; }
    .order-total .sum { color: #b91c1c; font-size: 11pt; }

    .totals { margin: 18px 0 0 auto; width: 320px; background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 8px 14px; }
    .totals table { width: 100%; border-collapse: collapse; }
    .totals td { padding: 4px 0; font-size: 10pt; color: #78350f; }
    .totals td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    .totals tr.grand td { border-top: 2px solid #f59e0b; padding-top: 8px; margin-top: 4px; font-size: 13pt; font-weight: 700; color: #78350f; }

    .records-table { width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
    .records-table th { background: #f3f4f6; padding: 7px 10px; text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
    .records-table td { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; font-size: 9.5pt; vertical-align: top; }
    .records-table tbody tr:nth-child(even) td { background: #fafafa; }
    .records-table td.num { text-align: right; font-variant-numeric: tabular-nums; }

    .footer-note { margin-top: 24px; padding: 10px 14px; background: #f9fafb; border-left: 3px solid #d1d5db; border-radius: 4px; font-size: 8.5pt; color: #6b7280; font-style: italic; }
    .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 50px; margin-top: 34px; }
    .sig .line { border-top: 1px solid #1f2937; margin-top: 42px; padding-top: 6px; font-size: 9pt; color: #6b7280; text-align: center; }

    @media print {
      html, body { background: white; }
      .page { box-shadow: none; max-width: none; padding: 0; }
      .no-print { display: none !important; }
      h2.section { page-break-after: avoid; }
      .order { page-break-inside: avoid; box-shadow: none; }
      .totals { page-break-inside: avoid; }
    }
    ${PLATE_CSS}
  `;

  const shopHeader = options.shopHeader && settings ? `
    <div>
      ${settings.companyName ? `<div class="name">${esc(settings.companyName)}</div>` : ""}
      <div class="lines">
        ${settings.companyAddress ? `${esc(settings.companyAddress)}<br/>` : ""}
        ${[settings.companyPhone, settings.companyEmail].filter(Boolean).map((v) => esc(v as string)).join(" · ")}
        ${(settings.companyIco || settings.companyDic) ? `<br/>${[settings.companyIco ? `IČO: ${esc(settings.companyIco)}` : null, settings.companyDic ? `DIČ: ${esc(settings.companyDic)}` : null].filter(Boolean).join(" · ")}` : ""}
      </div>
    </div>` : `<div><div class="name">AutoServis</div></div>`;

  const vehicleBlock = options.vehicleInfo ? `
    <div class="info-card">
      <div class="label">Vozidlo</div>
      <div style="margin:2px 0 6px">${plateHtml(vehicle.licensePlate, "lg")}</div>
      <div class="secondary">${esc(vehicle.make)} ${esc(vehicle.model)}${vehicle.year ? `, ${vehicle.year}` : ""}</div>
      ${vehicle.vin ? `<div class="muted">VIN: ${esc(vehicle.vin)}</div>` : ""}
      ${vehicle.engineDisplacement ? `<div class="muted">Objem: ${vehicle.engineDisplacement} cm³</div>` : ""}
      ${vehicle.currentKm != null ? `<div class="muted">Najeto: ${vehicle.currentKm.toLocaleString("cs-CZ")} km</div>` : ""}
    </div>` : "";

  const ownerBlock = options.ownerInfo && (vehicle.ownerName || vehicle.ownerAddress) ? `
    <div class="info-card">
      <div class="label">Vlastník</div>
      ${vehicle.ownerName ? `<div class="primary">${esc(vehicle.ownerName)}</div>` : ""}
      ${vehicle.ownerAddress ? `<div class="secondary">${esc(vehicle.ownerAddress)}</div>` : ""}
      ${(vehicle.ownerPhone || vehicle.ownerEmail) ? `<div class="muted">${[vehicle.ownerPhone, vehicle.ownerEmail].filter(Boolean).map((v) => esc(v as string)).join(" · ")}</div>` : ""}
      ${(vehicle.ownerIco || vehicle.ownerDic) ? `<div class="muted">${[vehicle.ownerIco ? `IČO: ${esc(vehicle.ownerIco)}` : null, vehicle.ownerDic ? `DIČ: ${esc(vehicle.ownerDic)}` : null].filter(Boolean).join(" · ")}</div>` : ""}
    </div>` : "";

  const dateOnly = (s?: string | null) => {
    if (!s) return "";
    try { return format(parseISO(s), "d. M. yyyy", { locale: cs }); } catch { return s; }
  };

  const statusHtml = options.serviceStatus ? `
    <h2 class="section">Aktuální stav servisu</h2>
    <table class="status-table">
      <tr><td>STK platná do</td><td>${dateOnly(vehicle.stkValidUntil) || "—"}</td></tr>
      <tr><td>Poslední výměna oleje</td><td>${dateOnly(vehicle.lastOilChangeDate) || "—"}${vehicle.lastOilChangeKm != null ? ` (${vehicle.lastOilChangeKm.toLocaleString("cs-CZ")} km)` : ""}</td></tr>
      <tr><td>Poslední servis brzd</td><td>${dateOnly(vehicle.lastBrakesDate) || "—"}</td></tr>
      <tr><td>Poslední výměna rozvodů</td><td>${dateOnly(vehicle.lastTimingDate) || "—"}</td></tr>
      <tr><td>Poslední výměna brzdové kapaliny</td><td>${dateOnly(vehicle.lastBrakeFluidDate) || "—"}</td></tr>
      ${vehicle.transmission === "automatic" ? `<tr><td>Poslední olej v převodovce</td><td>${dateOnly(vehicle.lastTransmissionOilDate) || "—"}${vehicle.lastTransmissionOilKm != null ? ` (${vehicle.lastTransmissionOilKm.toLocaleString("cs-CZ")} km)` : ""}</td></tr>` : ""}
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
          <div class="left">
            <span class="label">Zakázkový list</span>
            č. ${o.id} · ${dateOnly(date)}
          </div>
          <div class="right">
            ${o.km != null ? `${o.km.toLocaleString("cs-CZ")} km` : ""}
            <span class="pill">${STATUS_LABEL[o.status] ?? o.status}</span>
          </div>
        </div>
        <div class="body">
          ${o.description ? `<div class="desc">${esc(o.description)}</div>` : ""}
          ${options.serviceItems && performed.length > 0 ? `<ul class="checks">${performed.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
          ${options.serviceItems && o.otherServices ? `<div class="meta-line"><strong>Další úkony:</strong> ${esc(o.otherServices)}</div>` : ""}
          ${options.serviceItems && o.otherWork ? `<div class="meta-line"><strong>Ostatní práce:</strong> ${esc(o.otherWork)}</div>` : ""}
          ${options.materials && mats.length > 0 ? `
            <table class="mat">
              <thead><tr><th>Materiál</th><th class="num">Množství</th>${options.materialPrices ? `<th class="num">Cena / ks</th><th class="num">Celkem</th>` : ""}</tr></thead>
              <tbody>
                ${mats.map((m) => {
                  const qty = parseFloat(m.quantity) || 0;
                  const total = (m.unitPrice ?? 0) * qty;
                  return `<tr>
                    <td>${esc(m.name)}</td>
                    <td class="num">${esc(m.quantity)}${m.unit ? ` ${esc(m.unit)}` : ""}</td>
                    ${options.materialPrices ? `<td class="num">${m.unitPrice != null ? fmtCzk(m.unitPrice) : "—"}</td><td class="num">${fmtCzk(total)}</td>` : ""}
                  </tr>`;
                }).join("")}
              </tbody>
            </table>` : ""}
          ${options.labor && (o.laborHours || laborPrice) ? `<div class="meta-line"><strong>Práce:</strong> ${o.laborHours ?? "—"} h${laborPrice ? ` · ${fmtCzk(laborPrice)}` : ""}</div>` : ""}
          ${options.perOrderTotal && orderTotal > 0 ? `<div class="order-total">Celkem za zakázkový list: <span class="sum">${fmtCzk(orderTotal)}</span></div>` : ""}
        </div>
      </div>
    `;
  }).join("") : `<p class="meta-line" style="text-align:center;padding:16px">Žádné zakázkové listy.</p>`;

  const grandTotal = grandLabor + grandMaterial;
  const totalsHtml = options.grandTotal && grandTotal > 0 ? `
    <div class="totals">
      <table>
        ${options.materials && grandMaterial > 0 ? `<tr><td>Materiál celkem</td><td class="num">${fmtCzk(grandMaterial)}</td></tr>` : ""}
        ${options.labor && grandLabor > 0 ? `<tr><td>Práce celkem</td><td class="num">${fmtCzk(grandLabor)}</td></tr>` : ""}
        <tr class="grand"><td>Celkem za období</td><td class="num">${fmtCzk(grandTotal)}</td></tr>
      </table>
    </div>
  ` : "";

  const recordsHtml = options.serviceRecords && serviceRecords.length > 0 ? `
    <h2 class="section">Další servisní záznamy</h2>
    <table class="records-table">
      <thead><tr><th>Datum</th><th class="num">Km</th><th>Popis / úkony</th><th>Technik</th></tr></thead>
      <tbody>
        ${serviceRecords.map((r) => {
          const ops = [
            r.oilChanged ? "olej" : null,
            r.brakesServiced ? "brzdy" : null,
            r.timingServiced ? "rozvody" : null,
            r.transmissionOilChanged ? "převodovka" : null,
            r.brakeFluidChanged ? "brzdová kapalina" : null,
            r.stkPassed ? "STK" : null,
          ].filter(Boolean).join(", ");
          const text = [r.description, ops, r.otherWork].filter(Boolean).join(" — ");
          return `<tr>
            <td>${dateOnly(r.date)}</td>
            <td class="num">${r.km != null ? r.km.toLocaleString("cs-CZ") : "—"}</td>
            <td>${esc(text)}</td>
            <td>${r.technician ? esc(r.technician) : "—"}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  ` : "";

  const sigImg = settings?.signatureImageUrl ? `<img src="/api${esc(settings.signatureImageUrl)}" alt="" style="max-height:50px;max-width:180px;object-fit:contain;display:block;margin:0 auto 4px" />` : "";
  const sigName = settings?.signatureName ? `<div style="text-align:center;font-size:12px;margin-bottom:4px">${esc(settings.signatureName)}</div>` : "";
  const signatureHtml = options.signature ? `
    <div class="sig">
      <div><div class="line">Podpis zákazníka, datum</div></div>
      <div>${sigImg}${sigName}<div class="line">Podpis mechanika, datum</div></div>
    </div>` : "";

  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>Servisní historie ${esc(vehicle.licensePlate)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="page">
    <div class="toolbar no-print">
      <button class="btn secondary" onclick="window.close()">Zavřít</button>
      <button class="btn" onclick="window.print()">Tisk / Uložit jako PDF</button>
    </div>
    <div class="brand">
      ${shopHeader}
      <div class="badge">
        Servisní dokumentace
        <span class="date">${format(new Date(), "d. M. yyyy", { locale: cs })}</span>
      </div>
    </div>
    <div class="doc-title">
      <h1>Servisní historie vozidla</h1>
      <div class="subtitle" style="display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap">
        ${plateHtml(vehicle.licensePlate, "md")}
        <span>${esc(vehicle.make)} ${esc(vehicle.model)}${vehicle.year ? `, ${vehicle.year}` : ""}</span>
      </div>
    </div>
    ${(vehicleBlock || ownerBlock) ? `<div class="grid2">${vehicleBlock}${ownerBlock}</div>` : ""}
    ${statusHtml}
    ${options.workOrders ? `<h2 class="section">Servisní zakázkové listy (${orders.length})</h2>${ordersHtml}${totalsHtml}` : ""}
    ${recordsHtml}
    <div class="footer-note">Tento dokument je výpisem servisních záznamů vozidla a slouží jako příloha k fakturaci. Vydáno ${format(new Date(), "d. M. yyyy", { locale: cs })}.</div>
    ${signatureHtml}
  </div>
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

      const blob = new Blob(["\ufeff" + html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank", "width=900,height=1100");
      if (!w) {
        URL.revokeObjectURL(url);
        alert("Vyskakovací okno bylo zablokováno. Povolte vyskakovací okna pro tuto stránku.");
        return;
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
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
