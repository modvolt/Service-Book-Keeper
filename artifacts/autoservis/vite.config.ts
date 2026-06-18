import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const rawBasePath = process.env.BASE_PATH;

if (!rawBasePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

// Normalize to always have a leading and trailing slash so PWA start_url,
// scope, navigateFallback and Vite asset URLs concatenate correctly.
const basePath = `/${rawBasePath.replace(/^\/+|\/+$/g, "")}/`.replace(/\/\/+/g, "/");

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // Register the service worker via an external same-origin script
      // (registerSW.js) rather than an inline <script>, so the production
      // Content-Security-Policy (script-src 'self') applied when the SPA is
      // served by the API server allows it without 'unsafe-inline'.
      injectRegister: "script",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "AutoServis",
        short_name: "AutoServis",
        description: "Správa autoservisu — vozidla, zakázky a servisní historie.",
        lang: "cs",
        theme_color: "#1e3a8a",
        background_color: "#ffffff",
        display: "standalone",
        orientation: "any",
        start_url: basePath,
        scope: basePath,
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        navigateFallback: `${basePath}index.html`,
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
        // Drop precache entries from previous builds when the new SW activates, so
        // a published update can't keep serving stale chunks (the cause of
        // post-deploy "removeChild" crashes).
        cleanupOutdatedCaches: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // Production builds run in a memory-constrained container (4GB). Limit how
    // many files Rollup transforms in parallel to cap the transform-phase
    // memory spike (the point the OOM killer struck during deploy). Slightly
    // slower build, far lower peak RSS.
    rollupOptions: {
      maxParallelFileOps: 3,
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
