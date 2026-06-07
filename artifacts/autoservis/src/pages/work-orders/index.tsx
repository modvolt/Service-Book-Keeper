import { useState } from "react";
import { useListWorkOrders, getListWorkOrdersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { LicensePlate } from "@/components/license-plate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Wrench, Image as ImageIcon } from "lucide-react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { cs } from "date-fns/locale";
import { WorkOrderStatusBadge, WORK_ORDER_STATUSES, type WorkOrderStatus } from "@/lib/work-order-status";

const STATUS_OPTIONS = [
  { value: "all", label: "Všechny" },
  ...WORK_ORDER_STATUSES.map((s) => ({ value: s.value, label: s.label })),
];

function ServiceIcons({ order }: { order: { oilChange?: boolean; transmissionOil?: boolean; brakes?: boolean; timing?: boolean; stk?: boolean; otherWork?: string | null; otherServices?: string | null } }) {
  const items = [
    order.oilChange && "Olej",
    order.transmissionOil && "Olej převodovky",
    order.brakes && "Brzdy",
    order.timing && "Rozvody",
    order.stk && "STK",
    order.otherServices && "Ostatní úkony",
    order.otherWork && "Ostatní práce",
  ].filter(Boolean);
  if (!items.length) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Badge key={String(item)} variant="outline" className="text-xs">{item}</Badge>
      ))}
    </div>
  );
}

export default function WorkOrdersList() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const { data: workOrders, isLoading } = useListWorkOrders(
    status !== "all" ? { status: status as WorkOrderStatus } : {}
  );

  const filtered = workOrders?.filter(wo => {
    if (!search) return true;
    const s = search.toLowerCase();
    return wo.licensePlate.toLowerCase().includes(s) ||
      wo.description?.toLowerCase().includes(s) ||
      wo.make?.toLowerCase().includes(s) ||
      wo.model?.toLowerCase().includes(s) ||
      wo.ownerName?.toLowerCase().includes(s);
  });

  const dateStr = (d: string) => {
    try { return format(parseISO(d), 'd. M. yyyy', { locale: cs }); } catch { return d; }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Zakázky</h1>
          <p className="text-muted-foreground mt-1">Přehled všech servisních zakázek.</p>
        </div>
        <Link href="/work-orders/new">
          <Button><Plus className="mr-2 h-4 w-4" />Nová zakázka</Button>
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Hledat podle SPZ, zákazníka nebo popisu..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Načítání...</div>
          ) : !filtered || filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Wrench className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-30" />
              <p className="text-muted-foreground">Žádné zakázky nenalezeny.</p>
              <Link href="/work-orders/new">
                <Button variant="outline" className="mt-4"><Plus className="h-4 w-4 mr-2" />Vytvořit první zakázku</Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map(wo => (
                <Link key={wo.id} href={`/work-orders/${wo.id}`}>
                  <div className="flex items-center gap-4 px-6 py-4 hover:bg-accent/50 transition-colors cursor-pointer">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap mb-1">
                        <LicensePlate plate={wo.licensePlate} size="lg" />
                        {(wo.make || wo.model) && (
                          <span className="font-medium text-sm">{[wo.make, wo.model].filter(Boolean).join(" ")}</span>
                        )}
                        {wo.ownerName && (
                          <span className="text-sm text-muted-foreground">{wo.ownerName}</span>
                        )}
                        <WorkOrderStatusBadge status={wo.status} size="sm" />
                        {wo.photos && wo.photos.length > 0 && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <ImageIcon className="h-3 w-3" />{wo.photos.length}
                          </span>
                        )}
                      </div>
                      <ServiceIcons order={wo} />
                      {wo.description && <p className="text-sm text-muted-foreground mt-1 truncate">{wo.description}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm text-muted-foreground">{dateStr(wo.serviceDate ?? wo.createdAt)}</p>
                      {wo.km && <p className="text-xs text-muted-foreground">{wo.km.toLocaleString('cs-CZ')} km</p>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
