import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListVehicles } from "@workspace/api-client-react";
import { LicensePlate } from "@/components/license-plate";
import type { Vehicle } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, AlertCircle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { computeServiceStatus, type ServiceStatus, formatCzDate } from "@/lib/service-status";
import { differenceInDays, parseISO, isValid } from "date-fns";

type AlertKind = "stk" | "oil" | "brakes" | "timing" | "transmission" | "brakeFluid";

const KIND_LABEL: Record<AlertKind, string> = {
  stk: "STK",
  oil: "Výměna oleje",
  brakes: "Brzdy",
  timing: "Rozvody",
  transmission: "Olej převodovky",
  brakeFluid: "Brzdová kapalina",
};

type Severity = "overdue" | "due-soon";

interface VehicleAlert {
  kind: AlertKind;
  severity: Severity;
  detail: string;
}

function stkAlert(stk?: string | null): VehicleAlert | null {
  if (!stk) return null;
  const d = parseISO(stk);
  if (!isValid(d)) return null;
  const days = differenceInDays(d, new Date());
  if (days < 0) return { kind: "stk", severity: "overdue", detail: `propadlá ${formatCzDate(stk)}` };
  if (days <= 30) return { kind: "stk", severity: "due-soon", detail: `propadne ${formatCzDate(stk)} (za ${days} dní)` };
  return null;
}

function statusToAlert(kind: AlertKind, st: { status: ServiceStatus; dueLabel: string | null }): VehicleAlert | null {
  if (st.status === "overdue") return { kind, severity: "overdue", detail: st.dueLabel ?? "po termínu" };
  if (st.status === "due-soon") return { kind, severity: "due-soon", detail: st.dueLabel ?? "brzy po termínu" };
  return null;
}

function computeAlerts(v: Vehicle): VehicleAlert[] {
  const out: VehicleAlert[] = [];
  const stk = stkAlert(v.stkValidUntil);
  if (stk) out.push(stk);

  const oil = statusToAlert("oil", computeServiceStatus({
    lastDate: v.lastOilChangeDate, lastKm: v.lastOilChangeKm, currentKm: v.currentKm,
    intervalKm: v.oilChangeIntervalKm ?? 15000, intervalMonths: v.oilChangeIntervalMonths ?? 12,
  }));
  if (oil) out.push(oil);

  const brakes = statusToAlert("brakes", computeServiceStatus({
    lastDate: v.lastBrakesDate, intervalMonths: v.brakesIntervalMonths ?? 24,
  }));
  if (brakes) out.push(brakes);

  const timing = statusToAlert("timing", computeServiceStatus({
    lastDate: v.lastTimingDate, currentKm: v.currentKm,
    intervalKm: v.timingIntervalKm ?? 120000, intervalMonths: v.timingIntervalMonths ?? 120,
  }));
  if (timing) out.push(timing);

  const brakeFluid = statusToAlert("brakeFluid", computeServiceStatus({
    lastDate: v.lastBrakeFluidDate, intervalMonths: v.brakeFluidIntervalMonths ?? 24,
  }));
  if (brakeFluid) out.push(brakeFluid);

  if (v.transmission === "automatic") {
    const trans = statusToAlert("transmission", computeServiceStatus({
      lastDate: v.lastTransmissionOilDate, lastKm: v.lastTransmissionOilKm, currentKm: v.currentKm,
      intervalKm: v.transmissionOilIntervalKm ?? 60000, intervalMonths: v.transmissionOilIntervalMonths ?? 48,
    }));
    if (trans) out.push(trans);
  }

  return out;
}

