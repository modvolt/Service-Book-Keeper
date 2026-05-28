import { useEffect, useState, useCallback } from "react";

const STORAGE_KEY = "autoservis-palette";

export type PaletteId = "default" | "modra" | "zelena" | "bezova" | "ruzova" | "siva";

type PaletteVars = {
  background: string;
  muted: string;
  card: string;
  border: string;
};

type Palette = {
  id: PaletteId;
  label: string;
  swatch: string;
  light: PaletteVars;
  dark: PaletteVars;
};

export const PALETTES: Palette[] = [
  {
    id: "default", label: "Výchozí", swatch: "#fafafa",
    light: { background: "0 0% 98%",  muted: "220 10% 95%", card: "0 0% 100%",  border: "220 10% 85%" },
    dark:  { background: "220 10% 10%", muted: "220 10% 15%", card: "220 10% 13%", border: "220 10% 20%" },
  },
  {
    id: "modra", label: "Modrá", swatch: "#eff6ff",
    light: { background: "214 50% 97%", muted: "214 40% 93%", card: "0 0% 100%",   border: "214 30% 85%" },
    dark:  { background: "220 35% 11%", muted: "220 30% 16%", card: "220 35% 14%", border: "220 30% 22%" },
  },
  {
    id: "zelena", label: "Zelená", swatch: "#f0fdf4",
    light: { background: "150 45% 97%", muted: "150 35% 93%", card: "0 0% 100%",   border: "150 25% 85%" },
    dark:  { background: "155 25% 10%", muted: "155 22% 14%", card: "155 25% 12%", border: "155 20% 20%" },
  },
  {
    id: "bezova", label: "Béžová", swatch: "#fdf6ec",
    light: { background: "38 55% 96%",  muted: "38 40% 92%",  card: "40 60% 99%",  border: "38 30% 84%" },
    dark:  { background: "30 12% 11%",  muted: "30 12% 15%",  card: "30 12% 13%",  border: "30 12% 22%" },
  },
  {
    id: "ruzova", label: "Růžová", swatch: "#fdf2f8",
    light: { background: "330 60% 97%", muted: "330 45% 94%", card: "0 0% 100%",   border: "330 30% 86%" },
    dark:  { background: "330 18% 11%", muted: "330 16% 15%", card: "330 18% 13%", border: "330 15% 22%" },
  },
  {
    id: "siva", label: "Šedá", swatch: "#f4f4f5",
    light: { background: "220 8% 94%",  muted: "220 8% 90%",  card: "0 0% 100%",   border: "220 8% 82%" },
    dark:  { background: "220 5% 9%",   muted: "220 5% 13%",  card: "220 5% 11%",  border: "220 5% 19%" },
  },
];

function applyPalette(id: PaletteId) {
  const p = PALETTES.find((x) => x.id === id) ?? PALETTES[0];
  const root = document.documentElement;
  const isDark = root.classList.contains("dark");
  const vars = isDark ? p.dark : p.light;
  root.style.setProperty("--background", vars.background);
  root.style.setProperty("--muted", vars.muted);
  root.style.setProperty("--card", vars.card);
  root.style.setProperty("--border", vars.border);
}

export function applyCurrentPalette() {
  const stored = (typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY)) as PaletteId | null;
  applyPalette(stored ?? "default");
}

export function usePalette() {
  const [palette, setPaletteState] = useState<PaletteId>(() => {
    if (typeof window === "undefined") return "default";
    const stored = localStorage.getItem(STORAGE_KEY) as PaletteId | null;
    const id = stored ?? "default";
    applyPalette(id);
    return id;
  });

  const setPalette = useCallback((id: PaletteId) => {
    setPaletteState(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
    applyPalette(id);
  }, []);

  useEffect(() => { applyPalette(palette); }, [palette]);

  return { palette, setPalette, palettes: PALETTES };
}
