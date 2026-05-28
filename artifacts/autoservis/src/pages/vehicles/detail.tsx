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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { ArrowLeft, Car, Wrench, Plus, Trash2, ClipboardList, Edit, User } from "lucide-react";
import { WorkOrderStatusBadge } from "@/lib/work-order-status";
import { format, differenceInDays, parseISO, isValid } from "date-fns";
import { cs } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

function StkBadge({ date }: { date?: string | null }) {
  if (!date) return <span className="text-muted-foreground">-</span>;
  const d = parseISO(date);
  if (!isValid(d)) return <span>{date}</span>;
  const diff = differenceInDays(d, new Date());
  if (diff < 0) return <Badge variant="destructive">Propadlá ({format(d, 'd. M. yyyy')})</Badge>;
  if (diff <= 30) return <Badge className="bg-amber-500 text-white">Brzy propadne ({format(d, 'd. M. yyyy')})</Badge>;
  return <Badge className="bg-emerald-600 text-white">Platná do {format(d, 'd. M. yyyy')}</Badge>;
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
    ownerName: "", ownerAddress: "",
    lastOilChangeKm: "", lastOilChangeDate: "", lastBrakesDate: "", lastTimingDate: ""
  });

  const { data: editMakeOptions = [] } = useListVehicleMakes();
  const { data: editModelOptions = [] } = useListVehicleModels(
    { make: editForm.make },
    { query: { enabled: editForm.make.trim().length > 0 } as any }
  );

  const [serviceForm, setServiceForm] = useState({
    date: new Date().toISOString().split("T")[0],
    km: "", description: "", oilChanged: false, brakesServiced: false,
    timingServiced: false, stkPassed: false, otherWork: "", technician: ""
  });

  function openEdit() {
    if (!vehicle) return;
    setEditForm({
      make: vehicle.make, model: vehicle.model, year: vehicle.year?.toString() ?? "",
      color: vehicle.color ?? "", vin: vehicle.vin ?? "", currentKm: vehicle.currentKm?.toString() ?? "",
      notes: vehicle.notes ?? "", stkValidUntil: vehicle.stkValidUntil ?? "",
      engineDisplacement: vehicle.engineDisplacement?.toString() ?? "",
      registrationDate: vehicle.registrationDate ?? "",
      ownerName: vehicle.ownerName ?? "",
      ownerAddress: vehicle.ownerAddress ?? "",
      lastOilChangeKm: vehicle.lastOilChangeKm?.toString() ?? "",
      lastOilChangeDate: vehicle.lastOilChangeDate ?? "", lastBrakesDate: vehicle.lastBrakesDate ?? "",
      lastTimingDate: vehicle.lastTimingDate ?? ""
    });
    setEditOpen(true);
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateVehicle.mutate({
      id,
      data: {
        ...editForm,
        year: editForm.year ? parseInt(editForm.year) : null,
        currentKm: editForm.currentKm ? parseInt(editForm.currentKm) : null,
        engineDisplacement: editForm.engineDisplacement ? parseInt(editForm.engineDisplacement) : null,
        registrationDate: editForm.registrationDate || null,
        ownerName: editForm.ownerName || null,
        ownerAddress: editForm.ownerAddress || null,
        lastOilChangeKm: editForm.lastOilChangeKm ? parseInt(editForm.lastOilChangeKm) : null,
        stkValidUntil: editForm.stkValidUntil || null,
        lastOilChangeDate: editForm.lastOilChangeDate || null,
        lastBrakesDate: editForm.lastBrakesDate || null,
        lastTimingDate: editForm.lastTimingDate || null,
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
        setServiceForm({ date: new Date().toISOString().split("T")[0], km: "", description: "", oilChanged: false, brakesServiced: false, timingServiced: false, stkPassed: false, otherWork: "", technician: "" });
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
              <span className="text-muted-foreground">První registrace</span>
              <span>{dateStr(vehicle.registrationDate)}</span>
              <span className="text-muted-foreground">Najeté km</span>
              <span className="font-semibold">{vehicle.currentKm ? `${vehicle.currentKm.toLocaleString('cs-CZ')} km` : "-"}</span>
            </div>
            {vehicle.notes && <p className="text-muted-foreground border-t pt-2 mt-2">{vehicle.notes}</p>}
          </CardContent>
        </Card>

        {(vehicle.ownerName || vehicle.ownerAddress) && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><User className="h-4 w-4" />Vlastník</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {vehicle.ownerName && <div><span className="text-muted-foreground block text-xs">Jméno</span><span className="font-medium">{vehicle.ownerName}</span></div>}
              {vehicle.ownerAddress && <div><span className="text-muted-foreground block text-xs">Adresa</span><span>{vehicle.ownerAddress}</span></div>}
            </CardContent>
          </Card>
        )}

        {/* Service status */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Wrench className="h-4 w-4" />Stav servisu</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">STK platnost</span>
              <StkBadge date={vehicle.stkValidUntil} />
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">Poslední výměna oleje</span>
              <div className="text-right">
                <span>{dateStr(vehicle.lastOilChangeDate)}</span>
                {vehicle.lastOilChangeKm && <span className="block text-xs text-muted-foreground">{vehicle.lastOilChangeKm.toLocaleString('cs-CZ')} km</span>}
              </div>
            </div>
            <div className="flex items-center justify-between py-2 border-b">
              <span className="text-muted-foreground">Poslední servis brzd</span>
              <span>{dateStr(vehicle.lastBrakesDate)}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-muted-foreground">Rozvody</span>
              <span>{dateStr(vehicle.lastTimingDate)}</span>
            </div>
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
                    <span className="text-xs text-muted-foreground">{dateStr(wo.createdAt)}</span>
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
                      { key: "oilChanged", label: "Výměna oleje" },
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
              {[...vehicle.serviceRecords].reverse().map(record => (
                <div key={record.id} className="flex items-start gap-4 p-4 rounded-lg border">
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold">{dateStr(record.date)}</span>
                      {record.km && <span className="text-sm text-muted-foreground">{record.km.toLocaleString('cs-CZ')} km</span>}
                      {record.oilChanged && <Badge variant="outline" className="text-xs">Olej</Badge>}
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
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Upravit vozidlo</DialogTitle></DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><Label>Výrobce *</Label><AutocompleteInput value={editForm.make} onChange={(v) => setEditForm(f => ({ ...f, make: v, model: f.make.trim().toLowerCase() === v.trim().toLowerCase() ? f.model : "" }))} options={editMakeOptions} required /></div>
              <div className="space-y-1"><Label>Model *</Label><AutocompleteInput value={editForm.model} onChange={(v) => setEditForm(f => ({ ...f, model: v }))} options={editModelOptions} required /></div>
              <div className="space-y-1"><Label>Rok</Label><Input type="number" value={editForm.year} onChange={e => setEditForm(f => ({ ...f, year: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Barva</Label><Input value={editForm.color} onChange={e => setEditForm(f => ({ ...f, color: e.target.value }))} /></div>
              <div className="space-y-1 col-span-2"><Label>VIN</Label><Input value={editForm.vin} onChange={e => setEditForm(f => ({ ...f, vin: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Objem motoru (cm³)</Label><Input type="number" value={editForm.engineDisplacement} onChange={e => setEditForm(f => ({ ...f, engineDisplacement: e.target.value }))} /></div>
              <div className="space-y-1"><Label>První registrace</Label><Input type="date" value={editForm.registrationDate} onChange={e => setEditForm(f => ({ ...f, registrationDate: e.target.value }))} /></div>
              <div className="space-y-1 col-span-2"><Label>Vlastník</Label><Input value={editForm.ownerName} onChange={e => setEditForm(f => ({ ...f, ownerName: e.target.value }))} /></div>
              <div className="space-y-1 col-span-2"><Label>Adresa vlastníka</Label><Input value={editForm.ownerAddress} onChange={e => setEditForm(f => ({ ...f, ownerAddress: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Aktuální km</Label><Input type="number" value={editForm.currentKm} onChange={e => setEditForm(f => ({ ...f, currentKm: e.target.value }))} /></div>
              <div className="space-y-1"><Label>STK platná do</Label><Input type="date" value={editForm.stkValidUntil} onChange={e => setEditForm(f => ({ ...f, stkValidUntil: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Datum výměny oleje</Label><Input type="date" value={editForm.lastOilChangeDate} onChange={e => setEditForm(f => ({ ...f, lastOilChangeDate: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Km při výměně oleje</Label><Input type="number" value={editForm.lastOilChangeKm} onChange={e => setEditForm(f => ({ ...f, lastOilChangeKm: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Datum servisu brzd</Label><Input type="date" value={editForm.lastBrakesDate} onChange={e => setEditForm(f => ({ ...f, lastBrakesDate: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Datum servisu rozvodů</Label><Input type="date" value={editForm.lastTimingDate} onChange={e => setEditForm(f => ({ ...f, lastTimingDate: e.target.value }))} /></div>
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
