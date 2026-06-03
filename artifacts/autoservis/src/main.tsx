import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { recoverFromStaleVersion, markRecoverySuccessful } from "@/lib/app-reload";

// A failed dynamic import after a new deploy means the cached service worker is
// serving an index that points at chunks that no longer exist. Recover by
// clearing caches and reloading once.
window.addEventListener("vite:preloadError", (e) => {
  e.preventDefault();
  recoverFromStaleVersion();
});

createRoot(document.getElementById("root")!).render(<App />);

// If the app is still up a few seconds after boot, treat the load as healthy and
// clear the one-shot recovery flag so a future version skew can recover again.
setTimeout(markRecoverySuccessful, 5000);
