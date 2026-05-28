import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Printer, FileDown } from "lucide-react";
import type { WorkOrder, WorkOrderMaterial, Vehicle, Settings, Photo } from "@workspace/api-client-react";
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
    ["brakes", "Servis brzd"],
    ["timing", "Výměna rozvodů"],
    ["airFilter", "Výměna vzduchového filtru"],
    ["cabinFilter", "Výměna kabinového filtru"],
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
    .map((u) => (u!.startsWith("http") || u!.startsWith("/api/") ? u! : `/api/storage${u}`));

  const css = `
    * { box-sizing: border-box; }
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; margin: 0; padding: 24px; font-size: 12pt; line-height: 1.45; }
    h1 { font-size: 20pt; margin: 0 0 4px; }
    h2 { font-size: 13pt; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #d4d4d8; }
    .row { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; }
    .muted { color: #6b7280; font-size: 10pt; }
    .meta { text-align: right; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; }
    .box .label { font-size: 9pt; text-transform: uppercase; color: #6b7280; letter-spacing: 0.04em; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
    th { background: #f3f4f6; font-size: 10pt; }
    td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .totals { margin-top: 8px; width: 320px; margin-left: auto; }
    .totals td { border: none; padding: 4px 8px; }
    .totals tr.grand td { border-top: 2px solid #111; font-weight: bold; font-size: 13pt; padding-top: 8px; }
    ul.checks { list-style: none; padding: 0; margin: 0; columns: 2; column-gap: 24px; }
    ul.checks li { padding: 3px 0; break-inside: avoid; }
    ul.checks li::before { content: "✓ "; color: #16a34a; font-weight: bold; }
    .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .photos img { width: 100%; height: 140px; object-fit: cover; border: 1px solid #e5e7eb; border-radius: 4px; }
    .sig { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; margin-top: 32px; }
    .sig .line { border-top: 1px solid #111; margin-top: 48px; padding-top: 4px; font-size: 10pt; color: #6b7280; }
    @media print {
      body { padding: 16mm; font-size: 11pt; }
      .no-print { display: none; }
      h2 { page-break-after: avoid; }
      tr, .box, .sig { page-break-inside: avoid; }
    }
    .toolbar { position: sticky; top: 0; background: #f9fafb; border-bottom: 1px solid #e5e7eb; padding: 10px 16px; margin: -24px -24px 16px; display: flex; gap: 8px; justify-content: flex-end; }
    .btn { background: #111; color: white; border: 0; padding: 8px 14px; border-radius: 6px; font-size: 11pt; cursor: pointer; }
    .btn.secondary { background: white; color: #111; border: 1px solid #d4d4d8; }
  `;

  const shopHeader = options.shopHeader && settings ? `
    <div>
      ${settings.companyName ? `<div style="font-weight:600">${esc(settings.companyName)}</div>` : ""}
      ${settings.companyAddress ? `<div class="muted">${esc(settings.companyAddress)}</div>` : ""}
      <div class="muted">
        ${[settings.companyPhone, settings.companyEmail].filter(Boolean).map(esc).join(" · ")}
      </div>
      <div class="muted">
        ${[settings.companyIco ? `IČO: ${esc(settings.companyIco)}` : null, settings.companyDic ? `DIČ: ${esc(settings.companyDic)}` : null].filter(Boolean).join(" · ")}
      </div>
    </div>` : "<div></div>";

  const vehicleBlock = options.vehicleInfo && vehicle ? `
    <div class="box">
      <div class="label">Vozidlo</div>
      <div style="font-size:13pt;font-weight:600">${esc(vehicle.licensePlate)}</div>
      <div>${esc(vehicle.make)} ${esc(vehicle.model)}${vehicle.year ? `, ${vehicle.year}` : ""}</div>
      ${vehicle.vin ? `<div class="muted">VIN: ${esc(vehicle.vin)}</div>` : ""}
      ${order.km != null ? `<div class="muted">Stav km: ${order.km.toLocaleString("cs-CZ")} km</div>` : ""}
    </div>` : "";

  const ownerBlock = options.ownerInfo && vehicle && (vehicle.ownerName || vehicle.ownerAddress) ? `
    <div class="box">
      <div class="label">Vlastník</div>
      ${vehicle.ownerName ? `<div style="font-weight:600">${esc(vehicle.ownerName)}</div>` : ""}
      ${vehicle.ownerAddress ? `<div class="muted">${esc(vehicle.ownerAddress)}</div>` : ""}
      <div class="muted">
        ${[vehicle.ownerPhone, vehicle.ownerEmail].filter(Boolean).map((v) => esc(v as string)).join(" · ")}
      </div>
      <div class="muted">
        ${[vehicle.ownerIco ? `IČO: ${esc(vehicle.ownerIco)}` : null, vehicle.ownerDic ? `DIČ: ${esc(vehicle.ownerDic)}` : null].filter(Boolean).join(" · ")}
      </div>
    </div>` : "";

  const serviceItemsHtml = options.serviceItems && performedItems.length > 0 ? `
    <h2>Provedené servisní úkony</h2>
    <ul class="checks">${performedItems.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
  ` : "";

  const otherWorkHtml = options.otherWork && (order.description || order.otherWork || order.otherServices) ? `
    <h2>Popis práce</h2>
    ${order.description ? `<p>${esc(order.description)}</p>` : ""}
    ${order.otherServices ? `<p><strong>Další úkony:</strong> ${esc(order.otherServices)}</p>` : ""}
    ${order.otherWork ? `<p><strong>Ostatní práce:</strong> ${esc(order.otherWork)}</p>` : ""}
  ` : "";

  let materialsHtml = "";
  if (options.materials && matLines.length > 0) {
    const showPrices = options.materialPrices;
    materialsHtml = `
      <h2>Materiál</h2>
      <table>
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
              ${showPrices ? `<td class="num">${m.unitPrice != null ? fmtCzk(m.unitPrice) : "-"}</td><td class="num">${fmtCzk(m.total)}</td>` : ""}
            </tr>`).join("")}
        </tbody>
      </table>
    `;
  }

  let laborHtml = "";
  if (options.labor && (order.laborHours || laborPrice)) {
    laborHtml = `
      <h2>Práce</h2>
      <table>
        <thead><tr><th>Popis</th><th class="num">Hodiny</th><th class="num">Cena</th></tr></thead>
        <tbody>
          <tr>
            <td>Servisní práce</td>
            <td class="num">${order.laborHours ?? "-"}</td>
            <td class="num">${laborPrice ? fmtCzk(laborPrice) : "-"}</td>
          </tr>
        </tbody>
      </table>
    `;
  }

  let totalsHtml = "";
  if (options.totals && (includedMaterialTotal > 0 || includedLaborTotal > 0)) {
    totalsHtml = `
      <table class="totals">
        ${options.materials && includedMaterialTotal > 0 ? `<tr><td>Materiál celkem</td><td class="num">${fmtCzk(includedMaterialTotal)}</td></tr>` : ""}
        ${options.labor && includedLaborTotal > 0 ? `<tr><td>Práce celkem</td><td class="num">${fmtCzk(includedLaborTotal)}</td></tr>` : ""}
        <tr class="grand"><td>Celkem k úhradě</td><td class="num">${fmtCzk(grandTotal)}</td></tr>
      </table>
    `;
  }

  const notesHtml = options.notes && order.notes ? `<h2>Poznámky</h2><p style="white-space:pre-wrap">${esc(order.notes)}</p>` : "";

  const photosHtml = options.photos && photoUrls.length > 0 ? `
    <h2>Fotografie (${photoUrls.length})</h2>
    <div class="photos">
      ${photoUrls.map((u) => `<img src="${esc(u)}" alt="" />`).join("")}
    </div>
  ` : "";

  const signatureHtml = options.signature ? `
    <div class="sig">
      <div><div class="line">Podpis zákazníka, datum</div></div>
      <div><div class="line">Podpis mechanika, datum</div></div>
    </div>
  ` : "";

  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>Zakázka #${order.id} — ${esc(order.licensePlate)}</title>
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
      <h1>Zakázkový list č. ${order.id}</h1>
      <div class="muted">Datum: ${dateStr}</div>
      <div class="muted">Stav: ${STATUS_LABEL[order.status] ?? order.status}</div>
    </div>
  </div>
  ${(vehicleBlock || ownerBlock) ? `<div class="grid2" style="margin-top:16px">${vehicleBlock}${ownerBlock}</div>` : ""}
  ${serviceItemsHtml}
  ${otherWorkHtml}
  ${materialsHtml}
  ${laborHtml}
  ${totalsHtml}
  ${notesHtml}
  ${photosHtml}
  ${signatureHtml}
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
    const w = window.open("", "_blank", "width=900,height=1100");
    if (!w) {
      alert("Vyskakovací okno bylo zablokováno. Povolte vyskakovací okna pro tuto stránku.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    setOpen(false);
  }

  const count = Object.values(opts).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileDown className="h-5 w-5" /> Export zakázky pro fakturaci</DialogTitle>
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
