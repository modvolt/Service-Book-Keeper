import { useState, useMemo } from "react";
import { Link } from "wouter";
import {
  useListAppointments, useCreateAppointment, useUpdateAppointment, useDeleteAppointment,
  useGetVehicleByPlate, getListAppointmentsQueryKey,
} from "@workspace/api-client-react";
import type { Appointment } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, Plus, Trash2, Car } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const DAY_LABELS = ["Po", "Út", "St", "Čt", "Pá", "So", "Ne"];
const MONTH_LABELS = [
  "Leden", "Únor", "Březen", "Duben", "Květen", "Červen",
  "Červenec", "Srpen", "Září", "Říjen", "Listopad", "Prosinec",
];

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function addMonths(d: Date, n: number) { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
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
const MONTH_GENITIVE = [
  "ledna", "února", "března", "dubna", "května", "června",
  "července", "srpna", "září", "října", "listopadu", "prosince",
];
function fmtRange(start: Date, end: Date): string {
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) return `${start.getDate()}. – ${end.getDate()}. ${MONTH_GENITIVE[end.getMonth()]} ${end.getFullYear()}`;
  if (sameYear) return `${start.getDate()}. ${MONTH_GENITIVE[start.getMonth()]} – ${end.getDate()}. ${MONTH_GENITIVE[end.getMonth()]} ${end.getFullYear()}`;
  return `${start.getDate()}. ${MONTH_GENITIVE[start.getMonth()]} ${start.getFullYear()} – ${end.getDate()}. ${MONTH_GENITIVE[end.getMonth()]} ${end.getFullYear()}`;
}

type FormState = {
  scheduledDate: string;
  scheduledTime: string;
  licensePlate: string;
  customerName: string;
  customerPhone: string;
  description: string;
  notes: string;
  status: "planned" | "done" | "cancelled";
};

const emptyForm = (date: string): FormState => ({
  scheduledDate: date,
  scheduledTime: "",
  licensePlate: "",
  customerName: "",
  customerPhone: "",
  description: "",
  notes: "",
  status: "planned",
});

const STATUS_LABEL: Record<string, string> = {
  planned: "Plánováno",
  done: "Hotovo",
  cancelled: "Zrušeno",
};

const STATUS_BADGE: Record<string, string> = {
  planned: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  done: "bg-green-100 text-green-800 hover:bg-green-100",
  cancelled: "bg-gray-200 text-gray-700 hover:bg-gray-200",
};

