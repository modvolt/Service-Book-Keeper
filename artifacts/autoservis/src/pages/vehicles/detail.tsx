import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { LicensePlate } from "@/components/license-plate";
import { useGetVehicle, useUpdateVehicle, useDeleteVehicle, useCreateServiceRecord, useDeleteServiceRecord, useListVehicleMakes, useListVehicleModels, useGetSettings, useRecomputeVehicleStatus, useListVehicleReminderLog, getGetVehicleQueryKey, getListServiceRecordsQueryKey, getListVehiclesQueryKey } from "@workspace/api-client-react";
import { VehicleHistoryExportDialog } from "@/components/vehicle-history-export-dialog";
import { ChangeHistory } from "@/components/change-history";
import { AutocompleteInput } from "@/components/autocomplete-input";
import { AresButton } from "@/components/ares-button";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { FLEET_OWNER_NAME } from "@/lib/fleet";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, Car, Wrench, Plus, Trash2, ClipboardList, Edit, User, FileDown, RefreshCw, BellRing } from "lucide-react";
import { WorkOrderStatusBadge } from "@/lib/work-order-status";
import { format, differenceInDays, parseISO, isValid } from "date-fns";
import { cs } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { computeServiceStatus, type ServiceStatus } from "@/lib/service-status";
import { getApiErrorMessage } from "@/lib/api-error";

type ServiceCategory =
  | "oil" | "transmissionOil" | "brakes" | "brakeFluid" | "timing"
  | "stk" | "tires" | "diagnostics" | "lights" | "axle" | "shocks" | "geometry";

const SERVICE_BADGE_STYLES: Record<ServiceCategory, string> = {
  oil:             "bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-100",
  transmissionOil: "bg-yellow-100 text-yellow-900 border-yellow-300 hover:bg-yellow-100",
  brakes:          "bg-red-100 text-red-900 border-red-300 hover:bg-red-100",
  brakeFluid:      "bg-rose-100 text-rose-900 border-rose-300 hover:bg-rose-100",
  timing:          "bg-purple-100 text-purple-900 border-purple-300 hover:bg-purple-100",
  stk:             "bg-emerald-100 text-emerald-900 border-emerald-300 hover:bg-emerald-100",
  tires:           "bg-cyan-100 text-cyan-900 border-cyan-300 hover:bg-cyan-100",
  diagnostics:     "bg-blue-100 text-blue-900 border-blue-300 hover:bg-blue-100",
  lights:          "bg-sky-100 text-sky-900 border-sky-300 hover:bg-sky-100",
  axle:            "bg-indigo-100 text-indigo-900 border-indigo-300 hover:bg-indigo-100",
  shocks:          "bg-violet-100 text-violet-900 border-violet-300 hover:bg-violet-100",
  geometry:        "bg-teal-100 text-teal-900 border-teal-300 hover:bg-teal-100",
};

function ServiceBadge({ category, children }: { category: ServiceCategory; children: React.ReactNode }) {
  return <Badge variant="outline" className={cn("text-xs", SERVICE_BADGE_STYLES[category])}>{children}</Badge>;
}

const REMINDER_KEY_LABELS: Record<string, string> = {
  stk: "STK",
  oil: "Výměna oleje",
  brakes: "Brzdy",
  timing: "Rozvody",
  brakeFluid: "Brzdová kapalina",
  transmissionOil: "Olej převodovky",
};

function reminderKeyLabel(key: string): string {
  return REMINDER_KEY_LABELS[key] ?? key;
}

function StkBadge({ date }: { date?: string | null }) {
  if (!date) return <span className="text-muted-foreground">-</span>;
  const d = parseISO(date);
  if (!isValid(d)) return <span>{date}</span>;
  const diff = differenceInDays(d, new Date());
  if (diff < 0) return <Badge variant="destructive">Propadlá ({format(d, 'd. M. yyyy')})</Badge>;
  if (diff <= 30) return <Badge className="bg-amber-500 text-white">Brzy propadne ({format(d, 'd. M. yyyy')})</Badge>;
  return <Badge className="bg-emerald-600 text-white">Platná do {format(d, 'd. M. yyyy')}</Badge>;
}

function StatusPill({ status }: { status: ServiceStatus }) {
  if (status === "overdue") return <Badge variant="destructive" className="text-xs">Po termínu</Badge>;
  if (status === "due-soon") return <Badge className="bg-amber-500 text-white text-xs">Blíží se</Badge>;
  if (status === "ok") return <Badge className="bg-emerald-600 text-white text-xs">OK</Badge>;
  return null;
}

