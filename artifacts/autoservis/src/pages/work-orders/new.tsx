import { useState, useMemo } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { LicensePlate } from "@/components/license-plate";
import { useCreateWorkOrder, useGetVehicleByPlate, useListVehicles, getListWorkOrdersQueryKey } from "@workspace/api-client-react";
import { DEFAULT_HOURLY_RATE, computeLaborPrice } from "@/lib/labor";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Search, Car } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function NewWorkOrder() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createWorkOrder = useCreateWorkOrder();

  const params = new URLSearchParams(search);
  const initialSpz = params.get("spz") ?? "";

  const [spz, setSpz] = useState(initialSpz);
  const [spzQuery, setSpzQuery] = useState(initialSpz);
  const [showSuggest, setShowSuggest] = useState(false);

  const { data: foundVehicle } = useGetVehicleByPlate(spzQuery, {
    query: { enabled: spzQuery.length >= 3 } as any
  });

  const searchTerm = spz.trim();
  const { data: vehicleMatches = [] } = useListVehicles(
    { search: searchTerm },
    { query: { enabled: searchTerm.length >= 1 } as any }
  );

  const suggestions = useMemo(() => {
    const normalized = searchTerm.toUpperCase();
    return vehicleMatches
      .filter((v) => v.licensePlate.toUpperCase() !== normalized)
      .slice(0, 6);
  }, [vehicleMatches, searchTerm]);

  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({
    km: "", description: "",
    oilChange: false, transmissionOil: false, brakes: false,
    timing: false, airFilter: false, cabinFilter: false, stk: false,
    tireChange: false, diagnostics: false, lightsCheck: false, brakeFluid: false,
    frontAxleCheck: false, rearAxleCheck: false,
    otherWork: "", otherServices: "", notes: "",
    laborHours: "", laborPrice: "",
    serviceDate: today,
  });
  const [priceManual, setPriceManual] = useState(false);

  function handleHoursChange(value: string) {
    const cleaned = value.replace(",", ".");
    setForm(f => ({
      ...f,
      laborHours: cleaned,
      laborPrice: priceManual ? f.laborPrice : computeLaborPrice(cleaned),
    }));
  }

  function handlePriceChange(value: string) {
    setForm(f => ({ ...f, laborPrice: value }));
    setPriceManual(value.trim() !== "");
  }

  function handleSpzChange(value: string) {
    setSpz(value);
    setShowSuggest(true);
    if (value.length >= 3) setSpzQuery(value.toUpperCase().trim());
    else setSpzQuery("");
  }

  function pickSuggestion(plate: string) {
    setSpz(plate);
    setSpzQuery(plate.toUpperCase().trim());
    setShowSuggest(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!spz.trim()) {
      toast({ title: "Zadejte SPZ", variant: "destructive" });
      return;
    }
    createWorkOrder.mutate({
      data: {
        licensePlate: spz.toUpperCase().trim(),
        km: form.km ? parseInt(form.km) : null,
        description: form.description || null,
        oilChange: form.oilChange,
        transmissionOil: form.transmissionOil,
        brakes: form.brakes,
        timing: form.timing,
        airFilter: form.airFilter,
        cabinFilter: form.cabinFilter,
        stk: form.stk,
        tireChange: form.tireChange,
        diagnostics: form.diagnostics,
        lightsCheck: form.lightsCheck,
        brakeFluid: form.brakeFluid,
        frontAxleCheck: form.frontAxleCheck,
        rearAxleCheck: form.rearAxleCheck,
        serviceDate: form.serviceDate || null,
        otherWork: form.otherWork || null,
        otherServices: form.otherServices || null,
        notes: form.notes || null,
        laborHours: form.laborHours.trim() || null,
        laborPrice: form.laborPrice ? parseInt(form.laborPrice, 10) : null,
      }
    }, {
      onSuccess: (order) => {
        queryClient.invalidateQueries({ queryKey: getListWorkOrdersQueryKey() });
        toast({ title: "Zakázka vytvořena" });
        navigate(`/work-orders/${order.id}`);
      },
      onError: () => {
        toast({ title: "Chyba", description: "Zakázku se nepodařilo vytvořit.", variant: "destructive" });
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/work-orders">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Nová zakázka</h1>
          <p className="text-muted-foreground">Zadejte SPZ a servisní úkony.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6 max-w-2xl">
        <Card>
          <CardHeader><CardTitle>Vozidlo</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>SPZ *</Label>
              <div className="relative">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="1A2 3456"
                  className="pl-9 font-mono uppercase text-lg"
                  value={spz}
                  onChange={e => handleSpzChange(e.target.value)}
                  onFocus={() => setShowSuggest(true)}
                  onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
                  autoComplete="off"
                  required
                />
                {showSuggest && suggestions.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full bg-popover border rounded-md shadow-md max-h-64 overflow-auto">
                    {suggestions.map((v) => (
                      <button
                        type="button"
                        key={v.id}
                        onMouseDown={(e) => { e.preventDefault(); pickSuggestion(v.licensePlate); }}
                        className="w-full text-left px-3 py-2 hover:bg-accent flex items-center justify-between gap-3"
                      >
                        <LicensePlate plate={v.licensePlate} size="sm" />
                        <span className="text-xs text-muted-foreground truncate">
                          {v.make} {v.model}{v.year ? ` (${v.year})` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {foundVehicle && (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-sm">
                <Car className="h-4 w-4 text-emerald-600 shrink-0" />
                <div>
                  <span className="font-semibold text-emerald-700 dark:text-emerald-300">{foundVehicle.make} {foundVehicle.model}</span>
                  {foundVehicle.year && <span className="text-emerald-600 dark:text-emerald-400"> ({foundVehicle.year})</span>}
                  {foundVehicle.currentKm && <span className="text-emerald-600 dark:text-emerald-400"> — {foundVehicle.currentKm.toLocaleString('cs-CZ')} km</span>}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Aktuální km</Label>
                <Input type="number" placeholder="najeté km" value={form.km} onChange={e => setForm(f => ({ ...f, km: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Datum servisu</Label>
                <Input type="date" max={today} value={form.serviceDate} onChange={e => setForm(f => ({ ...f, serviceDate: e.target.value }))} />
                {form.serviceDate && form.serviceDate < today && (
                  <p className="text-xs text-amber-600">Zpětně zadaná zakázka.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Servisní úkony</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {[
                { key: "oilChange", label: "Výměna motorového oleje" },
                ...(foundVehicle?.transmission === "automatic" ? [{ key: "transmissionOil", label: "Olej v převodovce" }] : []),
                { key: "brakes", label: "Servis brzd" },
                { key: "airFilter", label: "Filtr vzduchový" },
                { key: "brakeFluid", label: "Výměna brzdové kapaliny" },
                { key: "cabinFilter", label: "Filtr kabinový" },
                { key: "timing", label: "Rozvody" },
                { key: "tireChange", label: "Přezutí pneumatik" },
                { key: "diagnostics", label: "Diagnostika" },
                { key: "lightsCheck", label: "Kontrola osvětlení" },
                { key: "frontAxleCheck", label: "Kontrola přední nápravy" },
                { key: "stk", label: "STK" },
                { key: "rearAxleCheck", label: "Kontrola zadní nápravy" },
              ].map(item => (
                <Label
                  key={item.key}
                  htmlFor={item.key}
                  className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-accent/30 transition-colors cursor-pointer font-medium"
                >
                  <Checkbox
                    id={item.key}
                    checked={form[item.key as keyof typeof form] as boolean}
                    onCheckedChange={v => setForm(f => ({ ...f, [item.key]: !!v }))}
                  />
                  <span>{item.label}</span>
                </Label>
              ))}
            </div>
            <div className="space-y-1">
              <Label>Ostatní servisní úkony</Label>
              <Textarea placeholder="Další servisní úkony mimo standardní položky..." value={form.otherServices} onChange={e => setForm(f => ({ ...f, otherServices: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Ostatní práce</Label>
              <Input placeholder="Výměna žárovky, korekce geometrie..." value={form.otherWork} onChange={e => setForm(f => ({ ...f, otherWork: e.target.value }))} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Práce a cena</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Počet hodin práce</Label>
                <Input
                  type="text" inputMode="decimal" placeholder="2.5"
                  value={form.laborHours}
                  onChange={e => handleHoursChange(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Cena za práci (Kč) <span className="text-xs text-muted-foreground font-normal">— sazba {DEFAULT_HOURLY_RATE} Kč/h</span></Label>
                <Input
                  type="number" placeholder="1500"
                  value={form.laborPrice}
                  onChange={e => handlePriceChange(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Popis a poznámky</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label>Popis závady / požadavku</Label>
              <Textarea placeholder="Zákazník si stěžuje na... / Vozidlo přivezeno na..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Interní poznámky</Label>
              <Textarea placeholder="Poznámky pro dílnu..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Link href="/work-orders"><Button type="button" variant="outline">Zrušit</Button></Link>
          <Button type="submit" size="lg" disabled={createWorkOrder.isPending}>Vytvořit zakázku</Button>
        </div>
      </form>
    </div>
  );
}
