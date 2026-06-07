import { useState, useMemo } from "react";
import { Link } from "wouter";
import { LicensePlate } from "@/components/license-plate";
import {
  useListVehicles, useListLoaners, useCreateLoaner, useUpdateLoaner, useDeleteLoaner,
  useGetVehicleByPlate, useCheckLoanerOverlap, useListLoanerCustomerSuggestions,
  getListLoanersQueryKey,
} from "@workspace/api-client-react";
import type { Loaner, LoanerCustomerSuggestion } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { ChevronLeft, ChevronRight, Plus, KeyRound, Car, AlertTriangle, Search, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const DAY_LABELS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
const MONTH_GENITIVE = [
  "ledna", "února", "března", "dubna", "května", "června",
  "července", "srpna", "září", "října", "listopadu", "prosince",
];

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function startOfWeek(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - offset);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}
function fmtRange(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) return `${start.getDate()}. – ${end.getDate()}. ${MONTH_GENITIVE[end.getMonth()]} ${end.getFullYear()}`;
  if (sameYear) return `${start.getDate()}. ${MONTH_GENITIVE[start.getMonth()]} – ${end.getDate()}. ${MONTH_GENITIVE[end.getMonth()]} ${end.getFullYear()}`;
  return `${start.getDate()}. ${MONTH_GENITIVE[start.getMonth()]} ${start.getFullYear()} – ${end.getDate()}. ${MONTH_GENITIVE[end.getMonth()]} ${end.getFullYear()}`;
}
function fmtDate(d?: string | null): string {
  if (!d) return "—";
  try { return new Date(d + "T00:00:00").toLocaleDateString("cs-CZ", { day: "numeric", month: "long", year: "numeric" }); } catch { return d; }
}
function loanerLabel(l: Loaner): string {
  return [l.fleetLicensePlate, [l.fleetMake, l.fleetModel].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "Zápůjčka";
}
function loanerActiveOn(l: Loaner, iso: string): boolean {
  if (l.startDate > iso) return false;
  if (l.endDate && l.endDate < iso) return false;
  return true;
}

type FormState = {
  fleetVehicleId: string;
  licensePlate: string;
  customerName: string;
  customerPhone: string;
  startDate: string;
  endDate: string;
  note: string;
};

const emptyForm = (): FormState => ({
  fleetVehicleId: "",
  licensePlate: "",
  customerName: "",
  customerPhone: "",
  startDate: toISO(new Date()),
  endDate: "",
  note: "",
});

export default function FleetPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [cursor, setCursor] = useState(() => startOfWeek(new Date()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Loaner | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [historySearch, setHistorySearch] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [nameSuggestOpen, setNameSuggestOpen] = useState(false);
  const [confirmOverlapOpen, setConfirmOverlapOpen] = useState(false);

  const gridStart = useMemo(() => addDays(cursor, -14), [cursor]);
  const gridEnd = useMemo(() => addDays(cursor, 14 + 6), [cursor]);
  const from = toISO(gridStart);
  const to = toISO(gridEnd);

  const { data: fleetVehicles = [] } = useListVehicles({ fleet: true });
  const { data: calendarLoaners = [] } = useListLoaners({ from, to });
  const { data: allLoaners = [] } = useListLoaners();
  const { data: activeLoaners = [] } = useListLoaners({ status: "active" });

  const resolvedPlate = form.licensePlate.trim().toUpperCase().replace(/\s+/g, "");
  const { data: linkedVehicle } = useGetVehicleByPlate(resolvedPlate, {
    query: { enabled: resolvedPlate.length >= 4 } as any,
  });

  const { data: nameSuggestions = [] } = useListLoanerCustomerSuggestions(
    { search: form.customerName.trim() },
    { query: { enabled: dialogOpen && nameTouched && form.customerName.trim().length >= 2 } as any },
  );

  function pickCustomerSuggestion(s: LoanerCustomerSuggestion) {
    setForm((f) => ({
      ...f,
      customerName: s.ownerName ?? "",
      customerPhone: s.ownerPhone ?? "",
      licensePlate: s.licensePlate,
    }));
    setNameTouched(false);
    setNameSuggestOpen(false);
  }

  const overlap = useCheckLoanerOverlap(
    {
      fleetVehicleId: form.fleetVehicleId ? parseInt(form.fleetVehicleId, 10) : 0,
      startDate: form.startDate,
      endDate: form.endDate || null,
      excludeId: editing?.id,
    },
    { query: { enabled: dialogOpen && !!form.fleetVehicleId && !!form.startDate } as any },
  );

  const createLoaner = useCreateLoaner();
  const updateLoaner = useUpdateLoaner();
  const deleteLoaner = useDeleteLoaner();

  const activeByFleetId = useMemo(() => {
    const map = new Map<number, Loaner>();
    for (const l of activeLoaners) {
      if (!map.has(l.fleetVehicleId)) map.set(l.fleetVehicleId, l);
    }
    return map;
  }, [activeLoaners]);

  // Number of concurrently active loans per fleet vehicle. More than one means
  // the same replacement car is double-booked (overlapping loans).
  const activeCountByFleetId = useMemo(() => {
    const map = new Map<number, number>();
    for (const l of activeLoaners) {
      map.set(l.fleetVehicleId, (map.get(l.fleetVehicleId) ?? 0) + 1);
    }
    return map;
  }, [activeLoaners]);

  const grid = useMemo(() => {
    const days: { date: Date; inCurrentWeek: boolean }[] = [];
    for (let i = 0; i < 35; i++) {
      days.push({ date: addDays(gridStart, i), inCurrentWeek: i >= 14 && i < 21 });
    }
    return days;
  }, [gridStart]);

  const history = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    const sorted = [...allLoaners].sort((a, b) => b.startDate.localeCompare(a.startDate));
    if (!q) return sorted;
    return sorted.filter(l => {
      const hay = [
        l.fleetLicensePlate, l.fleetMake, l.fleetModel,
        l.customerName, l.customerPhone, l.customerLicensePlate, l.note,
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [allLoaners, historySearch]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setDialogOpen(true);
  }

  function openEdit(l: Loaner) {
    setEditing(l);
    setForm({
      fleetVehicleId: String(l.fleetVehicleId),
      licensePlate: l.customerLicensePlate ?? "",
      customerName: l.customerName ?? "",
      customerPhone: l.customerPhone ?? "",
      startDate: l.startDate,
      endDate: l.endDate ?? "",
      note: l.note ?? "",
    });
    setDialogOpen(true);
  }

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListLoanersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListLoanersQueryKey({ from, to }) });
    queryClient.invalidateQueries({ queryKey: getListLoanersQueryKey({ status: "active" }) });
  }

  function handleSave() {
    if (!form.fleetVehicleId) {
      toast({ title: "Vyberte vozidlo z vozového parku", variant: "destructive" });
      return;
    }
    if (!form.startDate) {
      toast({ title: "Chybí datum zapůjčení", variant: "destructive" });
      return;
    }
    // Overlapping loan: ask for explicit confirmation, but never block.
    if (hasOverlap) {
      setConfirmOverlapOpen(true);
      return;
    }
    void doSave();
  }

  async function doSave() {
    const payload = {
      fleetVehicleId: parseInt(form.fleetVehicleId, 10),
      customerVehicleId: linkedVehicle?.id ?? null,
      customerName: form.customerName.trim() || null,
      customerPhone: form.customerPhone.trim() || null,
      startDate: form.startDate,
      endDate: form.endDate || null,
      manualEndDate: !!form.endDate,
      status: form.endDate ? "returned" as const : "active" as const,
      note: form.note.trim() || null,
    };
    try {
      if (editing) {
        await updateLoaner.mutateAsync({ id: editing.id, data: payload });
        toast({ title: "Zápůjčka upravena" });
      } else {
        await createLoaner.mutateAsync({ data: payload });
        toast({ title: "Zápůjčka vytvořena" });
      }
      invalidate();
      setDialogOpen(false);
      setConfirmOverlapOpen(false);
    } catch (e: any) {
      toast({ title: "Chyba", description: String(e?.message ?? e), variant: "destructive" });
    }
  }

  async function handleReturnNow(l: Loaner) {
    try {
      await updateLoaner.mutateAsync({ id: l.id, data: { endDate: toISO(new Date()), manualEndDate: true, status: "returned" } });
      invalidate();
      toast({ title: "Vozidlo vráceno" });
    } catch (e: any) {
      toast({ title: "Chyba", description: String(e?.message ?? e), variant: "destructive" });
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm("Smazat zápůjčku?")) return;
    try {
      await deleteLoaner.mutateAsync({ id: editing.id });
      invalidate();
      toast({ title: "Smazáno" });
      setDialogOpen(false);
    } catch (e: any) {
      toast({ title: "Chyba", description: String(e?.message ?? e), variant: "destructive" });
    }
  }

  const todayISO = toISO(new Date());
  const hasOverlap = (overlap.data?.length ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold">Vozový park</h1>
          <p className="text-muted-foreground">Náhradní vozidla a jejich zápůjčky zákazníkům</p>
        </div>
        <div className="flex gap-2">
          <Link href="/vehicles/new?fleet=1">
            <Button variant="outline"><Car className="h-4 w-4 mr-2" /> Přidat vozidlo</Button>
          </Link>
          <Button onClick={openCreate} disabled={fleetVehicles.length === 0}>
            <Plus className="h-4 w-4 mr-2" /> Nová zápůjčka
          </Button>
        </div>
      </div>

      {/* Fleet vehicles */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" /> Náhradní vozidla ({fleetVehicles.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {fleetVehicles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Zatím nemáte žádná vozidla ve vozovém parku.{" "}
              <Link href="/vehicles/new?fleet=1" className="underline">Přidat náhradní vozidlo</Link>.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {fleetVehicles.map(v => {
                const active = activeByFleetId.get(v.id);
                const activeCount = activeCountByFleetId.get(v.id) ?? 0;
                const doubleBooked = activeCount > 1;
                return (
                  <div
                    key={v.id}
                    className={`rounded-lg border p-3 flex flex-col gap-2 ${doubleBooked ? "border-amber-400 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <LicensePlate plate={v.licensePlate} size="sm" />
                      {active ? (
                        <Badge className="bg-amber-500 text-white hover:bg-amber-600">Zapůjčeno</Badge>
                      ) : (
                        <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">Dostupné</Badge>
                      )}
                    </div>
                    <div className="text-sm font-medium">{[v.make, v.model].filter(Boolean).join(" ") || "—"}</div>
                    {doubleBooked && (
                      <div className="flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        <span>Překryv zápůjček: toto vozidlo má {activeCount} souběžné aktivní zápůjčky.</span>
                      </div>
                    )}
                    {active && (
                      <div className="text-xs text-muted-foreground">
                        {active.customerName || active.customerLicensePlate || "zákazník"} — od {fmtDate(active.startDate)}
                      </div>
                    )}
                    <div className="flex gap-2 mt-auto pt-1">
                      <Link href={`/vehicles/${v.id}`}>
                        <Button variant="outline" size="sm">Detail</Button>
                      </Link>
                      {active && (
                        <Button variant="outline" size="sm" onClick={() => handleReturnNow(active)}>Vrátit</Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Calendar */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xl">{fmtRange(gridStart, gridEnd)}</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCursor(addDays(cursor, -7))}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setCursor(startOfWeek(new Date()))}>Tento týden</Button>
            <Button variant="outline" size="icon" onClick={() => setCursor(addDays(cursor, 7))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px bg-border border rounded-md overflow-hidden">
            {DAY_LABELS.map(d => (
              <div key={d} className="bg-muted text-center text-xs font-medium py-2 text-muted-foreground">{d}</div>
            ))}
            {grid.map((cell, idx) => {
              const iso = toISO(cell.date);
              const items = calendarLoaners.filter(l => loanerActiveOn(l, iso));
              const isToday = iso === todayISO;
              return (
                <div key={idx} className={`min-h-[110px] p-2 flex flex-col gap-1 ${cell.inCurrentWeek ? "bg-primary/5" : "bg-card"}`}>
                  <span className={`text-sm font-medium ${isToday ? "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center" : ""}`}>
                    {cell.date.getDate()}
                  </span>
                  <div className="space-y-1 overflow-hidden">
                    {items.slice(0, 3).map(l => (
                      <div
                        key={l.id}
                        onClick={() => openEdit(l)}
                        className={`text-xs px-1.5 py-0.5 rounded truncate cursor-pointer ${l.status === "active" ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"}`}
                        title={loanerLabel(l)}
                      >
                        {l.fleetLicensePlate || loanerLabel(l)}
                      </div>
                    ))}
                    {items.length > 3 && <div className="text-[10px] text-muted-foreground">+ {items.length - 3} dalších</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-3">
          <CardTitle>Historie zápůjček</CardTitle>
          <div className="relative w-64 max-w-full">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input className="pl-8" placeholder="Hledat (SPZ, zákazník, telefon…)" value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} />
          </div>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné zápůjčky.</p>
          ) : (
            <div className="divide-y">
              {history.map(l => (
                <div key={l.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      {l.fleetLicensePlate && <LicensePlate plate={l.fleetLicensePlate} size="sm" />}
                      <span className="font-medium">{[l.fleetMake, l.fleetModel].filter(Boolean).join(" ")}</span>
                      {l.status === "active" ? (
                        <Badge className="bg-amber-500 text-white hover:bg-amber-600">Zapůjčeno</Badge>
                      ) : (
                        <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">Vráceno</Badge>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5 truncate">
                      {fmtDate(l.startDate)} – {l.endDate ? fmtDate(l.endDate) : "trvá"}
                      {(l.customerName || l.customerLicensePlate) && (
                        <span className="ml-2">· {l.customerName || l.customerLicensePlate}</span>
                      )}
                      {l.customerPhone && <span className="ml-2">· {l.customerPhone}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {l.workOrderId && (
                      <Link href={`/work-orders/${l.workOrderId}`}>
                        <Button variant="outline" size="sm">Zakázka</Button>
                      </Link>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openEdit(l)}>Upravit</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Upravit zápůjčku" : "Nová zápůjčka"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Náhradní vozidlo</Label>
              <Select value={form.fleetVehicleId} onValueChange={(v) => setForm({ ...form, fleetVehicleId: v })}>
                <SelectTrigger><SelectValue placeholder="Vyberte vozidlo" /></SelectTrigger>
                <SelectContent>
                  {fleetVehicles.map(v => (
                    <SelectItem key={v.id} value={String(v.id)}>{v.licensePlate} — {v.make} {v.model}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {hasOverlap && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-amber-800 dark:text-amber-300">Možný překryv zápůjček</p>
                  <p className="text-amber-700 dark:text-amber-400">Toto vozidlo je v daném období již zapůjčeno. Můžete pokračovat.</p>
                </div>
              </div>
            )}
            <div>
              <Label>SPZ zákazníka (volitelné)</Label>
              <Input value={form.licensePlate} onChange={(e) => setForm({ ...form, licensePlate: e.target.value.toUpperCase() })} placeholder="např. 1AB 2345" />
              {linkedVehicle && (
                <p className="text-xs text-muted-foreground mt-1">
                  Vozidlo: {linkedVehicle.make} {linkedVehicle.model}{linkedVehicle.ownerName ? ` · ${linkedVehicle.ownerName}` : ""}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="relative">
                <Label>Zákazník (jméno)</Label>
                <Input
                  value={form.customerName}
                  onChange={(e) => { setForm({ ...form, customerName: e.target.value }); setNameTouched(true); setNameSuggestOpen(true); }}
                  onFocus={() => setNameSuggestOpen(true)}
                  onBlur={() => setTimeout(() => setNameSuggestOpen(false), 150)}
                />
                {nameSuggestOpen && nameSuggestions.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-auto">
                    {nameSuggestions.map((s) => (
                      <button
                        key={s.vehicleId}
                        type="button"
                        onMouseDown={(e) => { e.preventDefault(); pickCustomerSuggestion(s); }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                      >
                        <span className="font-medium">{s.ownerName || "—"}</span>
                        <span className="text-muted-foreground">
                          {" "}· {s.licensePlate}{s.ownerPhone ? ` · ${s.ownerPhone}` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <Label>Telefon</Label>
                <Input value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Zapůjčeno od</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div>
                <Label>Vráceno (volitelné)</Label>
                <Input type="date" value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Poznámka</Label>
              <Textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            </div>
          </div>
          <DialogFooter className="flex justify-between sm:justify-between">
            <div>
              {editing && (
                <Button variant="destructive" onClick={handleDelete}><Trash2 className="h-4 w-4 mr-1" /> Smazat</Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Zavřít</Button>
              <Button onClick={handleSave} disabled={createLoaner.isPending || updateLoaner.isPending}>{editing ? "Uložit" : "Vytvořit"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOverlapOpen} onOpenChange={setConfirmOverlapOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" /> Možný překryv zápůjček
            </AlertDialogTitle>
            <AlertDialogDescription>
              Toto vozidlo je v daném období již zapůjčeno. Pokud budete pokračovat,
              vznikne souběžná (překrývající se) zápůjčka stejného náhradního vozidla.
              Opravdu chcete pokračovat?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 text-white hover:bg-amber-700"
              onClick={(e) => { e.preventDefault(); void doSave(); }}
            >
              Pokračovat i tak
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