export default function AlertsPage() {
  const { data: vehicles = [], isLoading } = useListVehicles();
  const [search, setSearch] = useState("");

  const [filters, setFilters] = useState<Record<AlertKind, boolean>>({
    stk: true, oil: true, brakes: true, timing: true, transmission: true, brakeFluid: true,
  });
  const [includeDueSoon, setIncludeDueSoon] = useState(true);

  const enabledKinds = (Object.keys(filters) as AlertKind[]).filter((k) => filters[k]);

  const rows = useMemo(() => {
    const term = search.trim().toUpperCase();
    return vehicles
      .map((v) => {
        const all = computeAlerts(v);
        const filtered = all.filter((a) =>
          filters[a.kind] && (includeDueSoon || a.severity === "overdue")
        );
        return { vehicle: v, alerts: filtered };
      })
      .filter(({ vehicle, alerts }) => {
        if (alerts.length === 0) return false;
        if (!term) return true;
        const hay = `${vehicle.licensePlate} ${vehicle.make} ${vehicle.model} ${vehicle.ownerName ?? ""}`.toUpperCase();
        return hay.includes(term);
      })
      .sort((a, b) => {
        const aOver = a.alerts.some((x) => x.severity === "overdue") ? 0 : 1;
        const bOver = b.alerts.some((x) => x.severity === "overdue") ? 0 : 1;
        if (aOver !== bOver) return aOver - bOver;
        return b.alerts.length - a.alerts.length;
      });
  }, [vehicles, filters, includeDueSoon, search]);

  const overdueCount = rows.filter((r) => r.alerts.some((a) => a.severity === "overdue")).length;
  const dueSoonOnlyCount = rows.length - overdueCount;

  function toggleAll(value: boolean) {
    setFilters({ stk: value, oil: value, brakes: value, timing: value, transmission: value, brakeFluid: value });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Po termínu / upozornění</h1>
          <p className="text-muted-foreground">Vozidla s propadlou STK nebo servisy po termínu.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Po termínu</div><div className="text-3xl font-bold text-destructive">{overdueCount}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Blíží se termín</div><div className="text-3xl font-bold text-amber-600">{dueSoonOnlyCount}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-sm text-muted-foreground">Celkem vozidel</div><div className="text-3xl font-bold">{vehicles.length}</div></CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Filtr</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => toggleAll(true)}>Vybrat vše</Button>
              <Button size="sm" variant="ghost" onClick={() => toggleAll(false)}>Zrušit vše</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {(Object.keys(KIND_LABEL) as AlertKind[]).map((k) => (
              <label key={k} className="flex items-center gap-2 cursor-pointer text-sm">
                <Checkbox checked={filters[k]} onCheckedChange={(c) => setFilters((f) => ({ ...f, [k]: c === true }))} />
                {KIND_LABEL[k]}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-4 items-center border-t pt-3">
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <Checkbox checked={includeDueSoon} onCheckedChange={(c) => setIncludeDueSoon(c === true)} />
              Zahrnout také „brzy po termínu"
            </label>
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9 h-9" placeholder="Hledat podle SPZ, značky, modelu nebo majitele…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Načítání…</div>
          ) : enabledKinds.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Vyberte alespoň jeden parametr filtru.</div>
          ) : rows.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Žádná vozidla po termínu podle zvoleného filtru. 👍</div>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 text-left">SPZ</th>
                    <th className="px-4 py-3 text-left">Vozidlo</th>
                    <th className="px-4 py-3 text-left">Majitel</th>
                    <th className="px-4 py-3 text-left">Upozornění</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map(({ vehicle: v, alerts }) => {
                    const hasOverdue = alerts.some((a) => a.severity === "overdue");
                    return (
                      <tr key={v.id} className={hasOverdue ? "bg-destructive/5 hover:bg-destructive/10" : "bg-amber-50/50 hover:bg-amber-50"}>
                        <td className="px-4 py-3 align-top">
                          <Link href={`/vehicles/${v.id}`}>
                            <span className="cursor-pointer">
                              <LicensePlate plate={v.licensePlate} size="md" />
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium">{v.make} {v.model}</div>
                          {v.year && <div className="text-xs text-muted-foreground">{v.year}</div>}
                        </td>
                        <td className="px-4 py-3 align-top text-muted-foreground">{v.ownerName ?? "—"}</td>
                        <td className="px-4 py-3 align-top">
                          <div className="flex flex-col gap-1.5">
                            {alerts.map((a, i) => (
                              <div key={i} className="flex items-start gap-2">
                                <Badge variant={a.severity === "overdue" ? "destructive" : "secondary"}
                                  className={a.severity === "due-soon" ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}>
                                  <AlertCircle className="h-3 w-3 mr-1" />{KIND_LABEL[a.kind]}
                                </Badge>
                                <span className="text-xs text-muted-foreground pt-0.5">{a.detail}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      <Label className="sr-only">filter</Label>
    </div>
  );
}
