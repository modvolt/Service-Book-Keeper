import { Link, useLocation } from "wouter";
import { Wrench, Car, ClipboardList, Menu, LayoutDashboard, Package } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

const NAV_ITEMS = [
  { href: "/", label: "Přehled", icon: LayoutDashboard },
  { href: "/vehicles", label: "Vozidla", icon: Car },
  { href: "/work-orders", label: "Zakázky", icon: ClipboardList },
  { href: "/sklad", label: "Sklad", icon: Package },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const NavLinks = () => (
    <div className="flex flex-col space-y-1">
      {NAV_ITEMS.map((item) => (
        <Link key={item.href} href={item.href}>
          <div
            className={cn(
              "flex items-center px-3 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer",
              location === item.href || (item.href !== "/" && location.startsWith(item.href))
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground"
            )}
            onClick={() => setMobileMenuOpen(false)}
          >
            <item.icon className="h-4 w-4 mr-3" />
            {item.label}
          </div>
        </Link>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-muted/30">
      <header className="md:hidden flex items-center justify-between px-4 py-3 border-b bg-card">
        <div className="flex items-center gap-2 font-semibold text-lg">
          <Wrench className="h-5 w-5 text-primary" />
          <span>AutoServis</span>
        </div>
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <div className="px-6 py-6 border-b flex items-center gap-2 font-semibold text-xl">
              <Wrench className="h-6 w-6 text-primary" />
              <span>AutoServis</span>
            </div>
            <ScrollArea className="flex-1 px-4 py-4">
              <NavLinks />
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </header>

      <aside className="hidden md:flex w-64 flex-col border-r bg-card h-screen sticky top-0">
        <div className="px-6 py-6 border-b flex items-center gap-2 font-semibold text-xl">
          <Wrench className="h-6 w-6 text-primary" />
          <span>AutoServis</span>
        </div>
        <ScrollArea className="flex-1 px-4 py-4">
          <NavLinks />
        </ScrollArea>
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
