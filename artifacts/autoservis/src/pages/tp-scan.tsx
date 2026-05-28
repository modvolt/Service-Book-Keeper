import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useGetVehicleByPlate } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScanLine, Car, Plus, ClipboardList, RotateCcw } from "lucide-react";
import { TpScanDialog, type TpExtractedData } from "@/components/tp-scan-dialog";
import { useToast } from "@/hooks/use-toast";

const PREFILL_KEY = "tpImportPrefill";

export type TpPrefill = {
  licensePlate?: string | null;
  vin?: string | null;
  registrationYear?: number | null;
  engineDisplacement?: number | null;
};

export function setTpPrefill(data: TpPrefill) {
  try { sessionStorage.setItem(PREFILL_KEY, JSON.stringify(data)); } catch {}
}
export function takeTpPrefill(): TpPrefill | null {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PREFILL_KEY);
    return JSON.parse(raw);
  } catch { return null; }
}

export default function TpScanPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(true);
  const [data, setData] = useState<TpExtractedData | null>(null);

  // Open camera dialog automatically on mount
  useEffect(() => { setDialogOpen(true); }, []);

  const plateClean = data?.licensePlate?.replace(/\s+/g, "").toUpperCase() ?? "";
  const { data: foundVehicle, isFetching } = useGetVehicleByPlate(plateClean, {
    query: { enabled: plateClean.length >= 4 } as any,
  });

  function handleExtracted(d: TpExtractedData) {
    setData(d);
    toast({ title: "Údaje načteny", description: d.licensePlate ? `SPZ: ${d.licensePlate}` : "Údaje byly zpracovány." });
  }

  function goToNewVehicle() {
    if (!data) return;
    setTpPrefill({
      licensePlate: data.licensePlate,
      vin: data.vin,
      registrationYear: data.registrationYear,
      engineDisplacement: data.engineDisplacement,
    });
    navigate("/vehicles/new");
  }

  function goToNewWorkOrder() {
    if (!data?.licensePlate) return;
    navigate(`/work-orders/new?spz=${encodeURIComponent(data.licensePlate)}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ScanLine className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Načtení technického průkazu</h1>
          <p className="text-muted-foreground">Vyfoťte malý TP a údaje se automaticky předvyplní k vozidlu nebo zakázce.</p>
        </div>
      </div>

      {!data ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <ScanLine className="h-12 w-12 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">Otevřete fotoaparát a vyfoťte technický průkaz.</p>
            <Button onClick={() => setDialogOpen(true)} size="lg">
              <ScanLine className="h-4 w-4 mr-2" />Spustit načtení
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Načtené údaje</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div><dt className="text-muted-foreground">SPZ</dt><dd className="font-mono font-semibold text-base">{data.licensePlate ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">VIN</dt><dd className="font-mono">{data.vin ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Rok registrace</dt><dd>{data.registrationYear ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Objem motoru</dt><dd>{data.engineDisplacement ? `${data.engineDisplacement} cm³` : "—"}</dd></div>
            </dl>

            <div className="border-t pt-4 space-y-2">
              {plateClean.length >= 4 && (
                <>
                  {isFetching && <p className="text-sm text-muted-foreground">Hledám vozidlo v evidenci…</p>}
                  {!isFetching && foundVehicle && (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 space-y-2">
                      <p className="text-sm">
                        <span className="font-medium">Vozidlo nalezeno:</span>{" "}
                        {foundVehicle.make} {foundVehicle.model}
                        {foundVehicle.ownerName ? ` · ${foundVehicle.ownerName}` : ""}
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        <Link href={`/vehicles/${foundVehicle.id}`}>
                          <Button size="sm"><Car className="h-4 w-4 mr-2" />Otevřít vozidlo</Button>
                        </Link>
                        <Button size="sm" variant="outline" onClick={goToNewWorkOrder}>
                          <ClipboardList className="h-4 w-4 mr-2" />Nová zakázka pro toto vozidlo
                        </Button>
                      </div>
                    </div>
                  )}
                  {!isFetching && !foundVehicle && (
                    <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm">
                      Vozidlo se SPZ <span className="font-mono font-semibold">{data.licensePlate}</span> není v evidenci. Můžete ho založit s předvyplněnými údaji.
                    </div>
                  )}
                </>
              )}

              <div className="flex gap-2 flex-wrap pt-2">
                <Button onClick={goToNewVehicle}>
                  <Plus className="h-4 w-4 mr-2" />Vytvořit vozidlo s těmito údaji
                </Button>
                <Button variant="outline" onClick={() => { setData(null); setDialogOpen(true); }}>
                  <RotateCcw className="h-4 w-4 mr-2" />Načíst znovu
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <TpScanDialog open={dialogOpen} onOpenChange={setDialogOpen} onExtracted={handleExtracted} />
    </div>
  );
}
