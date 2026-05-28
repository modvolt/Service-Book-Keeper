import { useState } from "react";
import { useListVehicles } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Plus, AlertCircle } from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { differenceInDays, parseISO } from "date-fns";

export default function VehiclesList() {
  const [search, setSearch] = useState("");
  const { data: vehicles, isLoading } = useListVehicles(
    search.length > 2 ? { search } : {}
  );

  const getStkStatus = (dateString?: string | null) => {
    if (!dateString) return null;
    const date = parseISO(dateString);
    const diff = differenceInDays(date, new Date());
    
    if (diff < 0) return <Badge variant="destructive" className="flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Propadlá STK</Badge>;
    if (diff <= 30) return <Badge className="bg-amber-500 hover:bg-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> STK brzy propadne</Badge>;
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Vozidla</h1>
          <p className="text-muted-foreground mt-1">Seznam všech evidovaných vozidel.</p>
        </div>
        <Link href="/vehicles/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" /> Přidat vozidlo
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative mb-6">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Hledat podle SPZ, značky nebo modelu..."
              className="pl-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div className="rounded-md border">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Načítání...</div>
            ) : !vehicles || vehicles.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">Žádná vozidla nebyla nalezena.</div>
            ) : (
              <div className="w-full overflow-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground font-medium">
                    <tr>
                      <th className="px-4 py-3">SPZ</th>
                      <th className="px-4 py-3">Vozidlo</th>
                      <th className="px-4 py-3">Rok</th>
                      <th className="px-4 py-3">Najeto</th>
                      <th className="px-4 py-3">STK stav</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {vehicles.map((v) => (
                      <tr key={v.id} className="hover:bg-accent/50 transition-colors group">
                        <td className="px-4 py-3">
                          <Link href={`/vehicles/${v.id}`}>
                            <span className="font-mono font-bold tracking-wider uppercase text-foreground group-hover:text-primary transition-colors cursor-pointer">
                              {v.licensePlate}
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {v.make} {v.model}
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