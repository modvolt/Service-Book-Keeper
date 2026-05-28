import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useCreateVehicle, getListVehiclesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function NewVehicle() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createVehicle = useCreateVehicle();

  const [form, setForm] = useState({
    licensePlate: "", make: "", model: "", year: "", color: "", vin: "",
    currentKm: "", notes: "", stkValidUntil: "",
    lastOilChangeKm: "", lastOilChangeDate: "", lastBrakesDate: "", lastTimingDate: ""
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createVehicle.mutate({
      data: {
        licensePlate: form.licensePlate.toUpperCase().trim(),
        make: form.make,
        model: form.model,
        year: form.year ? parseInt(form.year) : null,
        color: form.color || null,
        vin: form.vin || null,
        currentKm: form.currentKm ? parseInt(form.currentKm) : null,
        notes: form.notes || null,
        stkValidUntil: form.stkValidUntil || null,
        lastOilChangeKm: form.lastOilChangeKm ? parseInt(form.lastOilChangeKm) : null,
        lastOilChangeDate: form.lastOilChangeDate || null,
        lastBrakesDate: form.lastBrakesDate || null,
        lastTimingDate: form.lastTimingDate || null,
      }
    }, {
      onSuccess: (vehicle) => {
        queryClient.invalidateQueries({ queryKey: getListVehiclesQueryKey() });
        toast({ title: "Vozidlo přidáno" });
        navigate(`/vehicles/${vehicle.id}`);
      },
      onError: () => {
        toast({ title: "Chyba", description: "Vozidlo se nepodařilo přidat.", variant: "destructive" });
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/vehicles">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nové vozidlo</h1>
          <p className="text-muted-foreground">Přidejte nové vozidlo do evidence.</p>
        </div>
      </div>

      <Card className="max-w-2xl">
        <CardHeader><CardTitle>Údaje o vozidle</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1 col-span-2">
                <Label>SPZ *</Label>
                <Input
                  placeholder="1A2 3456"
                  value={form.licensePlate}
                  onChange={e => setForm(f => ({ ...f, licensePlate: e.target.value }))}
                  required
                  className="font-mono uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label>Výrobce *</Label>
                <Input placeholder="Škoda" value={form.make} onChange={e => setForm(f => ({ ...f, make: e.target.value }))} required />
              </div>
              <div className="space-y-1">
                <Label>Model *</Label>
                <Input placeholder="Octavia" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} required />
              </div>
              <div className="space-y-1">
                <Label>Rok výroby</Label>
                <Input type="number" placeholder="2018" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Barva</Label>
                <Input placeholder="Bílá" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label>VIN</Label>
                <Input placeholder="TMBZZZ1Z..." value={form.vin} onChange={e => setForm(f => ({ ...f, vin: e.target.value }))} className="font-mono" />
              </div>
              <div className="space-y-1">
                <Label>Aktuální km</Label>
                <Input type="number" placeholder="85000" value={form.currentKm} onChange={e => setForm(f => ({ ...f, currentKm: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>STK platná do</Label>
                <Input type="date" value={form.stkValidUntil} onChange={e => setForm(f => ({ ...f, stkValidUntil: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Datum výměny oleje</Label>
                <Input type="date" value={form.lastOilChangeDate} onChange={e => setForm(f => ({ ...f, lastOilChangeDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Km při výměně oleje</Label>
                <Input type="number" value={form.lastOilChangeKm} onChange={e => setForm(f => ({ ...f, lastOilChangeKm: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Datum servisu brzd</Label>
                <Input type="date" value={form.lastBrakesDate} onChange={e => setForm(f => ({ ...f, lastBrakesDate: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Datum servisu rozvodů</Label>
                <Input type="date" value={form.lastTimingDate} onChange={e => setForm(f => ({ ...f, lastTimingDate: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Poznámky</Label>
              <Textarea placeholder="Libovolné poznámky k vozidlu..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Link href="/vehicles"><Button type="button" variant="outline">Zrušit</Button></Link>
              <Button type="submit" disabled={createVehicle.isPending}>Přidat vozidlo</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
