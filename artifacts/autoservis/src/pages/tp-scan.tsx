import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import { useGetVehicleByPlate } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScanLine, Car, Plus, ClipboardList, RotateCcw, MonitorSmartphone, CheckCircle2, Loader2, Gauge, Smartphone, Copy, Check } from "lucide-react";
import { TpScanDialog, type TpExtractedData } from "@/components/tp-scan-dialog";
import { useToast } from "@/hooks/use-toast";
import { setVehiclePrefill, setWorkOrderPrefill } from "@/lib/scan-prefill";
import { sendScanHandoff } from "@/lib/scan-channel";

// True on touch-first devices (phone/tablet). Used to decide whether to open the
// camera automatically (phone) or show a QR code to hand off to a phone (PC).
function detectTouchDevice(): boolean {
  if (typeof window === "undefined") return false;
  return (
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) ||
    window.matchMedia("(pointer: coarse)").matches
  );
}

// Absolute URL of the scan screen on this same deployment, for the QR/link.
function scanUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${window.location.origin}${base}/nacteni-vozu`;
}

type HandoffState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; kind: "new-vehicle" | "work-order" }
  | { status: "no-pc" }
  | { status: "error" };

export default function TpScanPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isTouch] = useState(detectTouchDevice);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [data, setData] = useState<TpExtractedData | null>(null);
  const [handoff, setHandoff] = useState<HandoffState>({ status: "idle" });
  const [copied, setCopied] = useState(false);

  // On a phone (touch device) open the camera automatically. On a PC keep it
  // closed and show a QR code so the user can hand off to their phone instead.
  useEffect(() => { if (isTouch) setDialogOpen(true); }, [isTouch]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(scanUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Kopírování se nezdařilo", description: scanUrl(), variant: "destructive" });
    }
  }

  const plateClean = data?.licensePlate?.replace(/\s+/g, "").toUpperCase() ?? "";
  const { data: foundVehicle, isFetching } = useGetVehicleByPlate(plateClean, {
    query: { enabled: plateClean.length >= 4 } as any,
  });

  async function handleExtracted(d: TpExtractedData) {
    setData(d);
    setHandoff({ status: "sending" });
    try {
      const result = await sendScanHandoff({
        licensePlate: d.licensePlate,
        vin: d.vin,
        registrationYear: d.registrationYear,
        engineDisplacement: d.engineDisplacement,
        make: d.make,
        model: d.model,
        odometerKm: d.odometerKm,
      });
      if (result.delivered > 0) {
        setHandoff({ status: "sent", kind: result.kind });
        toast({ title: "Odesláno do PC", description: "Pokračujte na počítači." });
      } else {
        setHandoff({ status: "no-pc" });
      }
    } catch {
      setHandoff({ status: "error" });
    }
  }

  function resetScan() {
    setData(null);
    setHandoff({ status: "idle" });
    setDialogOpen(true);
  }

  function goToNewVehicle() {
    if (!data) return;
    setVehiclePrefill({
      licensePlate: data.licensePlate,
      vin: data.vin,
      registrationYear: data.registrationYear,
      engineDisplacement: data.engineDisplacement,
      make: data.make,
      model: data.model,
      currentKm: data.odometerKm,
    });
    navigate("/vehicles/new");
  }

  function goToNewWorkOrder() {
    if (!data?.licensePlate) return;
    const higher =
      data.odometerKm != null &&
      (foundVehicle?.currentKm == null || data.odometerKm > foundVehicle.currentKm)
        ? data.odometerKm
        : null;
    setWorkOrderPrefill({ km: higher });
    navigate(`/work-orders/new?spz=${encodeURIComponent(data.licensePlate)}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ScanLine className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Načtení vozu</h1>
          <p className="text-muted-foreground">Vyfoťte na telefonu doklady vozu (malý technický průkaz, nebo SPZ a VIN) a případně tachometr. Údaje se rovnou objeví na počítači připravené ke kontrole.</p>
        </div>
      </div>

      {!data && !isTouch && (
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col md:flex-row items-center gap-8">
              <div className="bg-white p-4 rounded-lg border shrink-0">
                <QRCodeSVG value={scanUrl()} size={208} level="M" />
              </div>
              <div className="space-y-4 text-center md:text-left">
                <div className="flex items-center gap-2 justify-center md:justify-start">
                  <Smartphone className="h-6 w-6 text-primary" />
                  <h2 className="text-xl font-semibold">Naskenujte telefonem</h2>
                </div>
                <p className="text-muted-foreground max-w-md">
                  Naskenujte tento QR kód mobilem. Na telefonu se rovnou otevře fotoaparát pro načtení vozu a vyfocené údaje se objeví zde na počítači připravené ke kontrole.
                </p>
                <div className="flex items-center gap-2 justify-center md:justify-start">
                  <code className="text-sm bg-muted px-2 py-1 rounded font-mono break-all">{scanUrl()}</code>
                  <Button variant="outline" size="sm" onClick={copyLink}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="border-t pt-4">
                  <Button variant="ghost" onClick={() => setDialogOpen(true)}>
                    <ScanLine className="h-4 w-4 mr-2" />Načíst na tomto počítači
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!data && isTouch && (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <ScanLine className="h-12 w-12 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground">Otevřete fotoaparát a vyfoťte vůz.</p>
            <Button onClick={() => setDialogOpen(true)} size="lg" className="h-14 text-base px-8">
              <ScanLine className="h-5 w-5 mr-2" />Spustit načtení
            </Button>
          </CardContent>
        </Card>
      )}

      {data && (
        <Card>
          <CardHeader>
            <CardTitle>Načtené údaje</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Handoff status banner */}
            {handoff.status === "sending" && (
              <div className="flex items-center gap-2 bg-muted/50 border rounded-md p-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Odesílám do PC…
              </div>
            )}
            {handoff.status === "sent" && (
              <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-md p-4">
                <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                <div>
                  <p className="font-semibold text-emerald-800">Odesláno do PC</p>
                  <p className="text-sm text-emerald-700">
                    {handoff.kind === "work-order"
                      ? "Na počítači se otevřela nová zakázka pro toto vozidlo. Zkontrolujte a uložte."
                      : "Na počítači se otevřel formulář nového vozidla. Zkontrolujte a uložte."}
                  </p>
                </div>
              </div>
            )}
            {handoff.status === "no-pc" && (
              <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-md p-4">
                <MonitorSmartphone className="h-6 w-6 text-amber-600 shrink-0" />
                <div>
                  <p className="font-semibold text-amber-800">Žádný počítač není připojen</p>
                  <p className="text-sm text-amber-700">Otevřete aplikaci AutoServis na PC a načtěte vůz znovu, nebo pokračujte zde níže.</p>
                </div>
              </div>
            )}
            {handoff.status === "error" && (
              <div className="flex items-start gap-3 bg-rose-50 border border-rose-200 rounded-md p-4">
                <MonitorSmartphone className="h-6 w-6 text-rose-600 shrink-0" />
                <div>
                  <p className="font-semibold text-rose-800">Odeslání do PC selhalo</p>
                  <p className="text-sm text-rose-700">Zkuste to znovu, nebo pokračujte zde níže.</p>
                </div>
              </div>
            )}

            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div><dt className="text-muted-foreground">SPZ</dt><dd className="font-mono font-semibold text-base">{data.licensePlate ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">VIN</dt><dd className="font-mono">{data.vin ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Výrobce</dt><dd>{data.make ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Model / typ</dt><dd>{data.model ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Rok registrace</dt><dd>{data.registrationYear ?? "—"}</dd></div>
              <div><dt className="text-muted-foreground">Objem motoru</dt><dd>{data.engineDisplacement ? `${data.engineDisplacement} cm³` : "—"}</dd></div>
              <div className="col-span-2"><dt className="text-muted-foreground flex items-center gap-1"><Gauge className="h-3.5 w-3.5" />Stav tachometru</dt><dd>{data.odometerKm != null ? `${data.odometerKm.toLocaleString("cs-CZ")} km` : "—"}</dd></div>
            </dl>

            <div className="border-t pt-4 space-y-2">
              <p className="text-xs text-muted-foreground">Pokračovat zde na tomto zařízení:</p>
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
                {!foundVehicle && (
                  <Button onClick={goToNewVehicle}>
                    <Plus className="h-4 w-4 mr-2" />Vytvořit vozidlo s těmito údaji
                  </Button>
                )}
                <Button variant="outline" onClick={resetScan}>
                  <RotateCcw className="h-4 w-4 mr-2" />Načíst další vůz
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
