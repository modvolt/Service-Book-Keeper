import { format, parseISO } from "date-fns";
import { cs } from "date-fns/locale";
import { attachPrintControls } from "./print-window";

type Row = Record<string, any>;

type BackupData = {
  vehicles: Row[];
  serviceRecords: Row[];
  workOrders: Row[];
  materialsCatalog: Row[];
  workOrderMaterials: Row[];
  appointments: Row[];
  settings: Row[];
};

const STATUS_LABEL: Record<string, string> = {
  open: "Otevřená",
  in_progress: "Probíhá",
  waiting_parts: "Čeká na díly",
  needs_return: "Nutný návrat",
  completed: "Dokončená",
};

const SERVICE_FLAGS: Array<[string, string]> = [
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

function fmtCzk(n: number): string {
  return new Intl.NumberFormat("cs-CZ").format(Math.round(n)) + " Kč";
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dateOnly(s?: string | null): string {
  if (!s) return "";
  try {
    return format(parseISO(s), "d. M. yyyy", { locale: cs });
  } catch {
    return s;
  }
}

function plateHtml(plate: string): string {
  const cleaned = (plate ?? "").replace(/\s+/g, "").toUpperCase();
  const formatted =
    cleaned.length === 7
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
  return `<span class="lp"><span class="lp-eu"><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">${stars}</svg><span class="lp-cz">CZ</span></span><span class="lp-num">${esc(formatted)}</span></span>`;
}

const CSS = `
  @page { size: A4 portrait; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #f3f4f6; }
  body { font-family: "Segoe UI", -apple-system, "Helvetica Neue", Roboto, Arial, sans-serif; color: #1f2937; font-size: 10.5pt; line-height: 1.5; }
  .page { max-width: 210mm; margin: 0 auto; background: white; padding: 22px 26px 30px; box-shadow: 0 2px 18px rgba(15,23,42,0.08); }

  .toolbar { position: sticky; top: 0; z-index: 20; background: rgba(255,255,255,0.95); backdrop-filter: blur(6px); border-bottom: 1px solid #e5e7eb; padding: 10px 16px; margin: -22px -26px 18px; display: flex; gap: 8px; justify-content: flex-end; }
  .btn { background: #b91c1c; color: white; border: 0; padding: 8px 16px; border-radius: 6px; font-size: 10.5pt; cursor: pointer; font-weight: 500; box-shadow: 0 1px 2px rgba(0,0,0,0.08); }
  .btn.secondary { background: white; color: #1f2937; border: 1px solid #d1d5db; }

  .brand { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; padding-bottom: 12px; border-bottom: 3px solid #b91c1c; margin-bottom: 16px; }
  .brand .shop { display: flex; align-items: center; gap: 14px; }
  .brand .logo { max-height: 110px; max-width: 280px; object-fit: contain; display: block; }
  .brand .name { font-size: 18pt; font-weight: 700; color: #0f172a; letter-spacing: -0.01em; margin-bottom: 4px; }
  .brand .lines { font-size: 9pt; color: #6b7280; line-height: 1.55; }
  .brand .badge { text-align: right; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: #b91c1c; font-weight: 600; padding-top: 4px; }
  .brand .badge .date { display: block; margin-top: 6px; color: #6b7280; font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 9pt; }

  .doc-title { text-align: center; margin: 14px 0 4px; }
  .doc-title h1 { font-size: 17pt; font-weight: 700; margin: 0; color: #0f172a; letter-spacing: 0.02em; }
  .doc-title .subtitle { font-size: 10pt; color: #6b7280; margin-top: 4px; }

  .summary { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin: 16px 0 8px; }
  .summary .stat { background: #f9fafb; border: 1px solid #e5e7eb; border-left: 3px solid #b91c1c; border-radius: 8px; padding: 8px 16px; text-align: center; min-width: 96px; }
  .summary .stat .num { font-size: 16pt; font-weight: 700; color: #0f172a; }
  .summary .stat .lbl { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.08em; color: #9ca3af; font-weight: 600; }

  h2.section { font-size: 11pt; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.08em; margin: 22px 0 10px; padding-left: 10px; border-left: 3px solid #b91c1c; }

  .vehicle { border: 1px solid #e5e7eb; border-radius: 10px; margin: 14px 0; padding: 14px 16px; page-break-inside: avoid; box-shadow: 0 1px 2px rgba(0,0,0,0.03); }
  .vehicle .vhead { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 1px solid #f1f5f9; padding-bottom: 10px; margin-bottom: 10px; }
  .vehicle .vhead .title { font-size: 12.5pt; font-weight: 700; color: #0f172a; }
  .vehicle .vhead .owner { font-size: 9.5pt; color: #6b7280; text-align: right; }

  .status-table { width: 100%; border-collapse: collapse; background: #fafafa; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; margin: 6px 0 10px; }
  .status-table td { padding: 6px 12px; border-bottom: 1px solid #f1f5f9; font-size: 9.5pt; }
  .status-table tr:last-child td { border-bottom: none; }
  .status-table td:first-child { color: #6b7280; width: 45%; }
  .status-table td:last-child { color: #1f2937; font-weight: 500; }

  .sub { font-size: 9pt; font-weight: 700; color: #b91c1c; text-transform: uppercase; letter-spacing: 0.06em; margin: 10px 0 6px; }

  .order { border: 1px solid #e5e7eb; border-radius: 8px; margin: 8px 0; page-break-inside: avoid; overflow: hidden; }
  .order .order-head { background: linear-gradient(to right, #fef2f2, #fafafa); padding: 8px 12px; border-bottom: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .order .order-head .left { font-weight: 700; font-size: 10pt; color: #0f172a; }
  .order .order-head .right { font-size: 9pt; color: #6b7280; white-space: nowrap; text-align: right; }
  .order .order-head .pill { display: inline-block; background: white; border: 1px solid #d1d5db; color: #374151; padding: 1px 8px; border-radius: 10px; font-size: 8.5pt; font-weight: 500; margin-left: 6px; }
  .order .body { padding: 8px 12px 10px; }
  .order .desc { font-size: 9.5pt; color: #1f2937; margin: 2px 0 6px; }

  ul.checks { list-style: none; padding: 0; margin: 4px 0; }
  ul.checks li { display: inline-block; margin: 2px 6px 2px 0; padding: 2px 9px 2px 7px; background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; border-radius: 12px; font-size: 8.5pt; font-weight: 500; }
  ul.checks li::before { content: "✓ "; }

  .meta-line { font-size: 9pt; color: #6b7280; margin: 3px 0; }
  .meta-line strong { color: #374151; font-weight: 600; }

  table.mat { width: 100%; border-collapse: collapse; margin: 6px 0 4px; border: 1px solid #e5e7eb; border-radius: 4px; overflow: hidden; }
  table.mat th { background: #f3f4f6; padding: 4px 8px; text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
  table.mat td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; font-size: 9pt; vertical-align: top; }
  table.mat tbody tr:last-child td { border-bottom: none; }
  table.mat td.num, table.mat th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

  .order-total { text-align: right; font-size: 9.5pt; font-weight: 700; color: #0f172a; margin-top: 6px; padding-top: 6px; border-top: 1px dashed #d1d5db; }
  .order-total .sum { color: #b91c1c; }

  .records-table { width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
  .records-table th { background: #f3f4f6; padding: 6px 10px; text-align: left; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; font-weight: 600; border-bottom: 1px solid #e5e7eb; }
  .records-table td { padding: 5px 10px; border-bottom: 1px solid #f1f5f9; font-size: 9pt; vertical-align: top; }
  .records-table tbody tr:nth-child(even) td { background: #fafafa; }
  .records-table td.num { text-align: right; font-variant-numeric: tabular-nums; }

  .footer-note { margin-top: 24px; padding: 10px 14px; background: #f9fafb; border-left: 3px solid #d1d5db; border-radius: 4px; font-size: 8.5pt; color: #6b7280; font-style: italic; }

  .lp { display:inline-flex; align-items:stretch; border:1px solid #d4d4d8; border-radius:3px; background:white; overflow:hidden; vertical-align:middle; line-height:1; box-shadow:0 1px 2px rgba(0,0,0,0.06); height:24pt; }
  .lp-eu { display:flex; flex-direction:column; align-items:center; justify-content:center; background:#003399; color:white; gap:1px; padding:2px 0; width:18pt; }
  .lp-cz { font-weight:700; letter-spacing:0.5px; font-family:Arial,sans-serif; font-size:7.5pt; }
  .lp-num { display:flex; align-items:center; color:#000; font-weight:700; letter-spacing:0.05em; font-family:"Courier New", Consolas, monospace; padding:0 9pt; font-size:14pt; }

  @media print {
    html, body { background: white; }
    .page { box-shadow: none; max-width: none; padding: 0; }
    .no-print { display: none !important; }
    h2.section { page-break-after: avoid; }
    .vehicle, .order { page-break-inside: avoid; box-shadow: none; }
  }
`;

function buildHtml(data: BackupData): string {
  const settings = data.settings[0] ?? null;
  const vehicles = [...data.vehicles].sort((a, b) =>
    String(a.licensePlate ?? "").localeCompare(String(b.licensePlate ?? ""), "cs"),
  );

  const ordersByVehicle = new Map<number, Row[]>();
  for (const o of data.workOrders) {
    const arr = ordersByVehicle.get(o.vehicleId) ?? [];
    arr.push(o);
    ordersByVehicle.set(o.vehicleId, arr);
  }
  const materialsByOrder = new Map<number, Row[]>();
  for (const m of data.workOrderMaterials) {
    const arr = materialsByOrder.get(m.workOrderId) ?? [];
    arr.push(m);
    materialsByOrder.set(m.workOrderId, arr);
  }
  const recordsByVehicle = new Map<number, Row[]>();
  for (const r of data.serviceRecords) {
    const arr = recordsByVehicle.get(r.vehicleId) ?? [];
    arr.push(r);
    recordsByVehicle.set(r.vehicleId, arr);
  }
  for (const arr of recordsByVehicle.values()) {
    arr.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
  }

  const logoImg = settings?.logoUrl
    ? `<img class="logo" src="${esc(window.location.origin)}/api/storage${esc(settings.logoUrl)}" alt="" />`
    : "";
  const shopHeader = settings
    ? `<div class="shop">${logoImg}<div>
        ${settings.companyName ? `<div class="name">${esc(settings.companyName)}</div>` : ""}
        <div class="lines">
          ${settings.companyAddress ? `${esc(settings.companyAddress)}<br/>` : ""}
          ${[settings.companyPhone, settings.companyEmail].filter(Boolean).map((v: string) => esc(v)).join(" · ")}
          ${settings.companyIco || settings.companyDic ? `<br/>${[settings.companyIco ? `IČO: ${esc(settings.companyIco)}` : null, settings.companyDic ? `DIČ: ${esc(settings.companyDic)}` : null].filter(Boolean).join(" · ")}` : ""}
        </div></div></div>`
    : `<div class="shop">${logoImg}<div><div class="name">AutoServis</div></div></div>`;

  const vehiclesHtml = vehicles
    .map((v) => {
      const orders = (ordersByVehicle.get(v.id) ?? []).sort((a, b) => {
        const da = a.serviceDate ?? a.completedAt ?? a.createdAt ?? "";
        const db = b.serviceDate ?? b.completedAt ?? b.createdAt ?? "";
        return String(db).localeCompare(String(da));
      });
      const records = recordsByVehicle.get(v.id) ?? [];

      const statusRows = [
        `<tr><td>STK platná do</td><td>${dateOnly(v.stkValidUntil) || "—"}</td></tr>`,
        `<tr><td>Poslední výměna oleje</td><td>${dateOnly(v.lastOilChangeDate) || "—"}${v.lastOilChangeKm != null ? ` (${Number(v.lastOilChangeKm).toLocaleString("cs-CZ")} km)` : ""}</td></tr>`,
        `<tr><td>Poslední servis brzd</td><td>${dateOnly(v.lastBrakesDate) || "—"}</td></tr>`,
        `<tr><td>Poslední výměna rozvodů</td><td>${dateOnly(v.lastTimingDate) || "—"}</td></tr>`,
        `<tr><td>Poslední výměna brzdové kapaliny</td><td>${dateOnly(v.lastBrakeFluidDate) || "—"}</td></tr>`,
        v.transmission === "automatic"
          ? `<tr><td>Poslední olej v převodovce</td><td>${dateOnly(v.lastTransmissionOilDate) || "—"}${v.lastTransmissionOilKm != null ? ` (${Number(v.lastTransmissionOilKm).toLocaleString("cs-CZ")} km)` : ""}</td></tr>`
          : "",
      ].join("");

      const ordersHtml =
        orders.length > 0
          ? orders
              .map((o) => {
                const mats = materialsByOrder.get(o.id) ?? [];
                const matTotal = mats.reduce(
                  (s, m) => s + (m.unitPrice ?? 0) * (parseFloat(m.quantity) || 0),
                  0,
                );
                const laborPrice = o.laborPrice ?? 0;
                const orderTotal = laborPrice + matTotal;
                const date = o.serviceDate ?? o.completedAt ?? o.createdAt;
                const performed = SERVICE_FLAGS.filter(([k]) => o[k]).map(([, l]) => l);
                return `
                <div class="order">
                  <div class="order-head">
                    <div class="left">Zakázka č. ${o.id} · ${dateOnly(date)}</div>
                    <div class="right">${o.km != null ? `${Number(o.km).toLocaleString("cs-CZ")} km` : ""}<span class="pill">${esc(STATUS_LABEL[o.status] ?? o.status)}</span></div>
                  </div>
                  <div class="body">
                    ${o.description ? `<div class="desc">${esc(o.description)}</div>` : ""}
                    ${performed.length > 0 ? `<ul class="checks">${performed.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
                    ${o.otherServices ? `<div class="meta-line"><strong>Další úkony:</strong> ${esc(o.otherServices)}</div>` : ""}
                    ${o.otherWork ? `<div class="meta-line"><strong>Ostatní práce:</strong> ${esc(o.otherWork)}</div>` : ""}
                    ${
                      mats.length > 0
                        ? `<table class="mat"><thead><tr><th>Materiál</th><th class="num">Množství</th><th class="num">Cena / ks</th><th class="num">Celkem</th></tr></thead><tbody>${mats
                            .map((m) => {
                              const qty = parseFloat(m.quantity) || 0;
                              const total = (m.unitPrice ?? 0) * qty;
                              return `<tr><td>${esc(m.name)}</td><td class="num">${esc(m.quantity)}${m.unit ? ` ${esc(m.unit)}` : ""}</td><td class="num">${m.unitPrice != null ? fmtCzk(m.unitPrice) : "—"}</td><td class="num">${fmtCzk(total)}</td></tr>`;
                            })
                            .join("")}</tbody></table>`
                        : ""
                    }
                    ${o.laborHours || laborPrice ? `<div class="meta-line"><strong>Práce:</strong> ${o.laborHours ?? "—"} h${laborPrice ? ` · ${fmtCzk(laborPrice)}` : ""}</div>` : ""}
                    ${orderTotal > 0 ? `<div class="order-total">Celkem: <span class="sum">${fmtCzk(orderTotal)}</span></div>` : ""}
                  </div>
                </div>`;
              })
              .join("")
          : `<div class="meta-line">Žádné zakázky.</div>`;

      const recordsHtml =
        records.length > 0
          ? `<div class="sub">Servisní záznamy</div><table class="records-table"><thead><tr><th>Datum</th><th class="num">Km</th><th>Popis / úkony</th><th>Technik</th></tr></thead><tbody>${records
              .map((r) => {
                const ops = [
                  r.oilChanged ? "olej" : null,
                  r.brakesServiced ? "brzdy" : null,
                  r.timingServiced ? "rozvody" : null,
                  r.transmissionOilChanged ? "převodovka" : null,
                  r.brakeFluidChanged ? "brzdová kapalina" : null,
                  r.stkPassed ? "STK" : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                const text = [r.description, ops, r.otherWork].filter(Boolean).join(" — ");
                return `<tr><td>${dateOnly(r.date)}</td><td class="num">${r.km != null ? Number(r.km).toLocaleString("cs-CZ") : "—"}</td><td>${esc(text)}</td><td>${r.technician ? esc(r.technician) : "—"}</td></tr>`;
              })
              .join("")}</tbody></table>`
          : "";

      const ownerLine = [v.ownerName, v.ownerPhone, v.ownerEmail].filter(Boolean).map((x: string) => esc(x)).join(" · ");

      return `
        <div class="vehicle">
          <div class="vhead">
            <div>
              <div style="margin-bottom:4px">${plateHtml(v.licensePlate)}</div>
              <div class="title">${esc(v.make)} ${esc(v.model)}${v.year ? `, ${v.year}` : ""}</div>
              ${v.vin ? `<div class="meta-line">VIN: ${esc(v.vin)}</div>` : ""}
              ${v.currentKm != null ? `<div class="meta-line">Najeto: ${Number(v.currentKm).toLocaleString("cs-CZ")} km</div>` : ""}
            </div>
            <div class="owner">
              ${v.ownerName ? `<strong>${esc(v.ownerName)}</strong><br/>` : ""}
              ${v.ownerAddress ? `${esc(v.ownerAddress)}<br/>` : ""}
              ${[v.ownerPhone, v.ownerEmail].filter(Boolean).map((x: string) => esc(x)).join("<br/>")}
            </div>
          </div>
          <table class="status-table">${statusRows}</table>
          <div class="sub">Zakázky (${orders.length})</div>
          ${ordersHtml}
          ${recordsHtml}
        </div>`;
    })
    .join("");

  const catalogHtml =
    data.materialsCatalog.length > 0
      ? `<h2 class="section">Sklad / ceník materiálu (${data.materialsCatalog.length})</h2>
         <table class="records-table"><thead><tr><th>Název</th><th>Jednotka</th><th class="num">Výchozí cena</th></tr></thead><tbody>${[...data.materialsCatalog]
           .sort((a, b) => String(a.name).localeCompare(String(b.name), "cs"))
           .map(
             (m) =>
               `<tr><td>${esc(m.name)}</td><td>${m.unit ? esc(m.unit) : "—"}</td><td class="num">${m.defaultPrice != null ? fmtCzk(m.defaultPrice) : "—"}</td></tr>`,
           )
           .join("")}</tbody></table>`
      : "";

  const now = format(new Date(), "d. M. yyyy HH:mm", { locale: cs });
  const stat = (n: number, label: string) =>
    `<div class="stat"><div class="num">${n}</div><div class="lbl">${label}</div></div>`;

  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>Záloha dat AutoServis ${format(new Date(), "yyyy-MM-dd")}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="page">
    <div class="toolbar no-print">
      <button class="btn secondary" data-print-action="close">Zavřít</button>
      <button class="btn" data-print-action="print">Tisk / Uložit jako PDF</button>
    </div>
    <div class="brand">
      ${shopHeader}
      <div class="badge">Záloha dat<span class="date">${esc(now)}</span></div>
    </div>
    <div class="doc-title">
      <h1>Kompletní záloha dat</h1>
      <div class="subtitle">Přehled všech vozidel, zakázek, servisní historie a skladu</div>
    </div>
    <div class="summary">
      ${stat(data.vehicles.length, "Vozidla")}
      ${stat(data.workOrders.length, "Zakázky")}
      ${stat(data.serviceRecords.length, "Servisní záznamy")}
      ${stat(data.materialsCatalog.length, "Položky skladu")}
    </div>
    <h2 class="section">Vozidla a jejich historie</h2>
    ${vehiclesHtml || `<div class="meta-line">Žádná vozidla.</div>`}
    ${catalogHtml}
    <div class="footer-note">Tento dokument je čitelnou zálohou dat aplikace AutoServis k datu ${esc(now)}. Slouží jako záložní výpis pro případ ztráty dat. Pro plné obnovení dat do aplikace použijte zálohu ve formátu JSON.</div>
  </div>
</body>
</html>`;
}

/**
 * Fetch a full data export and open a printable, human-readable PDF report
 * in a new window. Returns false if the popup was blocked.
 */
export async function openDataBackupPdf(): Promise<boolean> {
  // Open the window synchronously within the click gesture so popup blockers
  // don't reject it after the async fetch resolves.
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.write(
    '<!doctype html><html lang="cs"><head><meta charset="utf-8"><title>Záloha dat</title></head><body style="font-family:sans-serif;color:#6b7280;padding:24px">Připravuji přehled…</body></html>',
  );

  try {
    const res = await fetch("/api/backup/export");
    if (!res.ok) throw new Error("Export failed");
    const json = await res.json();
    const d = json?.data ?? {};
    const data: BackupData = {
      vehicles: d.vehicles ?? [],
      serviceRecords: d.serviceRecords ?? [],
      workOrders: d.workOrders ?? [],
      materialsCatalog: d.materialsCatalog ?? [],
      workOrderMaterials: d.workOrderMaterials ?? [],
      appointments: d.appointments ?? [],
      settings: d.settings ?? [],
    };
    win.document.open();
    win.document.write(buildHtml(data));
    win.document.close();
    attachPrintControls(win);
    return true;
  } catch (err) {
    win.close();
    throw err;
  }
}
