import { useState } from "react";
import { useRoute, Link, useLocation } from "wouter";
import { useGetVehicle, useUpdateVehicle, useDeleteVehicle, useCreateServiceRecord, useDeleteServiceRecord, useListVehicleMakes, useListVehicleModels, getGetVehicleQueryKey, getListServiceRecordsQueryKey, getListVehiclesQueryKey } from "@workspace/api-client-react";
import { AutocompleteInput } from "@/components/autocomplete-input";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, Car, Wrench, Plus, Trash2, ClipboardList, Edit, User } from "lucide-react";
import { WorkOrderStatusBadge } from "@/lib/work-order-status";
import { format, differenceInDays, parseISO, isValid } from "date-fns";
import { cs } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { computeServiceStatus, type ServiceStatus } from "@/lib/service-status";

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
  return (
    <div className="flex items-start justify-between py-2 border-b last:border-b-0 gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-muted-foreground">{label}</span>
          <StatusPill status={r.status} />
        </div>
        {r.agoLabel && <p className="text-xs text-muted-foreground mt-0.5">{r.agoLabel}</p>}
      </div>
      <div className="text-right shrink-0">
        {lastDate ? (
          <span className="text-sm">{format(parseISO(lastDate), 'd. M. yyyy', { locale: cs })}</span>
        ) : (
          <span className="text-sm text-muted-foreground">nezadáno</span>
        )}
        {r.dueLabel && (
          <p className={`text-xs mt-0.5 ${r.status === "overdue" ? "text-destructive" : r.status === "due-soon" ? "text-amber-600" : "text-muted-foreground"}`}>{r.dueLabel}</p>
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

  const [editOpen, setEditOpen] = useState(false);
  const [addServiceOpen, setAddServiceOpen] = useState(false);

  const updateVehicle = useUpdateVehicle();
  const deleteVehicle = useDeleteVehicle();
  const createRecord = useCreateServiceRecord();
  const deleteRecord = useDeleteServiceRecord();

  const hasOpenOrders = (vehicle?.openWorkOrders?.length ?? 0) > 0;

  const [editForm, setEditForm] = useState({
    make: "", model: "", year: "", color: "", vin: "", currentKm: "", notes: "", stkValidUntil: "",
    engineDisplacement: "", registrationDate: "",
    transmission: "manual" as "manual" | "automatic",
    ownerType: "private" as "private" | "company",
    ownerName: "", ownerAddress: "", ownerIco: "", ownerDic: "",
    lastOilChangeKm: "", lastOilChangeDate: "", lastBrakesDate: "", lastTimingDate: "",
    lastTransmissionOilDate: "", lastTransmissionOilKm: "",
    oilChangeIntervalKm: "", oilChangeIntervalMonths: "",
    transmissionOilIntervalKm: "", transmissionOilIntervalMonths: "",
    brakesIntervalMonths: "", timingIntervalKm: "", timingIntervalMonths: "",
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
    timingServiced: false, stkPassed: false, otherWork: "", technician: ""
  });

  const isAutomatic = vehicle?.transmission === "automatic";
  const isCompany = vehicle?.ownerType === "company";

  function openEdit() {
    if (!vehicle) return;
    setEditForm({
      make: vehicle.make, model: vehicle.model, year: vehicle.year?.toString() ?? "",
      color: vehicle.color ?? "", vin: vehicle.vin ?? "", currentKm: vehicle.currentKm?.toString() ?? "",
      notes: vehicle.notes ?? "", stkValidUntil: vehicle.stkValidUntil ?? "",
      engineDisplacement: vehicle.engineDisplacement?.toString() ?? "",
      registrationDate: vehicle.registrationDate ?? "",
      transmission: (vehicle.transmission === "automatic" ? "automatic" : "manual"),
      ownerType: (vehicle.ownerType === "company" ? "company" : "private"),
      ownerName: vehicle.ownerName ?? "",
      ownerAddress: vehicle.ownerAddress ?? "",
      ownerIco: vehicle.ownerIco ?? "",
      ownerDic: vehicle.ownerDic ?? "",
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
    });
    setEditOpen(true);
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    const toInt = (s: string) => s.trim() ? parseInt(s, 10) : null;
    const editIsCompany = editForm.ownerType === "company";
    const editIsAuto = editForm.transmission === "automatic";
    updateVehicle.mutate({
      id,
      data: {
        make: editForm.make,
        model: editForm.model,
        year: toInt(editForm.year),
        currentKm: toInt(editForm.currentKm),
        engineDisplacement: toInt(editForm.engineDisplacement),
        registrationDate: editForm.registrationDate || null,
        transmission: editForm.transmission,
        ownerType: editForm.ownerType,
        ownerName: editForm.ownerName || null,
        ownerAddress: editForm.ownerAddress || null,
        ownerIco: editIsCompany ? (editForm.ownerIco || null) : null,
        ownerDic: editIsCompany ? (editForm.ownerDic || null) : null,
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
        color: editForm.color || null,
        vin: editForm.vin || null,
        notes: editForm.notes || null,
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
        setServiceForm({ date: new Date().toISOString().split("T")[0], km: "", description: "", oilChanged: false, transmissionOilChanged: false, brakesServiced: false, timingServiced: false, stkPassed: false, otherWork: "", technician: "" });
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
          <h1 className="text-3xl font-bold tracking-tight font-mono uppercase">{vehicle.licensePlate}</h1>
          <p className="text-muted-foreground">{vehicle.make} {vehicle.model} {vehicle.year ? `(${vehicle.year})` : ""}</p>
        </div>
        <div className="flex gap-2">
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
                      onError: () => toast({ title: "Chyba", description: "Vozidlo se nepodařilo smazat.", variant: "destructive" }),
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
          <CardHeader><CardTitle className="flex items-center gap-2"><Car className="h-4 w-4" />Základní informace</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <span className="text-muted-foreground">SPZ</span><span className="font-mono font-bold">{vehicle.licensePlate}</span>
              <span className="text-muted-foreground">Výrobce</span><span>{vehicle.make}</span>
              <span className="text-muted-foreground">Model</span><span>{vehicle.model}</span>
              <span className="text-muted-foreground">Rok</span><span>{vehicle.year ?? "-"}</span>
              <span className="text-muted-foreground">Barva</span><span>{vehicle.color ?? "-"}</span>
              <span className="text-muted-foreground">VIN</span><span className="font-mono text-xs break-all">{vehicle.vin ?? "-"}</span>
              <span className="text-muted-foreground">Objem motoru</span>
              <span>{vehicle.engineDisplacement ? `${vehicle.engineDisplacement.toLocaleString('cs-CZ')} cm³` : "-"}</span>
              <span className="text-muted-foreground">Převodovka</span>
              <span>{transmissionLabel ?? "-"}</span>
              <span className="text-muted-foreground">První registrace</span>
              <span>{dateStr(vehicle.registrationDate)}</span>
              <span className="text-muted-foreground">Najeté km</span>
              <span className="font-semibold">{vehicle.currentKm ? `${vehicle.currentKm.toLocaleString('cs-CZ')} km` : "-"}</span>
            </div>
            {vehicle.notes && <p className="text-muted-foreground border-t pt-2 mt-2">{vehicle.notes}</p>}
          </CardContent>
        </Card>

        {(vehicle.ownerName || vehicle.ownerAddress || vehicle.ownerIco || vehicle.ownerDic) && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><User className="h-4 w-4" />{isCompany ? "Firma" : "Vlastník"}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {vehicle.ownerName && <div><span className="text-muted-foreground block text-xs">{isCompany ? "Název" : "Jméno"}</span><span className="font-medium">{vehicle.ownerName}</span></div>}
              {vehicle.ownerAddress && <div><span className="text-muted-foreground block text-xs">{isCompany ? "Sídlo" : "Adresa"}</span><span>{vehicle.ownerAddress}</span></div>}
              {isCompany && vehicle.ownerIco && <div><span className="text-muted-foreground block text-xs">IČO</span><span className="font-mono">{vehicle.ownerIco}</span></div>}
              {isCompany && vehicle.ownerDic && <div><span className="text-muted-foreground block text-xs">DIČ</span><span className="font-mono">{vehicle.ownerDic}</span></div>}
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
              intervalKm={vehicle.oilChangeIntervalKm}
              intervalMonths={vehicle.oilChangeIntervalMonths}
            />
            {isAutomatic && (
              <ServiceRow
                label="Olej v převodovce"
                lastDate={vehicle.lastTransmissionOilDate}
                lastKm={vehicle.lastTransmissionOilKm}
                currentKm={vehicle.currentKm}
                intervalKm={vehicle.transmissionOilIntervalKm}
                intervalMonths={vehicle.transmissionOilIntervalMonths}
              />
            )}
            <ServiceRow
              label="Brzdy"
              lastDate={vehicle.lastBrakesDate}
              intervalMonths={vehicle.brakesIntervalMonths}
            />
            <ServiceRow
              label="Rozvody"
              lastDate={vehicle.lastTimingDate}
              currentKm={vehicle.currentKm}
              intervalKm={vehicle.timingIntervalKm}
              intervalMonths={vehicle.timingIntervalMonths}
            />
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
          {!vehicle.serviceRecords || vehicle.serviceRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Žádné servisní záznamy.</p>
          ) : (
            <div className="space-y-3">
              {vehicle.serviceRecords.map(record => (
                <div key={record.id} className="flex items-start gap-4 p-4 rounded-lg border">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{dateStr(record.date)}</span>
                      {record.km && <span className="text-sm text-muted-foreground">{record.km.toLocaleString('cs-CZ')} km</span>}
                      {record.oilChanged && <Badge variant="outline" className="text-xs">Olej</Badge>}
                      {record.transmissionOilChanged && <Badge variant="outline" className="text-xs">Olej převodovky</Badge>}
                      {record.brakesServiced && <Badge variant="outline" className="text-xs">Brzdy</Badge>}
                      {record.timingServiced && <Badge variant="outline" className="text-xs">Rozvody</Badge>}
                      {record.stkPassed && <Badge variant="outline" className="text-xs">STK</Badge>}
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

      {/* Edit vehicle dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Upravit vozidlo</DialogTitle></DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-5">
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
                {editForm.ownerType === "company" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1"><Label>IČO</Label><Input value={editForm.ownerIco} onChange={e => setEditForm(f => ({ ...f, ownerIco: e.target.value }))} /></div>
                    <div className="space-y-1"><Label>DIČ</Label><Input value={editForm.ownerDic} onChange={e => setEditForm(f => ({ ...f, ownerDic: e.target.value }))} /></div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Vozidlo</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Výrobce *</Label><AutocompleteInput value={editForm.make} onChange={(v) => setEditForm(f => ({ ...f, make: v, model: f.make.trim().toLowerCase() === v.trim().toLowerCase() ? f.model : "" }))} options={editMakeOptions} required /></div>
                <div className="space-y-1"><Label>Model *</Label><AutocompleteInput value={editForm.model} onChange={(v) => setEditForm(f => ({ ...f, model: v }))} options={editModelOptions} required /></div>
                <div className="space-y-1"><Label>Rok</Label><Input type="number" value={editForm.year} onChange={e => setEditForm(f => ({ ...f, year: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Barva</Label><Input value={editForm.color} onChange={e => setEditForm(f => ({ ...f, color: e.target.value }))} /></div>
                <div className="space-y-1 col-span-2"><Label>VIN</Label><Input value={editForm.vin} onChange={e => setEditForm(f => ({ ...f, vin: e.target.value }))} /></div>
                <div className="space-y-1"><Label>Objem motoru (cm³)</Label><Input type="number" value={editForm.engineDisplacement} onChange={e => setEditForm(f => ({ ...f, engineDisplacement: e.target.value }))} /></div>
                <div className="space-y-1"><Label>První registrace</Label><Input type="date" value={editForm.registrationDate} onChange={e => setEditForm(f => ({ ...f, registrationDate: e.target.value }))} /></div>
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
