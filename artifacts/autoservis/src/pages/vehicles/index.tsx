import { useMemo, useState } from "react";
import { useListVehicles } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LicensePlate } from "@/components/license-plate";
import { Search, Plus, AlertCircle, X } from "lucide-react";
import { Link, useSearch } from "wouter";
import { Badge } from "@/components/ui/badge";
import { differenceInDays, parseISO, format } from "date-fns";
import { cs } from "date-fns/locale";

export default function VehiclesList() {
  const [search, setSearch] = useState("");
  const searchString = useSearch();
  const filter = new URLSearchParams(searchString).get("filter");
  const stkFilter = filter === "stk";

  const { data: vehicles, isLoading } = useListVehicles(
    search.length > 2 ? { search } : {}
  );

  const filteredVehicles = useMemo(() => {
    if (!vehicles) return vehicles;
    if (stkFilter) {
      return vehicles
        .filter((v) => {
          if (!v.stkValidUntil) return false;
          const diff = differenceInDays(parseISO(v.stkValidUntil), new Date());
          return diff <= 30;
        })
        .sort((a, b) => (a.stkValidUntil ?? "").localeCompare(b.stkValidUntil ?? ""));
    }
    // Default view: alphabetical by make, then model (Czech collation, X3 < X5).
    return [...vehicles].sort((a, b) => {
      const make = (a.make ?? "").localeCompare(b.make ?? "", "cs", { sensitivity: "base", numeric: true });
      if (make !== 0) return make;
      return (a.model ?? "").localeCompare(b.model ?? "", "cs", { sensitivity: "base", numeric: true });
    });
  }, [vehicles, stkFilter]);

  const getStkStatus = (dateString?: string | null) => {
    if (!dateString) return null;
    const date = parseISO(dateString);
    const diff = differenceInDays(date, new Date());
    const label = format(date, "LLLL yyyy", { locale: cs });

    if (diff < 0) return <Badge variant="destructive" className="flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Propadlá STK ({label})</Badge>;
    if (diff <= 30) return <Badge className="bg-amber-500 hover:bg-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> STK brzy propadne ({label})</Badge>;
    return <Badge className="bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> STK do {label}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {stkFilter ? "Vozidla s blížící se STK" : "Vozidla"}
          </h1>
          <p className="text-muted-foreground mt-1">
            {stkFilter ? "Propadlá STK nebo do 30 dnů od expirace." : "Seznam všech evidovaných vozidel."}
          </p>
        </div>
        <Link href="/vehicles/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" /> Přidat vozidlo
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Hledat podle SPZ, značky, modelu nebo vlastníka..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {stkFilter && (
              <Link href="/vehicles">
                <Button variant="outline"><X className="h-4 w-4 mr-1" /> Zrušit filtr STK</Button>
              </Link>
            )}
          </div>

          <div className="rounded-md border">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Načítání...</div>
            ) : !filteredVehicles || filteredVehicles.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {stkFilter ? "Žádná vozidla s blížící se nebo propadlou STK." : "Žádná vozidla nebyla nalezena."}
              </div>
            ) : (
              <div className="w-full overflow-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground font-medium">
                    <tr>
                      <th className="px-4 py-3">SPZ</th>
                      <th className="px-4 py-3">Vozidlo</th>
                      <th className="px-4 py-3">Vlastník</th>
                      <th className="px-4 py-3">Rok</th>
                      <th className="px-4 py-3">Najeto</th>
                      <th className="px-4 py-3">STK stav</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredVehicles.map((v) => (
                      <tr key={v.id} className="hover:bg-accent/50 transition-colors group">
                        <td className="px-4 py-3">
                          <Link href={`/vehicles/${v.id}`}>
                            <span className="cursor-pointer">
                              <LicensePlate plate={v.licensePlate} size="md" />
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {v.make} {v.model}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {v.ownerName || "-"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {v.year || "-"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {v.currentKm ? `${v.currentKm.toLocaleString('cs-CZ')} km` : "-"}
                        </td>
                        <td className="px-4 py-3">
                          {getStkStatus(v.stkValidUntil)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}