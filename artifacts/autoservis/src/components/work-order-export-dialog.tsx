import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Printer, FileDown } from "lucide-react";
import type { WorkOrder, WorkOrderMaterial, Vehicle, Settings, Photo } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { cs } from "date-fns/locale";
import { attachPrintControls } from "@/lib/print-window";

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
  serviceItems: boolean;
  otherWork: boolean;
  materials: boolean;
  materialPrices: boolean;
  labor: boolean;
  totals: boolean;
  notes: boolean;
  photos: boolean;
  signature: boolean;
};

const FIELDS: Array<{ key: keyof ExportOptions; label: string; hint?: string }> = [
  { key: "shopHeader", label: "Hlavička dílny", hint: "Název, adresa, IČO, DIČ" },
  { key: "vehicleInfo", label: "Údaje o vozidle", hint: "SPZ, značka, model, VIN, km" },
  { key: "ownerInfo", label: "Údaje o vlastníkovi", hint: "Jméno, adresa, kontakt" },
  { key: "serviceItems", label: "Provedené úkony", hint: "Olej, brzdy, rozvody…" },
  { key: "otherWork", label: "Další práce a popis" },
  { key: "materials", label: "Použité materiály" },
  { key: "materialPrices", label: "Ceny materiálu (jednotkové i celkové)" },
  { key: "labor", label: "Práce (hodiny a cena)" },
  { key: "totals", label: "Celková cena" },
  { key: "notes", label: "Poznámky" },
  { key: "photos", label: "Fotografie", hint: "Vloží náhledy do exportu" },
  { key: "signature", label: "Místo pro podpis zákazníka i mechanika" },
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

function buildHtml(opts: {
  order: WorkOrder;
  materials: WorkOrderMaterial[];
  vehicle: Vehicle | null | undefined;
  settings: Settings | null | undefined;
  photos: Photo[];
  options: ExportOptions;
}): string {
  const { order, materials, vehicle, settings, photos, options } = opts;
  const date = order.serviceDate ?? order.completedAt ?? order.createdAt;
  const dateStr = date ? format(new Date(date), "d. M. yyyy", { locale: cs }) : "";

  const SERVICE_FLAGS: Array<[keyof WorkOrder, string]> = [
    ["oilChange", "Výměna motorového oleje"],
    ["transmissionOil", "Výměna oleje v převodovce"],
    ["brakes", "Kontrola brzd"],
    ["timing", "Výměna rozvodů"],
    ["airFilter", "Výměna vzduchového filtru"],
    ["cabinFilter", "Výměna kabinového filtru"],
    ["brakeFluid", "Výměna brzdové kapaliny"],
    ["tireChange", "Přezutí pneumatik"],
    ["diagnostics", "Diagnostika"],
    ["lightsCheck", "Kontrola osvětlení"],
    ["frontAxleCheck", "Kontrola přední nápravy"],
    ["rearAxleCheck", "Kontrola zadní nápravy"],
    ["frontShocksCheck", "Kontrola předních tlumičů"],
    ["rearShocksCheck", "Kontrola zadních tlumičů"],
    ["geometry", "Geometrie"],
    ["headlightAlignment", "Seřízení světlometů"],
    ["stk", "STK"],
  ];
  const performedItems = SERVICE_FLAGS.filter(([k]) => order[k]).map(([, l]) => l);

  const matLines = materials.map((m) => {
    const qty = parseFloat(m.quantity) || 0;
    const total = (m.unitPrice ?? 0) * qty;
    return { name: m.name, qty: m.quantity, unit: m.unit ?? "", unitPrice: m.unitPrice, total };
  });
  const materialTotal = matLines.reduce((s, m) => s + m.total, 0);
  const laborPrice = order.laborPrice ?? 0;
  // Totals reflect only sections the user chose to include
  const includedMaterialTotal = options.materials ? materialTotal : 0;
  const includedLaborTotal = options.labor ? laborPrice : 0;
  const grandTotal = includedMaterialTotal + includedLaborTotal;

  const photoUrls = (photos ?? [])
    .map((p) => p.url)
    .filter(Boolean)
    .map((u) => (u!.startsWith("http") ? u! : u!.startsWith("/api/") ? `${window.location.origin}${u}` : `${window.location.origin}/api/storage${u}`));

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
    .brand .shop { display: flex; align-items: center; gap: 14px; }
    .brand .logo { max-height: 130px; max-width: 300px; object-fit: contain; display: block; }
    .brand .name { font-size: 18pt; font-weight: 700; color: #0f172a; letter-spacing: -0.01em; margin-bottom: 4px; }
    .brand .lines { font-size: 9pt; color: #6b7280; line-height: 1.55; }
    .brand .badge { text-align: right; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #b91c1c; font-weight: 600; padding-top: 4px; }
    .brand .badge .date { display: block; margin-top: 6px; color: #6b7280; font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 9pt; }
    .brand .badge .pill { display: inline-block; background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; padding: 2px 10px; border-radius: 12px; font-size: 8.5pt; margin-top: 6px; }

    .doc-title { text-align: center; margin: 18px 0 14px; }
    .doc-title h1 { font-size: 17pt; font-weight: 700; margin: 0; color: #0f172a; letter-spacing: 0.02em; }
    .doc-title .subtitle { font-size: 10pt; color: #6b7280; margin-top: 6px; display:flex; align-items:center; justify-content:center; gap:10px; flex-wrap:wrap; }

    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 14px 0; }
    .info-card { background: #f9fafb; border: 1px solid #e5e7eb; border-left: 3px solid #b91c1c; border-radius: 8px; padding: 12px 14px; }
    .info-card .label { font-size: 8pt; text-transform: uppercase; color: #9ca3af; letter-spacing: 0.1em; margin-bottom: 6px; font-weight: 600; }
    .info-card .primary { font-size: 12.5pt; font-weight: 700; color: #0f172a; margin-bottom: 3px; }
    .info-card .secondary { font-size: 10pt; color: #374151; margin-bottom: 2px; }
    .info-card .muted { font-size: 9pt; color: #6b7280; }

    h2.section { font-size: 11pt; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.08em; margin: 22px 0 10px; padding-left: 10px; border-left: 3px solid #b91c1c; }

    ul.checks { list-style: none; padding: 0; margin: 6px 0; }
    ul.checks li { display: inline-block; margin: 2px 6px 2px 0; padding: 2px 9px 2px 7px; background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; border-radius: 12px; font-size: 9pt; font-weight: 500; }
    ul.checks li::before { content: "✓ "; }

    .desc-box { background: #fafafa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; font-size: 10pt; color: #1f2937; }
    .desc-box p { margin: 4px 0; }
    .desc-box .label { font-size: 8.5pt; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 4px; }

    table.mat { width: 100%; border-collapse: collapse; margin: 8px 0 4px; border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden; }
    table.mat th { background: #f3f4f6; padding: 6px 10px; text-align: left; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
    table.mat td { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; font-size: 10pt; vertical-align: top; }
    table.mat tbody tr:last-child td { border-bottom: none; }
    table.mat tbody tr:nth-child(even) td { background: #fafafa; }
    table.mat td.num, table.mat th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

    .labor-line { display: flex; justify-content: space-between; align-items: center; background: #fafafa; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 14px; font-size: 10pt; }
    .labor-line .right { font-variant-numeric: tabular-nums; font-weight: 600; color: #0f172a; }

    .totals { margin: 18px 0 0 auto; width: 340px; background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 8px 14px; }
    .totals table { width: 100%; border-collapse: collapse; }
    .totals td { padding: 4px 0; font-size: 10pt; color: #78350f; }
    .totals td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    .totals tr.grand td { border-top: 2px solid #f59e0b; padding-top: 8px; font-size: 13pt; font-weight: 700; color: #78350f; }

    .notes-box { background: #f9fafb; border-left: 3px solid #d1d5db; border-radius: 4px; padding: 10px 14px; font-size: 10pt; color: #374151; white-space: pre-wrap; }

    .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .photos img { width: 100%; height: 150px; object-fit: cover; border: 1px solid #e5e7eb; border-radius: 6px; }

    .footer-note { margin-top: 24px; padding: 10px 14px; background: #f9fafb; border-left: 3px solid #d1d5db; border-radius: 4px; font-size: 8.5pt; color: #6b7280; font-style: italic; }
    .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 50px; margin-top: 34px; }
    .sig .line { border-top: 1px solid #1f2937; margin-top: 42px; padding-top: 6px; font-size: 9pt; color: #6b7280; text-align: center; }

    @media print {
      html, body { background: white; }
      .page { box-shadow: none; max-width: none; padding: 0; }
      .no-print { display: none !important; }
      h2.section { page-break-after: avoid; }
      .totals, .sig, .info-card, table.mat tr { page-break-inside: avoid; }
    }
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

  const logoImg = settings?.logoUrl ? `<img class="logo" src="${esc(window.location.origin)}/api/storage${esc(settings.logoUrl)}" alt="" />` : "";
  const shopHeader = options.shopHeader && settings ? `
    <div class="shop">
      ${logoImg}
      <div>
        ${settings.companyName ? `<div class="name">${esc(settings.companyName)}</div>` : ""}
        <div class="lines">
          ${settings.companyAddress ? `${esc(settings.companyAddress)}<br/>` : ""}
          ${[settings.companyPhone, settings.companyEmail].filter(Boolean).map((v) => esc(v as string)).join(" · ")}
          ${(settings.companyIco || settings.companyDic) ? `<br/>${[settings.companyIco ? `IČO: ${esc(settings.companyIco)}` : null, settings.companyDic ? `DIČ: ${esc(settings.companyDic)}` : null].filter(Boolean).join(" · ")}` : ""}
        </div>
      </div>
    </div>` : `<div class="shop">${logoImg}<div><div class="name">AutoServis</div></div></div>`;

  const vehicleBlock = options.vehicleInfo && vehicle ? `
    <div class="info-card">
      <div class="label">Vozidlo</div>
      <div style="margin:2px 0 6px">${plateHtml(vehicle.licensePlate, "lg")}</div>
      <div class="secondary">${esc(vehicle.make)} ${esc(vehicle.model)}${vehicle.year ? `, ${vehicle.year}` : ""}</div>
      ${vehicle.vin ? `<div class="muted">VIN: ${esc(vehicle.vin)}</div>` : ""}
      ${order.km != null ? `<div class="muted">Stav km: ${order.km.toLocaleString("cs-CZ")} km</div>` : ""}
    </div>` : "";

  const ownerBlock = options.ownerInfo && vehicle && (vehicle.ownerName || vehicle.ownerAddress) ? `
    <div class="info-card">
      <div class="label">Vlastník</div>
      ${vehicle.ownerName ? `<div class="primary">${esc(vehicle.ownerName)}</div>` : ""}
      ${vehicle.ownerAddress ? `<div class="secondary">${esc(vehicle.ownerAddress)}</div>` : ""}
      ${(vehicle.ownerPhone || vehicle.ownerEmail) ? `<div class="muted">${[vehicle.ownerPhone, vehicle.ownerEmail].filter(Boolean).map((v) => esc(v as string)).join(" · ")}</div>` : ""}
      ${(vehicle.ownerIco || vehicle.ownerDic) ? `<div class="muted">${[vehicle.ownerIco ? `IČO: ${esc(vehicle.ownerIco)}` : null, vehicle.ownerDic ? `DIČ: ${esc(vehicle.ownerDic)}` : null].filter(Boolean).join(" · ")}</div>` : ""}
    </div>` : "";

  const serviceItemsHtml = options.serviceItems && performedItems.length > 0 ? `
    <h2 class="section">Provedené servisní úkony</h2>
    <ul class="checks">${performedItems.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
  ` : "";

  const otherWorkHtml = options.otherWork && (order.description || order.otherWork || order.otherServices) ? `
    <h2 class="section">Popis práce</h2>
    <div class="desc-box">
      ${order.description ? `<p>${esc(order.description)}</p>` : ""}
      ${order.otherServices ? `<p><span class="label">Další úkony:</span> ${esc(order.otherServices)}</p>` : ""}
      ${order.otherWork ? `<p><span class="label">Ostatní práce:</span> ${esc(order.otherWork)}</p>` : ""}
    </div>
  ` : "";

  let materialsHtml = "";
  if (options.materials && matLines.length > 0) {
    const showPrices = options.materialPrices;
    materialsHtml = `
      <h2 class="section">Materiál</h2>
      <table class="mat">
        <thead>
          <tr>
            <th>Položka</th>
            <th class="num">Množství</th>
            ${showPrices ? `<th class="num">Cena / ks</th><th class="num">Celkem</th>` : ""}
          </tr>
        </thead>
        <tbody>
          ${matLines.map((m) => `
            <tr>
              <td>${esc(m.name)}</td>
              <td class="num">${esc(m.qty)}${m.unit ? ` ${esc(m.unit)}` : ""}</td>
              ${showPrices ? `<td class="num">${m.unitPrice != null ? fmtCzk(m.unitPrice) : "—"}</td><td class="num">${fmtCzk(m.total)}</td>` : ""}
            </tr>`).join("")}
        </tbody>
      </table>
    `;
  }

  let laborHtml = "";
  if (options.labor && (order.laborHours || laborPrice)) {
    laborHtml = `
      <h2 class="section">Práce</h2>
      <div class="labor-line">
        <span>Servisní práce${order.laborHours ? ` · ${esc(String(order.laborHours))} h` : ""}</span>
        <span class="right">${laborPrice ? fmtCzk(laborPrice) : "—"}</span>
      </div>
    `;
  }

  let totalsHtml = "";
  if (options.totals && (includedMaterialTotal > 0 || includedLaborTotal > 0)) {
    totalsHtml = `
      <div class="totals">
        <table>
          ${options.materials && includedMaterialTotal > 0 ? `<tr><td>Materiál celkem</td><td class="num">${fmtCzk(includedMaterialTotal)}</td></tr>` : ""}
          ${options.labor && includedLaborTotal > 0 ? `<tr><td>Práce celkem</td><td class="num">${fmtCzk(includedLaborTotal)}</td></tr>` : ""}
          <tr class="grand"><td>Celkem k úhradě</td><td class="num">${fmtCzk(grandTotal)}</td></tr>
        </table>
      </div>
    `;
  }

  const notesHtml = options.notes && order.notes ? `<h2 class="section">Poznámky</h2><div class="notes-box">${esc(order.notes)}</div>` : "";

  const photosHtml = options.photos && photoUrls.length > 0 ? `
    <h2 class="section">Fotografie (${photoUrls.length})</h2>
    <div class="photos">
      ${photoUrls.map((u) => `<img src="${esc(u)}" alt="" />`).join("")}
    </div>
  ` : "";

  const sigImg = settings?.signatureImageUrl ? `<img src="${esc(window.location.origin)}/api/storage${esc(settings.signatureImageUrl)}" alt="" style="max-height:120px;max-width:340px;object-fit:contain;display:block;margin:0 auto 6px" />` : "";
  const sigName = settings?.signatureName ? `<div style="text-align:center;font-size:12px;margin-bottom:4px">${esc(settings.signatureName)}</div>` : "";
  const signatureHtml = options.signature ? `
    <div class="sig">
      <div><div class="line">Podpis zákazníka, datum</div></div>
      <div>${sigImg}${sigName}<div class="line">Podpis mechanika, datum</div></div>
    </div>
  ` : "";

  const vehicleTitleLine = vehicle ? `
        ${plateHtml(vehicle.licensePlate, "md")}
        <span>${esc(vehicle.make)} ${esc(vehicle.model)}${vehicle.year ? `, ${vehicle.year}` : ""}</span>
      ` : (order.licensePlate ? plateHtml(order.licensePlate, "md") : "");

  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>Zakázkový list č. ${order.id} — ${esc(order.licensePlate)}</title>
  <style>${css}</style>
</head>
<body>
  <div class="page">
    <div class="toolbar no-print">
      <button class="btn secondary" data-print-action="close">Zavřít</button>
      <button class="btn" data-print-action="print">Tisk / Uložit jako PDF</button>
    </div>
    <div class="brand">
      ${shopHeader}
      <div class="badge">
        Zakázkový list
        <span class="date">${dateStr}</span>
        <span class="pill">${STATUS_LABEL[order.status] ?? order.status}</span>
      </div>
    </div>
    <div class="doc-title">
      <h1>Zakázkový list č. ${order.id}</h1>
      <div class="subtitle">${vehicleTitleLine}</div>
    </div>
    ${(vehicleBlock || ownerBlock) ? `<div class="grid2">${vehicleBlock}${ownerBlock}</div>` : ""}
    ${serviceItemsHtml}
    ${otherWorkHtml}
    ${materialsHtml}
    ${laborHtml}
    ${totalsHtml}
    ${notesHtml}
    ${photosHtml}
    <div class="footer-note">Zakázkový list slouží jako podklad k fakturaci servisních prací. Vydáno ${format(new Date(), "d. M. yyyy", { locale: cs })}.</div>
    ${signatureHtml}
  </div>
</body>
</html>`;
}

type Props = {
  order: WorkOrder;
  materials: WorkOrderMaterial[];
  vehicle: Vehicle | null | undefined;
  settings: Settings | null | undefined;
  photos: Photo[];
  trigger: React.ReactNode;
};

export function WorkOrderExportDialog({ order, materials, vehicle, settings, photos, trigger }: Props) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ExportOptions>({
    shopHeader: true,
    vehicleInfo: true,
    ownerInfo: true,
    serviceItems: true,
    otherWork: true,
    materials: true,
    materialPrices: true,
    labor: true,
    totals: true,
    notes: false,
    photos: false,
    signature: true,
  });

  function toggle(k: keyof ExportOptions) {
    setOpts((o) => ({ ...o, [k]: !o[k] }));
  }

  function handlePrint() {
    const html = buildHtml({ order, materials, vehicle, settings, photos, options: opts });
    const blob = new Blob(["\ufeff" + html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, "_blank", "width=900,height=1100");
    if (!w) {
      URL.revokeObjectURL(url);
      alert("Vyskakovací okno bylo zablokováno. Povolte vyskakovací okna pro tuto stránku.");
      return;
    }
    attachPrintControls(w);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setOpen(false);
  }

  const count = Object.values(opts).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileDown className="h-5 w-5" /> Zakázkový list</DialogTitle>
          <DialogDescription>
            Vyberte, co má být součástí dokumentu. Otevře se okno s tiskovou verzí — v dialogu prohlížeče zvolte „Uložit jako PDF" a přiložte k faktuře.
          </DialogDescription>
        </DialogHeader>

        <div className="grid sm:grid-cols-2 gap-2">
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
          <Button onClick={handlePrint} disabled={count === 0}>
            <Printer className="h-4 w-4 mr-2" /> Otevřít k tisku
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