export default function CalendarPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // cursor = Monday of the "current" week (the middle of the 5-week strip)
  const [cursor, setCursor] = useState(() => startOfWeek(new Date()));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm(toISO(new Date())));

  // Show 5 weeks: 2 back, current, 2 forward
  const gridStart = useMemo(() => addDays(cursor, -14), [cursor]);
  const gridEnd = useMemo(() => addDays(cursor, 14 + 6), [cursor]); // last day of week+2
  const from = toISO(gridStart);
  const to = toISO(gridEnd);

  const { data: appointments = [] } = useListAppointments({ from, to });
  const { data: linkedVehicle } = useGetVehicleByPlate(form.licensePlate.trim().toUpperCase().replace(/\s+/g, ""), {
    query: { enabled: form.licensePlate.trim().length >= 4 } as any,
  });

  const createAppt = useCreateAppointment();
  const updateAppt = useUpdateAppointment();
  const deleteAppt = useDeleteAppointment();

  const byDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const key = a.scheduledDate;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(a);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (a.scheduledTime ?? "").localeCompare(b.scheduledTime ?? ""));
    }
    return map;
  }, [appointments]);

  const grid = useMemo(() => {
    const days: { date: Date; inCurrentWeek: boolean }[] = [];
    for (let i = 0; i < 35; i++) {
      const d = addDays(gridStart, i);
      const inCurrentWeek = i >= 14 && i < 21;
      days.push({ date: d, inCurrentWeek });
    }
    return days;
  }, [gridStart]);

  function openCreate(date: string) {
    setEditing(null);
    setForm(emptyForm(date));
    setDialogOpen(true);
  }

  function openEdit(a: Appointment) {
    setEditing(a);
    setForm({
      scheduledDate: a.scheduledDate,
      scheduledTime: a.scheduledTime ?? "",
      licensePlate: a.licensePlate ?? "",
      customerName: a.customerName ?? "",
      customerPhone: a.customerPhone ?? "",
      description: a.description ?? "",
      notes: a.notes ?? "",
      status: (a.status as FormState["status"]) ?? "planned",
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.scheduledDate) {
      toast({ title: "Chybí datum", variant: "destructive" });
      return;
    }
    const payload = {
      scheduledDate: form.scheduledDate,
      scheduledTime: form.scheduledTime || null,
      licensePlate: form.licensePlate.trim() || null,
      customerName: form.customerName.trim() || null,
      customerPhone: form.customerPhone.trim() || null,
      description: form.description.trim() || null,
      notes: form.notes.trim() || null,
      status: form.status,
    };
    try {
      if (editing) {
        await updateAppt.mutateAsync({ id: editing.id, data: payload });
        toast({ title: "Rezervace upravena" });
      } else {
        await createAppt.mutateAsync({ data: payload });
        toast({ title: "Rezervace přidána" });
      }
      await queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey({ from, to }) });
      setDialogOpen(false);
    } catch (e: any) {
      toast({ title: "Chyba", description: String(e?.message ?? e), variant: "destructive" });
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!confirm("Smazat rezervaci?")) return;
    try {
      await deleteAppt.mutateAsync({ id: editing.id });
      await queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey({ from, to }) });
      toast({ title: "Smazáno" });
      setDialogOpen(false);
    } catch (e: any) {
      toast({ title: "Chyba", description: String(e?.message ?? e), variant: "destructive" });
    }
  }

  const todayISO = toISO(new Date());

  // Upcoming list (next 14 days from today)
  const upcoming = useMemo(() => {
    return [...appointments]
      .filter(a => a.scheduledDate >= todayISO && a.status !== "cancelled")
      .sort((a, b) => {
        if (a.scheduledDate !== b.scheduledDate) return a.scheduledDate.localeCompare(b.scheduledDate);
        return (a.scheduledTime ?? "").localeCompare(b.scheduledTime ?? "");
      })
      .slice(0, 8);
  }, [appointments, todayISO]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Kalendář</h1>
          <p className="text-muted-foreground">Plán příjezdů vozidel do servisu</p>
        </div>
        <Button onClick={() => openCreate(todayISO)} data-testid="button-add-appointment">
          <Plus className="h-4 w-4 mr-2" /> Nová rezervace
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-xl">
            {fmtRange(gridStart, gridEnd)}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setCursor(addDays(cursor, -7))}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCursor(startOfWeek(new Date()))}>
              Tento týden
            </Button>
            <Button variant="outline" size="icon" onClick={() => setCursor(addDays(cursor, 7))}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-7 gap-px bg-border border rounded-md overflow-hidden">
            {DAY_LABELS.map(d => (
              <div key={d} className="bg-muted text-center text-xs font-medium py-2 text-muted-foreground">
                {d}
              </div>
            ))}
            {grid.map((cell, idx) => {
              const iso = toISO(cell.date);
              const items = byDay.get(iso) ?? [];
              const isToday = iso === todayISO;
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => openCreate(iso)}
                  className={`text-left min-h-[110px] p-2 hover:bg-accent/40 transition-colors flex flex-col gap-1 ${cell.inCurrentWeek ? "bg-primary/5" : "bg-card"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-medium ${isToday ? "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center" : ""}`}>
                      {cell.date.getDate()}
                    </span>
                  </div>
                  <div className="space-y-1 overflow-hidden">
                    {items.slice(0, 3).map(a => (
                      <div
                        key={a.id}
                        onClick={(e) => { e.stopPropagation(); openEdit(a); }}
                        className={`text-xs px-1.5 py-0.5 rounded truncate cursor-pointer ${
                          a.status === "cancelled" ? "bg-gray-100 text-gray-500 line-through"
                          : a.status === "done" ? "bg-green-100 text-green-800"
                          : "bg-blue-100 text-blue-800"
                        }`}
                        title={`${a.scheduledTime ?? ""} ${a.licensePlate ?? ""} ${a.description ?? ""}`.trim()}
                      >
                        {a.scheduledTime && <span className="font-medium mr-1">{a.scheduledTime}</span>}
                        {a.licensePlate || a.customerName || a.description || "(bez popisu)"}
                      </div>
                    ))}
                    {items.length > 3 && (
                      <div className="text-[10px] text-muted-foreground">+ {items.length - 3} dalších</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nejbližší rezervace</CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné nadcházející rezervace.</p>
          ) : (
            <div className="divide-y">
              {upcoming.map(a => (
                <div key={a.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">
                        {new Date(a.scheduledDate + "T00:00:00").toLocaleDateString("cs-CZ", { weekday: "short", day: "numeric", month: "long" })}
                      </span>
                      {a.scheduledTime && <span className="text-muted-foreground">{a.scheduledTime}</span>}
                      <Badge className={STATUS_BADGE[a.status] ?? ""} variant="secondary">{STATUS_LABEL[a.status] ?? a.status}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground mt-0.5 truncate">
                      {a.licensePlate && <span className="font-mono font-semibold mr-2">{a.licensePlate}</span>}
                      {a.customerName && <span className="mr-2">{a.customerName}</span>}
                      {a.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {a.vehicleId && (
                      <Link href={`/vehicles/${a.vehicleId}`}>
                        <Button variant="outline" size="sm"><Car className="h-3 w-3 mr-1" /> Vozidlo</Button>
                      </Link>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openEdit(a)}>Upravit</Button>
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
            <DialogTitle>{editing ? "Upravit rezervaci" : "Nová rezervace"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="appt-date">Datum</Label>
                <Input id="appt-date" type="date" value={form.scheduledDate}
                  onChange={(e) => setForm({ ...form, scheduledDate: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="appt-time">Čas (volitelné)</Label>
                <Input id="appt-time" type="time" value={form.scheduledTime}
                  onChange={(e) => setForm({ ...form, scheduledTime: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="appt-plate">SPZ</Label>
              <Input id="appt-plate" value={form.licensePlate}
                onChange={(e) => setForm({ ...form, licensePlate: e.target.value.toUpperCase() })}
                placeholder="např. 1AB 2345" />
              {linkedVehicle && (
                <p className="text-xs text-muted-foreground mt-1">
                  Vozidlo: {linkedVehicle.make} {linkedVehicle.model}
                  {linkedVehicle.ownerName ? ` · ${linkedVehicle.ownerName}` : ""}
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="appt-name">Zákazník</Label>
                <Input id="appt-name" value={form.customerName}
                  onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="appt-phone">Telefon</Label>
                <Input id="appt-phone" value={form.customerPhone}
                  onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} />
              </div>
            </div>
            <div>
              <Label htmlFor="appt-desc">Popis práce</Label>
              <Input id="appt-desc" value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="např. výměna oleje, STK" />
            </div>
            <div>
              <Label htmlFor="appt-notes">Poznámka</Label>
              <Textarea id="appt-notes" rows={2} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div>
              <Label>Stav</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as FormState["status"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="planned">Plánováno</SelectItem>
                  <SelectItem value="done">Hotovo</SelectItem>
                  <SelectItem value="cancelled">Zrušeno</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="flex justify-between sm:justify-between">
            <div>
              {editing && (
                <Button variant="destructive" onClick={handleDelete}>
                  <Trash2 className="h-4 w-4 mr-1" /> Smazat
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Zavřít</Button>
              <Button onClick={handleSave}>{editing ? "Uložit" : "Přidat"}</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
