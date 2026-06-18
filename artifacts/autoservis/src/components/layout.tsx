import { Link, useLocation } from "wouter";
import { Wrench, Car, ClipboardList, Menu, LayoutDashboard, Package, Calendar, Settings as SettingsIcon, ScanLine, AlertTriangle, BarChart3, LogOut, Shield, KeyRound, RefreshCw, PackageSearch, UserCog } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetSettings, useLogout, getGetAuthStatusQueryKey, useGetAuthStatus } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useTheme } from "@/hooks/use-theme";
import { applyCurrentPalette, usePalette } from "@/hooks/use-palette";
import { clearCachesAndReload } from "@/lib/app-reload";

function RefreshButton({ className, iconOnly }: { className?: string; iconOnly?: boolean }) {
  const [refreshing, setRefreshing] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size={iconOnly ? "icon" : "sm"}
      disabled={refreshing}
      onClick={() => {
        setRefreshing(true);
        void clearCachesAndReload();
      }}
      className={className}
      title="Načíst aktuální data a obnovit aplikaci po aktualizaci"
      aria-label="Obnovit"
    >
      <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
      {!iconOnly && (
        <span className="ml-2 hidden sm:inline">{refreshing ? "Obnovuji…" : "Obnovit"}</span>
      )}
    </Button>
  );
}

const NAV_ITEMS = [
  { href: "/", label: "Přehled", icon: LayoutDashboard, color: "text-sky-600 dark:text-sky-400", bg: "hover:bg-sky-50 dark:hover:bg-sky-950/40", scannerHidden: true },
  { href: "/vehicles", label: "Vozidla", icon: Car, color: "text-indigo-600 dark:text-indigo-400", bg: "hover:bg-indigo-50 dark:hover:bg-indigo-950/40", scannerHidden: true },
  { href: "/work-orders", label: "Zakázky", icon: ClipboardList, color: "text-emerald-600 dark:text-emerald-400", bg: "hover:bg-emerald-50 dark:hover:bg-emerald-950/40", scannerHidden: true },
  { href: "/po-terminu", label: "Po termínu", icon: AlertTriangle, color: "text-rose-600 dark:text-rose-400", bg: "hover:bg-rose-50 dark:hover:bg-rose-950/40", scannerHidden: true },
  { href: "/kalendar", label: "Kalendář", icon: Calendar, color: "text-violet-600 dark:text-violet-400", bg: "hover:bg-violet-50 dark:hover:bg-violet-950/40", scannerHidden: true },
  { href: "/sklad", label: "Sklad", icon: Package, color: "text-amber-600 dark:text-amber-400", bg: "hover:bg-amber-50 dark:hover:bg-amber-950/40", scannerHidden: true },
  { href: "/statistiky", label: "Statistiky", icon: BarChart3, color: "text-cyan-600 dark:text-cyan-400", bg: "hover:bg-cyan-50 dark:hover:bg-cyan-950/40", scannerHidden: true },
  { href: "/vozovy-park", label: "Vozový park", icon: KeyRound, color: "text-orange-600 dark:text-orange-400", bg: "hover:bg-orange-50 dark:hover:bg-orange-950/40", scannerHidden: true },
  { href: "/nacteni-vozu", label: "Načtení vozu", icon: ScanLine, color: "text-teal-600 dark:text-teal-400", bg: "hover:bg-teal-50 dark:hover:bg-teal-950/40" },
  { href: "/sken-materialu", label: "Sken materiálu", icon: PackageSearch, color: "text-purple-600 dark:text-purple-400", bg: "hover:bg-purple-50 dark:hover:bg-purple-950/40" },
];

const BOTTOM_NAV_ITEMS = [
  { href: "/gdpr", label: "GDPR", icon: Shield, color: "text-slate-600 dark:text-slate-400", bg: "hover:bg-slate-100 dark:hover:bg-slate-800/50" },
  { href: "/nastaveni", label: "Nastavení", icon: SettingsIcon, color: "text-slate-600 dark:text-slate-400", bg: "hover:bg-slate-100 dark:hover:bg-slate-800/50" },
];

