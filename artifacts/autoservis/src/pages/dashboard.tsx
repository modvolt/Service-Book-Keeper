import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Car, ClipboardList, Wrench, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { format } from "date-fns";
import { cs } from "date-fns/locale";
import { Badge } from "@/components/ui/badge";
import { WorkOrderStatusBadge } from "@/lib/work-order-status";

export default function Dashboard() {
  const { data: summary, isLoading, isError } = useGetDashboardSummary();

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

        <Card>
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
                          <span className="font-bold text-lg font-mono uppercase tracking-wider">{order.licensePlate}</span>
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