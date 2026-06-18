/**
 * Wire up the "Tisk / Uložit jako PDF" and "Zavřít" buttons inside an export
 * popup window from the opener's context.
 *
 * The export popups are blob:/about:blank documents created by the SPA. In
 * production the SPA is served by Express with helmet's CSP (`script-src
 * 'self'`), and blob:/about:blank documents inherit the creator's policy — so
 * inline `onclick="window.print()"` handlers are blocked and the buttons do
 * nothing. (In dev the SPA is served by Vite without that CSP, so the old
 * inline handlers worked there, masking the problem.)
 *
 * The popup is same-origin with the opener, so we attach the click handlers
 * from here — the opener's allowed script context — instead of relying on
 * inline handlers. Buttons are marked with `data-print-action="print|close"`.
 */
export function attachPrintControls(w: Window | null): void {
  if (!w) return;

  const wire = () => {
    let doc: Document | null = null;
    try {
      doc = w.document;
    } catch {
      return; // cross-origin (not expected for same-origin blob/about:blank)
    }
    if (!doc) return;
    const root = doc.documentElement;
    if (!root) return;

    const printBtns = doc.querySelectorAll<HTMLElement>('[data-print-action="print"]');
    const closeBtns = doc.querySelectorAll<HTMLElement>('[data-print-action="close"]');
    // Document not parsed yet — bail without marking, so a later pass can retry.
    if (printBtns.length === 0 && closeBtns.length === 0) return;
    if (root.dataset.printWired === "1") return;
    root.dataset.printWired = "1";

    printBtns.forEach((b) =>
      b.addEventListener("click", () => {
        try {
          w.focus();
          w.print();
        } catch {
          /* ignore */
        }
      }),
    );
    closeBtns.forEach((b) =>
      b.addEventListener("click", () => {
        try {
          w.close();
        } catch {
          /* ignore */
        }
      }),
    );
  };

  try {
    w.addEventListener("load", wire);
  } catch {
    /* ignore */
  }
  // Fallbacks: blob/about:blank load timing varies across browsers, and
  // document.write() content is available synchronously. wire() is idempotent.
  wire();
  setTimeout(wire, 150);
  setTimeout(wire, 600);
}