function ServiceRow({
  label, lastDate, lastKm, currentKm, intervalKm, intervalMonths,
}: {
  label: string;
  lastDate?: string | null;
  lastKm?: number | null;
  currentKm?: number | null;
  intervalKm?: number | null;
  intervalMonths?: number | null;
}) {
  const r = computeServiceStatus({ lastDate, lastKm, currentKm, intervalKm, intervalMonths });
  const rowBg =
    r.status === "overdue"
      ? "bg-destructive/10 border-l-4 border-l-destructive pl-2"
      : r.status === "due-soon"
      ? "bg-amber-50 border-l-4 border-l-amber-500 pl-2"
      : "";
  const agoCls =
    r.status === "overdue"
      ? "text-destructive font-medium"
      : r.status === "due-soon"
      ? "text-amber-700"
      : "text-muted-foreground";
  const intervalLabel = [
    intervalKm ? `${intervalKm.toLocaleString("cs-CZ")} km` : null,
    intervalMonths ? `${intervalMonths} měs.` : null,
  ].filter(Boolean).join(" / ");
  return (
    <div className={`flex items-start justify-between py-2 border-b last:border-b-0 gap-3 rounded-sm ${rowBg}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-muted-foreground">{label}</span>
          <StatusPill status={r.status} />
        </div>
        {r.agoLabel && <p className={`text-xs mt-0.5 ${agoCls}`}>{r.agoLabel}</p>}
        {intervalLabel && (
          <p className="text-[11px] text-muted-foreground mt-0.5">Interval: {intervalLabel}</p>
        )}
      </div>
      <div className="text-right shrink-0">
        {lastDate && isValid(parseISO(lastDate)) ? (
          <span className="text-sm">{format(parseISO(lastDate), 'd. M. yyyy', { locale: cs })}</span>
        ) : (
          <span className="text-sm text-muted-foreground">nezadáno</span>
        )}
        {r.dueLabel && (
          <p className={`text-xs mt-0.5 ${r.status === "overdue" ? "text-destructive font-medium" : r.status === "due-soon" ? "text-amber-700" : "text-muted-foreground"}`}>{r.dueLabel}</p>
        )}
      </div>
    </div>
  );
}

export default function VehicleDetail() {
  const [, params] = useRoute("/vehicles/:id");
  const [, navigate] = useLocation();
  const id = params ? parseInt(params.id, 10) : NaN;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: vehicle, isLoading, isError } = useGetVehicle(id, { query: { enabled: !isNaN(id) } as any });
  const { data: settings } = useGetSettings();
  const { data: reminderLog = [] } = useListVehicleReminderLog(id, { query: { enabled: !isNaN(id) } as any });

  const [editOpen, setEditOpen] = useState(false);
  const [addServiceOpen, setAddServiceOpen] = useState(false);

  const updateVehicle = useUpdateVehicle();
  const deleteVehicle = useDeleteVehicle();
  const recompute = useRecomputeVehicleStatus();
  const createRecord = useCreateServiceRecord();
  const deleteRecord = useDeleteServiceRecord();

  const hasOpenOrders = (vehicle?.openWorkOrders?.length ?? 0) > 0;

  const [editForm, setEditForm] = useState({
    make: "", model: "", year: "", color: "", vin: "", currentKm: "", notes: "", stkValidUntil: "",
    isFleet: false,
    engineDisplacement: "",
    transmission: "manual" as "manual" | "automatic",
    ownerType: "private" as "private" | "company",
    ownerName: "", ownerAddress: "", ownerIco: "", ownerDic: "", ownerPhone: "", ownerEmail: "",
    lastOilChangeKm: "", lastOilChangeDate: "", lastBrakesDate: "", lastTimingDate: "",
    lastTransmissionOilDate: "", lastTransmissionOilKm: "",
    lastBrakeFluidDate: "",
    oilChangeIntervalKm: "", oilChangeIntervalMonths: "",
    transmissionOilIntervalKm: "", transmissionOilIntervalMonths: "",
    brakesIntervalMonths: "", timingIntervalKm: "", timingIntervalMonths: "",
    brakeFluidIntervalMonths: "",
  });

  const { data: editMakeOptions = [] } = useListVehicleMakes();
  const { data: editModelOptions = [] } = useListVehicleModels(
    { make: editForm.make },
    { query: { enabled: editForm.make.trim().length > 0 } as any }
  );

  const [serviceForm, setServiceForm] = useState({
    date: new Date().toISOString().split("T")[0],
    km: "", description: "",
    oilChanged: false, transmissionOilChanged: false, brakesServiced: false,
    timingServiced: false, brakeFluidChanged: false, stkPassed: false, otherWork: "", technician: ""
  });

  const isAutomatic = vehicle?.transmission === "automatic";
  const isCompany = vehicle?.ownerType === "company";

  function openEdit() {
    if (!vehicle) return;
    setEditForm({
      make: vehicle.make, model: vehicle.model, year: vehicle.year?.toString() ?? "",
      color: vehicle.color ?? "", vin: vehicle.vin ?? "", currentKm: vehicle.currentKm?.toString() ?? "",
      notes: vehicle.notes ?? "", stkValidUntil: vehicle.stkValidUntil ?? "",
      isFleet: vehicle.isFleet ?? false,
      engineDisplacement: vehicle.engineDisplacement?.toString() ?? "",
      transmission: (vehicle.transmission === "automatic" ? "automatic" : "manual"),
      ownerType: (vehicle.ownerType === "company" ? "company" : "private"),
      ownerName: vehicle.ownerName ?? "",
      ownerAddress: vehicle.ownerAddress ?? "",
      ownerIco: vehicle.ownerIco ?? "",
      ownerDic: vehicle.ownerDic ?? "",
      ownerPhone: vehicle.ownerPhone ?? "",
      ownerEmail: vehicle.ownerEmail ?? "",
      lastOilChangeKm: vehicle.lastOilChangeKm?.toString() ?? "",
      lastOilChangeDate: vehicle.lastOilChangeDate ?? "", lastBrakesDate: vehicle.lastBrakesDate ?? "",
      lastTimingDate: vehicle.lastTimingDate ?? "",
      lastTransmissionOilDate: vehicle.lastTransmissionOilDate ?? "",
      lastTransmissionOilKm: vehicle.lastTransmissionOilKm?.toString() ?? "",
      oilChangeIntervalKm: vehicle.oilChangeIntervalKm?.toString() ?? "",
      oilChangeIntervalMonths: vehicle.oilChangeIntervalMonths?.toString() ?? "",
      transmissionOilIntervalKm: vehicle.transmissionOilIntervalKm?.toString() ?? "",
      transmissionOilIntervalMonths: vehicle.transmissionOilIntervalMonths?.toString() ?? "",
      brakesIntervalMonths: vehicle.brakesIntervalMonths?.toString() ?? "",
      timingIntervalKm: vehicle.timingIntervalKm?.toString() ?? "",
      timingIntervalMonths: vehicle.timingIntervalMonths?.toString() ?? "",
      lastBrakeFluidDate: vehicle.lastBrakeFluidDate ?? "",
      brakeFluidIntervalMonths: vehicle.brakeFluidIntervalMonths?.toString() ?? "",
    });
    setEditOpen(true);
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    const toInt = (s: string) => s.trim() ? parseInt(s, 10) : null;
    const editIsCompany = !editForm.isFleet && editForm.ownerType === "company";
    const editIsAuto = editForm.transmission === "automatic";
    updateVehicle.mutate({
      id,
      data: {
        make: editForm.make,
        model: editForm.model,
        year: toInt(editForm.year),
        currentKm: toInt(editForm.currentKm),
        engineDisplacement: toInt(editForm.engineDisplacement),
        transmission: editForm.transmission,
        ownerType: editForm.isFleet ? "private" : editForm.ownerType,
        ownerName: editForm.isFleet ? FLEET_OWNER_NAME : (editForm.ownerName || null),
        ownerAddress: editForm.isFleet ? null : (editForm.ownerAddress || null),
        ownerIco: editIsCompany ? (editForm.ownerIco || null) : null,
        ownerDic: editIsCompany ? (editForm.ownerDic || null) : null,
        ownerPhone: editForm.isFleet ? null : (editForm.ownerPhone || null),
        ownerEmail: editForm.isFleet ? null : (editForm.ownerEmail || null),
        lastOilChangeKm: toInt(editForm.lastOilChangeKm),
        stkValidUntil: editForm.stkValidUntil || null,
        lastOilChangeDate: editForm.lastOilChangeDate || null,
        lastBrakesDate: editForm.lastBrakesDate || null,
        lastTimingDate: editForm.lastTimingDate || null,
        lastTransmissionOilDate: editIsAuto ? (editForm.lastTransmissionOilDate || null) : null,
        lastTransmissionOilKm: editIsAuto ? toInt(editForm.lastTransmissionOilKm) : null,
        oilChangeIntervalKm: toInt(editForm.oilChangeIntervalKm),
        oilChangeIntervalMonths: toInt(editForm.oilChangeIntervalMonths),
        transmissionOilIntervalKm: editIsAuto ? toInt(editForm.transmissionOilIntervalKm) : null,
        transmissionOilIntervalMonths: editIsAuto ? toInt(editForm.transmissionOilIntervalMonths) : null,
        brakesIntervalMonths: toInt(editForm.brakesIntervalMonths),
        timingIntervalKm: toInt(editForm.timingIntervalKm),
        timingIntervalMonths: toInt(editForm.timingIntervalMonths),
        lastBrakeFluidDate: editForm.lastBrakeFluidDate || null,
        brakeFluidIntervalMonths: toInt(editForm.brakeFluidIntervalMonths),
        color: editForm.color || null,
        vin: editForm.vin || null,
        notes: editForm.notes || null,
        isFleet: editForm.isFleet,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetVehicleQueryKey(id) });
        setEditOpen(false);
        toast({ title: "Vozidlo aktualizováno" });
      }
    });
  }

  function handleServiceSubmit(e: React.FormEvent) {
    e.preventDefault();
    createRecord.mutate({
      id,
      data: {
        ...serviceForm,
        km: serviceForm.km ? parseInt(serviceForm.km) : null,
        otherWork: serviceForm.otherWork || null,
        technician: serviceForm.technician || null,
        description: serviceForm.description || null,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetVehicleQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListServiceRecordsQueryKey(id) });
        setAddServiceOpen(false);
        setServiceForm({ date: new Date().toISOString().split("T")[0], km: "", description: "", oilChanged: false, transmissionOilChanged: false, brakesServiced: false, timingServiced: false, brakeFluidChanged: false, stkPassed: false, otherWork: "", technician: "" });
        toast({ title: "Servisní záznam přidán" });
      }
    });
  }

  if (isLoading) return (
    <div className="space-y-4">
      <div className="h-8 w-64 bg-muted animate-pulse rounded" />
      <div className="grid gap-4 md:grid-cols-2">
        {[1,2,3,4].map(i => <div key={i} className="h-40 bg-muted animate-pulse rounded-xl" />)}
      </div>
    </div>
  );

  if (isError || !vehicle) return (
    <div className="text-center py-16 text-muted-foreground">Vozidlo nenalezeno.</div>
  );

  const dateStr = (d?: string | null) => {
    if (!d) return "-";
    try { return format(parseISO(d), 'd. M. yyyy', { locale: cs }); } catch { return d; }
  };

  const transmissionLabel = vehicle.transmission === "automatic" ? "Automatická" : vehicle.transmission === "manual" ? "Manuální" : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/vehicles">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <LicensePlate plate={vehicle.licensePlate} size="xl" />
          <p className="text-muted-foreground">{vehicle.make} {vehicle.model} {vehicle.year ? `(${vehicle.year})` : ""}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <VehicleHistoryExportDialog
            vehicle={vehicle}
            settings={settings}
            trigger={
              <Button variant="outline">
                <FileDown className="h-4 w-4 mr-2" />Export historie
              </Button>
            }
          />
          <Button variant="outline" onClick={openEdit}><Edit className="h-4 w-4 mr-2" />Upravit</Button>
          <Link href={`/work-orders/new?spz=${vehicle.licensePlate}`}>
            <Button><Plus className="h-4 w-4 mr-2" />Nová zakázka</Button>
          </Link>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="icon" title="Smazat vozidlo"><Trash2 className="h-4 w-4" /></Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Smazat vozidlo {vehicle.licensePlate}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Tato akce je nevratná. Smaže se vozidlo i celá jeho servisní historie.
                  {hasOpenOrders && (
                    <span className="block mt-2 text-destructive font-medium">
                      Pozor: vozidlo má {vehicle.openWorkOrders!.length} otevřenou zakázku. Zakázky zůstanou zachovány, ale ztratí vazbu na vozidlo.
                    </span>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Zrušit</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    deleteVehicle.mutate({ id }, {
                      onSuccess: () => {
                        queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
                        toast({ title: "Vozidlo smazáno" });
                        navigate("/vehicles");
                      },
                      onError: (err) => toast({ title: "Chyba", description: getApiErrorMessage(err, "Vozidlo se nepodařilo smazat."), variant: "destructive" }),
                    });
                  }}
                >Smazat</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Basic info */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-xl"><Car className="h-5 w-5" />Základní informace</CardTitle>
              <Button
                type="button" size="sm" variant="ghost"
                title="Přepočítat km a stav servisu z celé historie"
                onClick={() => {
                  recompute.mutate({ id }, {
                    onSuccess: () => {
                      queryClient.invalidateQueries({ queryKey: getGetVehicleQueryKey(id) });
                      queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
                      toast({ title: "Údaje obnoveny", description: "Najeté km a stav servisu byly přepočítány z historie." });
                    },
                    onError: (err) => toast({ title: "Obnovení selhalo", description: getApiErrorMessage(err), variant: "destructive" }),
                  });
                }}
                disabled={recompute.isPending}
              >
                <RefreshCw className={cn("h-4 w-4", recompute.isPending && "animate-spin")} />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-base">
            <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 items-center">
              <span className="text-muted-foreground">SPZ</span><div><LicensePlate plate={vehicle.licensePlate} size="md" /></div>
              <span className="text-muted-foreground">Výrobce</span><span className="font-medium">{vehicle.make}</span>
              <span className="text-muted-foreground">Model</span><span className="font-medium">{vehicle.model}</span>
              <span className="text-muted-foreground">Rok</span><span className="font-medium">{vehicle.year ?? "-"}</span>
              <span className="text-muted-foreground">Barva</span><span className="font-medium">{vehicle.color ?? "-"}</span>
              <span className="text-muted-foreground">VIN</span><span className="font-mono text-sm break-all">{vehicle.vin ?? "-"}</span>
              <span className="text-muted-foreground">Objem motoru</span>
              <span className="font-medium">{vehicle.engineDisplacement ? `${vehicle.engineDisplacement.toLocaleString('cs-CZ')} cm³` : "-"}</span>
              <span className="text-muted-foreground">Převodovka</span>
              <span className="font-medium">{transmissionLabel ?? "-"}</span>
              <span className="text-muted-foreground">Najeté km</span>
              <span className="font-semibold text-lg">{vehicle.currentKm ? `${vehicle.currentKm.toLocaleString('cs-CZ')} km` : "-"}</span>
            </div>
            {vehicle.notes && <p className="text-muted-foreground border-t pt-3 mt-3">{vehicle.notes}</p>}
          </CardContent>
        </Card>

        {(vehicle.ownerName || vehicle.ownerAddress || vehicle.ownerIco || vehicle.ownerDic || vehicle.ownerPhone || vehicle.ownerEmail) && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><User className="h-4 w-4" />{isCompany ? "Firma" : "Vlastník"}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {vehicle.ownerName && <div><span className="text-muted-foreground block text-xs">{isCompany ? "Název" : "Jméno"}</span><span className="font-medium">{vehicle.ownerName}</span></div>}
              {vehicle.ownerAddress && <div><span className="text-muted-foreground block text-xs">{isCompany ? "Sídlo" : "Adresa"}</span><span>{vehicle.ownerAddress}</span></div>}
              {isCompany && vehicle.ownerIco && <div><span className="text-muted-foreground block text-xs">IČO</span><span className="font-mono">{vehicle.ownerIco}</span></div>}
              {isCompany && vehicle.ownerDic && <div><span className="text-muted-foreground block text-xs">DIČ</span><span className="font-mono">{vehicle.ownerDic}</span></div>}
              {vehicle.ownerPhone && <div><span className="text-muted-foreground block text-xs">Telefon</span><a className="font-medium hover:text-primary" href={`tel:${vehicle.ownerPhone}`}>{vehicle.ownerPhone}</a></div>}
              {vehicle.ownerEmail && <div><span className="text-muted-foreground block text-xs">E-mail</span><a className="font-medium hover:text-primary break-all" href={`mailto:${vehicle.ownerEmail}`}>{vehicle.ownerEmail}</a></div>}
            </CardContent>
          </Card>
        )}

        {/* Service status */}
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="h-4 w-4" />Stav servisu</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">STK platnost</span>
              <StkBadge date={vehicle.stkValidUntil} />
            </div>
            <ServiceRow
              label="Motorový olej"
              lastDate={vehicle.lastOilChangeDate}
              lastKm={vehicle.lastOilChangeKm}
              currentKm={vehicle.currentKm}
              intervalKm={vehicle.oilChangeIntervalKm ?? 15000}
              intervalMonths={vehicle.oilChangeIntervalMonths ?? 12}
            />
            {isAutomatic && (
              <ServiceRow
                label="Olej v převodovce"
                lastDate={vehicle.lastTransmissionOilDate}
                lastKm={vehicle.lastTransmissionOilKm}
                currentKm={vehicle.currentKm}
                intervalKm={vehicle.transmissionOilIntervalKm ?? 60000}
                intervalMonths={vehicle.transmissionOilIntervalMonths ?? 48}
              />
            )}
            <ServiceRow
              label="Brzdy"
              lastDate={vehicle.lastBrakesDate}
              intervalMonths={vehicle.brakesIntervalMonths ?? 24}
            />
            <ServiceRow
              label="Rozvody"
              lastDate={vehicle.lastTimingDate}
              currentKm={vehicle.currentKm}
              intervalKm={vehicle.timingIntervalKm ?? 120000}
              intervalMonths={vehicle.timingIntervalMonths ?? 120}
            />
            <ServiceRow
              label="Brzdová kapalina"
              lastDate={vehicle.lastBrakeFluidDate}
              intervalMonths={vehicle.brakeFluidIntervalMonths ?? 24}
            />
          </CardContent>
        </Card>

        {/* Sent customer reminders */}
        <Card className="md:col-span-2">
          <CardHeader><CardTitle className="flex items-center gap-2"><BellRing className="h-4 w-4" />Odeslaná upozornění zákazníkovi</CardTitle></CardHeader>
          <CardContent>
            {reminderLog.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Zatím nebylo odesláno žádné upozornění.</p>
            ) : (
              <ul className="divide-y">
                {reminderLog.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between py-2 gap-3">
                    <span className="text-sm font-medium">{reminderKeyLabel(entry.reminderKey)}</span>
                    <span className="text-sm text-muted-foreground">Odesláno {dateStr(entry.sentAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Open work orders */}
      {vehicle.openWorkOrders && vehicle.openWorkOrders.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ClipboardList className="h-4 w-4" />Otevřené zakázky</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {vehicle.openWorkOrders.map(wo => (
                <Link key={wo.id} href={`/work-orders/${wo.id}`}>
                  <div className="flex items-center justify-between p-3 rounded border hover:bg-accent/50 transition-colors cursor-pointer">
                    <div className="flex items-center gap-3">
                      <WorkOrderStatusBadge status={wo.status} size="sm" />
                      <span className="text-sm">{wo.description || "Bez popisu"}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{dateStr(wo.serviceDate ?? wo.createdAt)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Service history */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Servisní historie</CardTitle>
            <Dialog open={addServiceOpen} onOpenChange={setAddServiceOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm"><Plus className="h-4 w-4 mr-2" />Přidat záznam</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Přidat servisní záznam</DialogTitle></DialogHeader>
                <form onSubmit={handleServiceSubmit} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label>Datum *</Label>
                      <Input type="date" value={serviceForm.date} onChange={e => setServiceForm(f => ({ ...f, date: e.target.value }))} required />
                    </div>
                    <div className="space-y-1">
                      <Label>Km</Label>
                      <Input type="number" placeholder="najeté km" value={serviceForm.km} onChange={e => setServiceForm(f => ({ ...f, km: e.target.value }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Popis</Label>
                    <Textarea placeholder="Popis servisních prací..." value={serviceForm.description} onChange={e => setServiceForm(f => ({ ...f, description: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { key: "oilChanged", label: "Výměna motorového oleje" },
                      ...(isAutomatic ? [{ key: "transmissionOilChanged", label: "Olej v převodovce" }] : []),
                      { key: "brakesServiced", label: "Brzdy" },
                      { key: "timingServiced", label: "Rozvody" },
                      { key: "brakeFluidChanged", label: "Brzdová kapalina" },
                      { key: "stkPassed", label: "STK provedena" },
                    ].map(item => (
                      <div key={item.key} className="flex items-center space-x-2">
                        <Checkbox
                          id={item.key}
                          checked={serviceForm[item.key as keyof typeof serviceForm] as boolean}
                          onCheckedChange={v => setServiceForm(f => ({ ...f, [item.key]: !!v }))}
                        />
                        <Label htmlFor={item.key}>{item.label}</Label>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <Label>Ostatní práce</Label>
                    <Input placeholder="Popis dalších prací..." value={serviceForm.otherWork} onChange={e => setServiceForm(f => ({ ...f, otherWork: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Technik</Label>
                    <Input placeholder="Jméno technika" value={serviceForm.technician} onChange={e => setServiceForm(f => ({ ...f, technician: e.target.value }))} />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setAddServiceOpen(false)}>Zrušit</Button>
                    <Button type="submit" disabled={createRecord.isPending}>Uložit</Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {(!vehicle.serviceRecords || vehicle.serviceRecords.length === 0) &&
           (!vehicle.completedWorkOrders || vehicle.completedWorkOrders.length === 0) ? (
            <p className="text-sm text-muted-foreground text-center py-8">Žádné servisní záznamy.</p>
          ) : (
            <div className="space-y-3">
              {(vehicle.completedWorkOrders ?? []).map(wo => (
                <Link key={`wo-${wo.id}`} href={`/work-orders/${wo.id}`}>
                  <div className="flex items-start gap-4 p-4 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{dateStr(wo.serviceDate ?? wo.createdAt)}</span>
                        {wo.km != null && <span className="text-sm text-muted-foreground">{wo.km.toLocaleString('cs-CZ')} km</span>}
                        <Badge variant="secondary" className="text-xs">Zakázka #{wo.id}</Badge>
                        {wo.oilChange && <ServiceBadge category="oil">Olej</ServiceBadge>}
                        {wo.transmissionOil && <ServiceBadge category="transmissionOil">Olej převodovky</ServiceBadge>}
                        {wo.brakes && <ServiceBadge category="brakes">Brzdy</ServiceBadge>}
                        {wo.timing && <ServiceBadge category="timing">Rozvody</ServiceBadge>}
                        {wo.brakeFluid && <ServiceBadge category="brakeFluid">Brzd. kapalina</ServiceBadge>}
                        {wo.tireChange && <ServiceBadge category="tires">Přezutí</ServiceBadge>}
                        {wo.diagnostics && <ServiceBadge category="diagnostics">Diagnostika</ServiceBadge>}
                        {wo.lightsCheck && <ServiceBadge category="lights">Osvětlení</ServiceBadge>}
                        {wo.frontAxleCheck && <ServiceBadge category="axle">Přední náprava</ServiceBadge>}
                        {wo.rearAxleCheck && <ServiceBadge category="axle">Zadní náprava</ServiceBadge>}
                        {wo.frontShocksCheck && <ServiceBadge category="shocks">Přední tlumiče</ServiceBadge>}
                        {wo.rearShocksCheck && <ServiceBadge category="shocks">Zadní tlumiče</ServiceBadge>}
                        {wo.geometry && <ServiceBadge category="geometry">Geometrie</ServiceBadge>}
                        {wo.headlightAlignment && <ServiceBadge category="lights">Světlomety</ServiceBadge>}
                        {wo.stk && <ServiceBadge category="stk">STK</ServiceBadge>}
                      </div>
                      {wo.description && <p className="text-sm text-muted-foreground">{wo.description}</p>}
                      {wo.otherServices && <p className="text-sm text-muted-foreground">{wo.otherServices}</p>}
                      {wo.otherWork && <p className="text-sm text-muted-foreground">{wo.otherWork}</p>}
                    </div>
                  </div>
                </Link>
              ))}
              {(vehicle.serviceRecords ?? []).map(record => (
                <div key={record.id} className="flex items-start gap-4 p-4 rounded-lg border">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{dateStr(record.date)}</span>
                      {record.km && <span className="text-sm text-muted-foreground">{record.km.toLocaleString('cs-CZ')} km</span>}
                      {record.oilChanged && <ServiceBadge category="oil">Olej</ServiceBadge>}
                      {record.transmissionOilChanged && <ServiceBadge category="transmissionOil">Olej převodovky</ServiceBadge>}
                      {record.brakesServiced && <ServiceBadge category="brakes">Brzdy</ServiceBadge>}
                      {record.timingServiced && <ServiceBadge category="timing">Rozvody</ServiceBadge>}
                      {record.brakeFluidChanged && <ServiceBadge category="brakeFluid">Brzd. kapalina</ServiceBadge>}
                      {record.stkPassed && <ServiceBadge category="stk">STK</ServiceBadge>}
                    </div>
                    {record.description && <p className="text-sm text-muted-foreground">{record.description}</p>}
                    {record.otherWork && <p className="text-sm text-muted-foreground">{record.otherWork}</p>}
                    {record.technician && <p className="text-xs text-muted-foreground">Technik: {record.technician}</p>}
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive shrink-0">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Smazat záznam?</AlertDialogTitle>
                        <AlertDialogDescription>Tato akce je nevratná.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Zrušit</AlertDialogCancel>
                        <AlertDialogAction onClick={() => {
                          deleteRecord.mutate({ id: record.id }, {
                            onSuccess: () => {
                              queryClient.invalidateQueries({ queryKey: getGetVehicleQueryKey(id) });
                              toast({ title: "Záznam smazán" });
                            }
                          });
                        }}>Smazat</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ChangeHistory entity="vehicle" entityId={id} />

      {/* Edit vehicle dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Upravit vozidlo</DialogTitle></DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-5">
            {editForm.isFleet && (
              <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3 text-sm">
                Vozidlo vozového parku je vedeno na jméno <span className="font-medium">{FLEET_OWNER_NAME}</span>.
              </div>
            )}
            {!editForm.isFleet && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Vlastník</h3>
              <RadioGroup
                value={editForm.ownerType}
                onValueChange={(v) => setEditForm(f => ({ ...f, ownerType: v as "private" | "company" }))}
                className="flex gap-6"
              >
                <div className="flex items-center space-x-2"><RadioGroupItem value="private" id="ed-own-priv" /><Label htmlFor="ed-own-priv" className="cursor-pointer">Soukromá osoba</Label></div>
                <div className="flex items-center space-x-2"><RadioGroupItem value="company" id="ed-own-comp" /><Label htmlFor="ed-own-comp" className="cursor-pointer">Firma</Label></div>
              </RadioGroup>
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1"><Label>{editForm.ownerType === "company" ? "Název firmy" : "Jméno"}</Label><Input value={editForm.ownerName} onChange={e => setEditForm(f => ({ ...f, ownerName: e.target.value }))} /></div>
                <div className="space-y-1"><Label>{editForm.ownerType === "company" ? "Sídlo" : "Adresa"}</Label><Input value={editForm.ownerAddress} onChange={e => setEditForm(f => ({ ...f, ownerAddress: e.target.value }))} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1"><Label>Telefon</Label><Input type="tel" placeholder="+420 777 123 456" value={editForm.ownerPhone} onChange={e => setEditForm(f => ({ ...f, ownerPhone: e.target.value }))} /></div>
                  <div className="space-y-1"><Label>E-mail</Label><Input type="email" placeholder="jan.novak@email.cz" value={editForm.ownerEmail} onChange={e => setEditForm(f => ({ ...f, ownerEmail: e.target.value }))} /></div>
                </div>
                {editForm.ownerType === "company" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>IČO</Label>
                      <div className="flex gap-2">
                        <Input value={editForm.ownerIco} onChange={e => setEditForm(f => ({ ...f, ownerIco: e.target.value }))} />
                        <AresButton ico={editForm.ownerIco} onLoaded={(d) => setEditForm(f => ({
                          ...f,
                          ownerName: d.name || f.ownerName,
                          ownerAddress: d.address || f.ownerAddress,
                          ownerDic: d.dic || f.ownerDic,
                        }))} />
                      </div>
                    </div>
                    <div className="space-y-1"><Label>DIČ</Label><Input value={editForm.ownerDic} onChange={e => setEditForm(f => ({ ...f, ownerDic: e.target.value }))} /></div>
                  </div>
                )}
              </div>
            </div>
            )}

            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Vozidlo</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Výrobce *</Label><AutocompleteInput value={editForm.make} onChange={(v) => setEditForm(f => ({ ...f, make: v, model: f.make.trim().toLowerCase() === v.trim().toLowerCase() ? f.model : "" }))} options={editMakeOptions} required /></div>
                <div className="space-y-1"><Label>Model *</Label><AutocompleteInput value={editForm.model} onChange={(v) => setEditForm(f => ({ ...f, model: v }))} options={editModelOptions} required /></div>
                <div className="space-y-1"><Label>Rok</Label><Input type="number" value={editForm.year} onChange={e => setEditForm(f => ({ ...f, year: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Barva</Label><Input value={editForm.color} onChange={e => setEditForm(f => ({ ...f, color: e.target.value }))} /></div>
                <div className="space-y-1 col-span-2"><Label>VIN</Label><Input value={editForm.vin} onChange={e => setEditForm(f => ({ ...f, vin: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Objem motoru (cm³)</Label><Input type="number" value={editForm.engineDisplacement} onChange={e => setEditForm(f => ({ ...f, engineDisplacement: e.target.value }))} /></div>
                <div className="space-y-1 col-span-2">
                  <Label>Převodovka</Label>
                  <RadioGroup
                    value={editForm.transmission}
                    onValueChange={(v) => setEditForm(f => ({ ...f, transmission: v as "manual" | "automatic" }))}
                    className="flex gap-6 pt-1"
                  >
                    <div className="flex items-center space-x-2"><RadioGroupItem value="manual" id="ed-tr-m" /><Label htmlFor="ed-tr-m" className="cursor-pointer">Manuální</Label></div>
                    <div className="flex items-center space-x-2"><RadioGroupItem value="automatic" id="ed-tr-a" /><Label htmlFor="ed-tr-a" className="cursor-pointer">Automatická</Label></div>
                  </RadioGroup>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Poslední servis</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Aktuální km</Label><Input type="number" value={editForm.currentKm} onChange={e => setEditForm(f => ({ ...f, currentKm: e.target.value }))} /></div>
                <div className="space-y-1"><Label>STK platná do</Label><Input type="date" value={editForm.stkValidUntil} onChange={e => setEditForm(f => ({ ...f, stkValidUntil: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Datum výměny mot. oleje</Label><Input type="date" value={editForm.lastOilChangeDate} onChange={e => setEditForm(f => ({ ...f, lastOilChangeDate: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Km při výměně oleje</Label><Input type="number" value={editForm.lastOilChangeKm} onChange={e => setEditForm(f => ({ ...f, lastOilChangeKm: e.target.value }))} /></div>
                {editForm.transmission === "automatic" && (
                  <>
                    <div className="space-y-1"><Label>Datum výměny oleje převodovky</Label><Input type="date" value={editForm.lastTransmissionOilDate} onChange={e => setEditForm(f => ({ ...f, lastTransmissionOilDate: e.target.value }))} /></div>
                    <div className="space-y-1"><Label>Km při výměně oleje převodovky</Label><Input type="number" value={editForm.lastTransmissionOilKm} onChange={e => setEditForm(f => ({ ...f, lastTransmissionOilKm: e.target.value }))} /></div>
                  </>
                )}
                <div className="space-y-1"><Label>Datum servisu brzd</Label><Input type="date" value={editForm.lastBrakesDate} onChange={e => setEditForm(f => ({ ...f, lastBrakesDate: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Datum servisu rozvodů</Label><Input type="date" value={editForm.lastTimingDate} onChange={e => setEditForm(f => ({ ...f, lastTimingDate: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Datum výměny brzdové kapaliny</Label><Input type="date" value={editForm.lastBrakeFluidDate} onChange={e => setEditForm(f => ({ ...f, lastBrakeFluidDate: e.target.value }))} /></div>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Servisní intervaly</h3>
              <p className="text-xs text-muted-foreground">Prázdné pole = bez upozornění.</p>
              <div className="space-y-3">
                <div>
                  <Label className="text-sm font-medium">Motorový olej</Label>
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <Input type="number" placeholder="km" value={editForm.oilChangeIntervalKm} onChange={e => setEditForm(f => ({ ...f, oilChangeIntervalKm: e.target.value }))} />
                    <Input type="number" placeholder="měsíců" value={editForm.oilChangeIntervalMonths} onChange={e => setEditForm(f => ({ ...f, oilChangeIntervalMonths: e.target.value }))} />
                  </div>
                </div>
                {editForm.transmission === "automatic" && (
                  <div>
                    <Label className="text-sm font-medium">Olej v převodovce</Label>
                    <div className="grid grid-cols-2 gap-3 mt-1">
                      <Input type="number" placeholder="km" value={editForm.transmissionOilIntervalKm} onChange={e => setEditForm(f => ({ ...f, transmissionOilIntervalKm: e.target.value }))} />
                      <Input type="number" placeholder="měsíců" value={editForm.transmissionOilIntervalMonths} onChange={e => setEditForm(f => ({ ...f, transmissionOilIntervalMonths: e.target.value }))} />
                    </div>
                  </div>
                )}
                <div>
                  <Label className="text-sm font-medium">Brzdy</Label>
                  <Input type="number" className="mt-1" placeholder="měsíců" value={editForm.brakesIntervalMonths} onChange={e => setEditForm(f => ({ ...f, brakesIntervalMonths: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-sm font-medium">Rozvody</Label>
                  <div className="grid grid-cols-2 gap-3 mt-1">
                    <Input type="number" placeholder="km" value={editForm.timingIntervalKm} onChange={e => setEditForm(f => ({ ...f, timingIntervalKm: e.target.value }))} />
                    <Input type="number" placeholder="měsíců" value={editForm.timingIntervalMonths} onChange={e => setEditForm(f => ({ ...f, timingIntervalMonths: e.target.value }))} />
                  </div>
                </div>
                <div>
                  <Label className="text-sm font-medium">Brzdová kapalina</Label>
                  <Input type="number" className="mt-1" placeholder="měsíců" value={editForm.brakeFluidIntervalMonths} onChange={e => setEditForm(f => ({ ...f, brakeFluidIntervalMonths: e.target.value }))} />
                </div>
              </div>
            </div>

            <div className="space-y-1"><Label>Poznámky</Label><Textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} /></div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Zrušit</Button>
              <Button type="submit" disabled={updateVehicle.isPending}>Uložit změny</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
