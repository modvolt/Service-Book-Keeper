import { useMemo, useState } from "react";
import { useGetDashboardSummary, useListVehicles } from "@workspace/api-client-react";
import { LicensePlate } from "@/components/license-plate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Car, ClipboardList, Wrench, AlertTriangle, Search, User, X } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import { WorkOrderStatusBadge } from "@/lib/work-order-status";

export default function Dashboard() {
  const { data: summary, isLoading, isError } = useGetDashboardSummary();
  const [search, setSearch] = useState("");
  const trimmed = search.trim();
  const { data: searchResults = [], isFetching: searching } = useListVehicles(
    trimmed.length >= 2 ? { search: trimmed } : {},
    { query: { enabled: trimmed.length >= 2 } as any },
  );

  const grouped = useMemo(() => {
    if (trimmed.length < 2) return null;
    const q = trimmed.toLowerCase();
    const byPlate = searchResults.filter((v) => v.licensePlate.toLowerCase().includes(q));
    const byOwner = searchResults.filter(
      (v) => !byPlate.includes(v) && (v.ownerName?.toLowerCase().includes(q) ?? false),
    );
    const other = searchResults.filter((v) => !byPlate.includes(v) && !byOwner.includes(v));
    return { byPlate, byOwner, other };
  }, [searchResults, trimmed]);

  if (isLoading) {
    return <div className="space-y-4">
      <div className="h-8 w-48 bg-muted animate-pulse rounded"></div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[1,2,3,4].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl"></div>)}
      </div>
    </div>;
  }

  if (isError || !summary) {
    return <div>Chyba při načítání přehledu.</div>;
  }

  const getStatusBadge = (status: string) => <WorkOrderStatusBadge status={status} size="sm" />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Přehled</h1>
        <p className="text-muted-foreground mt-1">Stav dílny a aktuální práce.</p>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rychlé hledání — SPZ vozidla nebo jméno zákazníka…"
              className="pl-9 pr-9 h-11 text-base"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-2 p-1 rounded-md hover:bg-accent"
                aria-label="Smazat"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
          {grouped && (
            <div className="mt-3 border rounded-md max-h-80 overflow-auto">
              {searching && searchResults.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Hledám…</div>
              ) : searchResults.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Nic nenalezeno pro „{trimmed}".</div>
              ) : (
                <>
                  {grouped.byPlate.length > 0 && (
                    <div>
                      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50 flex items-center gap-1.5">
                        <Car className="h-3 w-3" /> Vozidla podle SPZ
                      </div>
                      {grouped.byPlate.map((v) => (
                        <Link key={v.id} href={`/vehicles/${v.id}`}>
                          <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent cursor-pointer border-t">
                            <LicensePlate plate={v.licensePlate} size="sm" />
                            <span className="flex-1">
                              <span className="font-medium">{v.make} {v.model}</span>
                              {v.ownerName && <span className="text-muted-foreground"> · {v.ownerName}</span>}
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                  {grouped.byOwner.length > 0 && (
                    <div>
                      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50 flex items-center gap-1.5 border-t">
                        <User className="h-3 w-3" /> Zákazníci
                      </div>
                      {grouped.byOwner.map((v) => (
                        <Link key={v.id} href={`/vehicles/${v.id}`}>
                          <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent cursor-pointer border-t">
                            <LicensePlate plate={v.licensePlate} size="sm" />
                            <span className="flex-1">
                              <span className="font-medium">{v.ownerName}</span>
                              <span className="text-muted-foreground"> · {v.make} {v.model}</span>
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                  {grouped.other.length > 0 && (
                    <div>
                      <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted/50 border-t">Další</div>
                      {grouped.other.map((v) => (
                        <Link key={v.id} href={`/vehicles/${v.id}`}>
                          <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-accent cursor-pointer border-t">
                            <LicensePlate plate={v.licensePlate} size="sm" />
                            <span className="flex-1">
                              <span className="font-medium">{v.make} {v.model}</span>
                              {v.ownerName && <span className="text-muted-foreground"> · {v.ownerName}</span>}
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Otevřené zakázky</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.openWorkOrders}</div>
            <p className="text-xs text-muted-foreground">
              {summary.inProgressWorkOrders || 0} právě probíhá
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Dokončeno tento měsíc</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.completedThisMonth}</div>
          </CardContent>
        </Card>

        <Link href="/vehicles?filter=stk">
          <Card className="cursor-pointer hover:bg-accent/50 transition-colors h-full">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Blížící se STK</CardTitle>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{summary.stkExpiringSoon}</div>
              <p className="text-xs text-muted-foreground">
                Vozidla s expirací do 30 dnů
              </p>
            </CardContent>
          </Card>
        </Link>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Celkem vozidel</CardTitle>
            <Car className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalVehicles}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="col-span-2">
          <CardHeader>
            <CardTitle>Nedávné zakázky</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {!summary.recentWorkOrders || summary.recentWorkOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">Zatím žádné zakázky.</p>
              ) : (
                summary.recentWorkOrders.map(order => (
                  <Link key={order.id} href={`/work-orders/${order.id}`}>
                    <div className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-accent/50 transition-colors cursor-pointer group">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <LicensePlate plate={order.licensePlate} size="lg" />
                          {getStatusBadge(order.status)}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-1">
                          {order.description || "Bez popisu"}
                        </p>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {format(new Date(order.createdAt), 'd. MMMM yyyy', { locale: cs })}
                      </div>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}