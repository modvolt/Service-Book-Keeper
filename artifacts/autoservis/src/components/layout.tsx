import { Link, useLocation } from "wouter";
import { Wrench, Car, ClipboardList, Menu, LayoutDashboard, Package, Calendar, Settings as SettingsIcon, ScanLine, AlertTriangle, BarChart3 } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { useGetSettings } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useTheme } from "@/hooks/use-theme";
import { applyCurrentPalette, usePalette } from "@/hooks/use-palette";

const NAV_ITEMS = [
  { href: "/", label: "Přehled", icon: LayoutDashboard, color: "text-sky-600 dark:text-sky-400", bg: "hover:bg-sky-50 dark:hover:bg-sky-950/40" },
  { href: "/vehicles", label: "Vozidla", icon: Car, color: "text-indigo-600 dark:text-indigo-400", bg: "hover:bg-indigo-50 dark:hover:bg-indigo-950/40" },
  { href: "/work-orders", label: "Zakázky", icon: ClipboardList, color: "text-emerald-600 dark:text-emerald-400", bg: "hover:bg-emerald-50 dark:hover:bg-emerald-950/40" },
  { href: "/po-terminu", label: "Po termínu", icon: AlertTriangle, color: "text-rose-600 dark:text-rose-400", bg: "hover:bg-rose-50 dark:hover:bg-rose-950/40" },
  { href: "/kalendar", label: "Kalendář", icon: Calendar, color: "text-violet-600 dark:text-violet-400", bg: "hover:bg-violet-50 dark:hover:bg-violet-950/40" },
  { href: "/sklad", label: "Sklad", icon: Package, color: "text-amber-600 dark:text-amber-400", bg: "hover:bg-amber-50 dark:hover:bg-amber-950/40" },
  { href: "/statistiky", label: "Statistiky", icon: BarChart3, color: "text-cyan-600 dark:text-cyan-400", bg: "hover:bg-cyan-50 dark:hover:bg-cyan-950/40" },
  { href: "/nacteni-tp", label: "Načtení TP", icon: ScanLine, color: "text-teal-600 dark:text-teal-400", bg: "hover:bg-teal-50 dark:hover:bg-teal-950/40" },
];

const BOTTOM_NAV_ITEMS = [
  { href: "/nastaveni", label: "Nastavení", icon: SettingsIcon, color: "text-slate-600 dark:text-slate-400", bg: "hover:bg-slate-100 dark:hover:bg-slate-800/50" },
];

function hexToHslTriplet(hex: string): string | null {
  const m = /^#?([a-f\d]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: settings } = useGetSettings();
  const { theme } = useTheme();
  usePalette();

  useEffect(() => { applyCurrentPalette(); }, [theme]);

  const themeStyle = useMemo(() => {
    if (!settings?.primaryColor) return undefined;
    const triplet = hexToHslTriplet(settings.primaryColor);
    if (!triplet) return undefined;
    const fg = isLight(settings.primaryColor) ? "220 10% 10%" : "0 0% 100%";
    return { "--primary": triplet, "--primary-foreground": fg, "--sidebar-primary": triplet, "--sidebar-primary-foreground": fg } as React.CSSProperties;
  }, [settings?.primaryColor]);

  const companyName = settings?.companyName?.trim() || "AutoServis";
  const logoUrl = settings?.logoUrl ? `/api/storage${settings.logoUrl}` : null;

  const Brand = ({ large }: { large?: boolean }) => (
    <div className="flex items-center gap-2 font-semibold min-w-0">
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={companyName}
          className={large ? "h-28 max-h-28 w-auto max-w-full object-contain" : "h-12 max-h-12 w-auto max-w-full object-contain"}
        />
      ) : (
        <>
          <Wrench className={large ? "h-6 w-6 text-primary shrink-0" : "h-5 w-5 text-primary shrink-0"} />
          <span className={large ? "text-xl truncate" : "text-lg truncate"}>{companyName}</span>
        </>
      )}
    </div>
  );

  const renderItem = (item: typeof NAV_ITEMS[number]) => {
    const active = location === item.href || (item.href !== "/" && location.startsWith(item.href));
    return (
      <Link key={item.href} href={item.href}>
        <div
          className={cn(
            "flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
            active
              ? "bg-primary text-primary-foreground"
              : cn("text-foreground/80", item.bg)
          )}
          onClick={() => setMobileMenuOpen(false)}
        >
          <item.icon className={cn("h-4 w-4 mr-3", active ? "" : item.color)} />
          {item.label}
        </div>
      </Link>
    );
  };

  const NavLinksTop = () => (
    <div className="flex flex-col space-y-1">{NAV_ITEMS.map(renderItem)}</div>
  );

  const NavLinksBottom = () => (
    <div className="flex flex-col space-y-1">{BOTTOM_NAV_ITEMS.map(renderItem)}</div>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-muted/30" style={themeStyle}>
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b bg-card">
        <Brand />
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 flex flex-col">
            <div className="px-6 py-6 border-b">
              <Brand large />
            </div>
            <ScrollArea className="flex-1 px-4 py-4">
              <NavLinksTop />
            </ScrollArea>
            <div className="px-4 py-3 border-t">
              <NavLinksBottom />
            </div>
          </SheetContent>
        </Sheet>
      </header>

      <aside className="hidden md:flex w-64 flex-col border-r bg-card h-screen sticky top-0">
        <div className="px-6 py-6 border-b">
          <Brand large />
        </div>
        <ScrollArea className="flex-1 px-4 py-4">
          <NavLinksTop />
        </ScrollArea>
        <div className="px-4 py-3 border-t">
          <NavLinksBottom />
        </div>
        <div className="p-4 border-t text-xs text-muted-foreground">
          AutoServis v1.0
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

function isLight(hex: string): boolean {
  const m = /^#?([a-f\d]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  // perceived luminance
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160;
}
