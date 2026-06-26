import { Router, type IRouter, type Request, type RequestHandler } from "express";
import { getCapturedErrors } from "../lib/error-buffer";
import { getReadiness } from "../lib/readiness";

const router: IRouter = Router();

/**
 * Diagnostics exposes recent server errors and the readiness snapshot — useful
 * for debugging but sensitive (stack traces, dependency state), so it is NOT
 * public by default. Access is admin-only unless ENABLE_PUBLIC_DIAGNOSTICS is
 * explicitly turned on (e.g. for a short debugging window on a deploy that has
 * no working login yet). The session is already attached by sessionMiddleware,
 * which runs before this router is mounted.
 */
function diagnosticsPublic(): boolean {
  const v = (process.env.ENABLE_PUBLIC_DIAGNOSTICS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

const diagnosticsAccess: RequestHandler = (req, res, next) => {
  if (diagnosticsPublic()) {
    next();
    return;
  }
  const session = (req as Request & {
    session?: { authenticated?: boolean; role?: string };
  }).session;
  if (!session?.authenticated) {
    res.status(401).json({ error: "Nepřihlášen" });
    return;
  }
  // Old sessions without a role field are treated as admin (mirrors requireAdmin).
  const role = session.role ?? "admin";
  if (role !== "admin") {
    res.status(403).json({ error: "Přístup odepřen" });
    return;
  }
  next();
};

router.use(diagnosticsAccess);

/**
 * JSON feed of recent runtime errors (newest first) plus the current readiness
 * snapshot. Backs the diagnostics page. Gated by diagnosticsAccess above.
 */
router.get("/diagnostics/errors", (_req, res) => {
  res.json({
    readiness: getReadiness(),
    errors: getCapturedErrors(),
  });
});

const PAGE = `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Diagnostika serveru</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: #0f1115; color: #e6e8eb; }
  header { padding: 1.25rem 1.5rem; border-bottom: 1px solid #2a2f3a; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  h1 { font-size: 1.1rem; margin: 0; font-weight: 600; }
  .meta { font-size: .8rem; color: #9aa3b2; }
  main { padding: 1.5rem; max-width: 960px; margin: 0 auto; }
  .status { display: flex; gap: .75rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
  .pill { font-size: .8rem; padding: .35rem .6rem; border-radius: 999px; border: 1px solid #2a2f3a; }
  .ok { color: #34d399; border-color: #1f5641; }
  .fail { color: #f87171; border-color: #5e2626; }
  .controls { display: flex; gap: .75rem; align-items: center; margin-bottom: 1rem; }
  button { font: inherit; background: #1c2430; color: #e6e8eb; border: 1px solid #2a2f3a; padding: .45rem .8rem; border-radius: 8px; cursor: pointer; }
  button:hover { background: #232c3a; }
  .empty { color: #9aa3b2; padding: 2rem 0; text-align: center; }
  .err { border: 1px solid #2a2f3a; border-radius: 10px; margin-bottom: .75rem; overflow: hidden; background: #151922; }
  .err summary { list-style: none; cursor: pointer; padding: .85rem 1rem; display: flex; gap: .75rem; align-items: baseline; }
  .err summary::-webkit-details-marker { display: none; }
  .err .time { font-size: .75rem; color: #9aa3b2; white-space: nowrap; }
  .err .ctx { font-size: .7rem; color: #fbbf24; border: 1px solid #4d3b12; padding: .1rem .4rem; border-radius: 6px; white-space: nowrap; }
  .err .msg { font-weight: 500; word-break: break-word; }
  .err pre { margin: 0; padding: 1rem; background: #0c0f14; border-top: 1px solid #2a2f3a; overflow: auto; font-size: .8rem; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<header>
  <h1>Diagnostika serveru</h1>
  <div class="meta" id="meta">Načítám…</div>
</header>
<main>
  <div class="status" id="status"></div>
  <div class="controls">
    <button id="refresh" type="button">Obnovit</button>
    <span class="meta" id="count"></span>
  </div>
  <div id="list"></div>
</main>
<script src="diagnostics.js"></script>
</body>
</html>`;

// Served as a separate same-origin script so the strict Content-Security-Policy
// (script-src 'self') applied by helmet allows it without an inline-script
// exception.
const SCRIPT = `
  function pill(label, value) {
    var ok = value === "ok" || value === true;
    return '<span class="pill ' + (ok ? "ok" : "fail") + '">' + label + ': ' + (ok ? "ok" : "nedostupné") + '</span>';
  }
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString("cs-CZ"); } catch (e) { return iso; }
  }
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  async function load() {
    var meta = document.getElementById("meta");
    try {
      var res = await fetch("diagnostics/errors", { headers: { accept: "application/json" } });
      var data = await res.json();
      var r = data.readiness || {};
      document.getElementById("status").innerHTML =
        pill("Celkově", !!r.ready) + pill("Databáze", r.database) + pill("Úložiště", r.storage);
      var errors = data.errors || [];
      document.getElementById("count").textContent = errors.length + " zaznamenaných chyb";
      meta.textContent = "Aktualizováno " + fmtTime(new Date().toISOString());
      var list = document.getElementById("list");
      if (errors.length === 0) {
        list.innerHTML = '<div class="empty">Žádné zaznamenané chyby.</div>';
        return;
      }
      list.innerHTML = errors.map(function (e) {
        var stack = e.stack ? '<pre>' + esc(e.stack) + '</pre>' : '<pre>' + esc(e.message) + '</pre>';
        return '<details class="err">' +
          '<summary>' +
            '<span class="time">' + fmtTime(e.timestamp) + '</span>' +
            '<span class="ctx">' + esc(e.context) + '</span>' +
            '<span class="msg">' + esc(e.message) + '</span>' +
          '</summary>' + stack +
        '</details>';
      }).join("");
    } catch (err) {
      meta.textContent = "Nepodařilo se načíst diagnostiku.";
    }
  }
  document.getElementById("refresh").addEventListener("click", load);
  load();
`;

router.get("/diagnostics.js", (_req, res) => {
  res.type("application/javascript").send(SCRIPT);
});

router.get("/diagnostics", (_req, res) => {
  res.type("html").send(PAGE);
});

export default router;