// The scanner's two scanning actions, shown as a fixed bottom bar on the phone.
const SCANNER_TABS = NAV_ITEMS.filter((item) => !item.scannerHidden);

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
  const queryClient = useQueryClient();
  const logout = useLogout({
    mutation: {
      onSuccess: () => {
        queryClient.setQueryData(getGetAuthStatusQueryKey(), { authenticated: false });
        queryClient.clear();
      },
    },
  });
  const { data: authStatus } = useGetAuthStatus({
    query: { queryKey: getGetAuthStatusQueryKey(), staleTime: 60_000 } as any,
  });
  const isScanner = authStatus?.role === "scanner";
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

  const visibleNavItems = isScanner
    ? NAV_ITEMS.filter((item) => !item.scannerHidden)
    : NAV_ITEMS;

  const NavLinksTop = ({ inSheet }: { inSheet?: boolean }) => {
    // For the scanner on a phone, the two scanning actions live in the fixed
    // bottom bar instead of the drawer; the desktop sidebar still lists them.
    if (isScanner && inSheet) return null;
    return <div className="flex flex-col space-y-1">{visibleNavItems.map(renderItem)}</div>;
  };

  const NavLinksBottom = () => (
    <div className="flex flex-col space-y-1">
      {!isScanner && BOTTOM_NAV_ITEMS.map(renderItem)}
      {isScanner && (
        <Link href="/scanner-profil">
          <div
            className={cn(
              "flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
              location === "/scanner-profil"
                ? "bg-primary text-primary-foreground"
                : "text-foreground/80 hover:bg-slate-100 dark:hover:bg-slate-800/50"
            )}
            onClick={() => setMobileMenuOpen(false)}
          >
            <UserCog className={cn("h-4 w-4 mr-3", location === "/scanner-profil" ? "" : "text-slate-600 dark:text-slate-400")} />
            Můj profil
          </div>
        </Link>
      )}
      <button
        type="button"
        disabled={logout.isPending}
        onClick={() => { setMobileMenuOpen(false); logout.mutate(); }}
        className={cn(
          "flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer text-left",
          "text-foreground/80 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
        )}
      >
        <LogOut className="h-4 w-4 mr-3 text-rose-600 dark:text-rose-400" />
        {logout.isPending ? "Odhlašování…" : "Odhlásit se"}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-muted/30" style={themeStyle}>
      <RefreshButton iconOnly className="hidden md:inline-flex fixed top-3 right-3 z-50 bg-card shadow-md rounded-md" />
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b bg-card">
        <Brand />
        <div className="flex items-center gap-2">
          <RefreshButton />
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
              <NavLinksTop inSheet />
            </ScrollArea>
            <div className="px-4 py-3 border-t">
              <NavLinksBottom />
            </div>
          </SheetContent>
        </Sheet>
        </div>
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

      <main className={cn("flex-1 overflow-auto", isScanner && "pb-28 md:pb-0")}>
        <div className={cn("max-w-[1800px] mx-auto p-4 md:p-8 lg:p-10", isScanner && "scanner-zoom")}>
          {children}
        </div>
      </main>

      {isScanner && (
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-40 flex border-t bg-card shadow-[0_-2px_10px_rgba(0,0,0,0.07)]"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {SCANNER_TABS.map((tab) => {
            const active = location === tab.href || location.startsWith(tab.href + "/");
            return (
              <Link key={tab.href} href={tab.href} className="flex-1">
                <div
                  className={cn(
                    "relative flex flex-col items-center justify-center gap-1 py-3 cursor-pointer transition-colors",
                    active ? "text-primary" : "text-foreground/60 hover:bg-muted/40"
                  )}
                >
                  {active && <span className="absolute top-0 inset-x-5 h-0.5 rounded-full bg-primary" />}
                  <tab.icon className={cn("h-7 w-7", active ? "" : tab.color)} />
                  <span className="text-base font-semibold">{tab.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      )}
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
