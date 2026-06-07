import { useState } from "react";
import { Link } from "wouter";
import {
  useListLoaners, useCreateLoaner, useUpdateLoaner, useDeleteLoaner,
  useListVehicles, useCheckLoanerOverlap, useListLoanerCustomerSuggestions,
  getListLoanersQueryKey,
} from "@workspace/api-client-react";
import type { Vehicle, WorkOrder, LoanerCustomerSuggestion } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { LicensePlate } from "@/components/license-plate";
import { Car, KeyRound, AlertTriangle, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { cs } from "date-fns/locale";

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  try { return format(parseISO(d), "d. M. yyyy", { locale: cs }); } catch { return d; }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function LoanerSection({
  order,
  linkedVehicle,
}: {
  order: WorkOrder;
  linkedVehicle?: Vehicle;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: loaners = [] } = useListLoaners({ workOrderId: order.id });
  const loaner = loaners[0];

  // Detect a double-booked replacement car: more than one concurrent active
  // loan of the same fleet vehicle (matches the Vozový park fleet-card warning).
  const { data: fleetActiveLoaners = [] } = useListLoaners(
    { fleetVehicleId: loaner?.fleetVehicleId ?? 0, status: "active" },
    { query: { enabled: !!loaner && loaner.status === "active" } as any },
  );
  const activeLoanCount = fleetActiveLoaners.length;
  const doubleBooked = activeLoanCount > 1;

  const { data: fleetVehicles = [] } = useListVehicles({ fleet: true });

  const createLoaner = useCreateLoaner();
  const updateLoaner = useUpdateLoaner();
  const deleteLoaner = useDeleteLoaner();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [fleetId, setFleetId] = useState<string>("");
  const [note, setNote] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerVehicleId, setCustomerVehicleId] = useState<number | null>(null);
  const [customerTouched, setCustomerTouched] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [confirmOverlapOpen, setConfirmOverlapOpen] = useState(false);

  // The loan runs automatically from the work order's creation date until the
  // order is marked as invoiced (Zaplaceno), unless returned manually.
  const startDate = order.createdAt ? order.createdAt.slice(0, 10) : todayISO();

  const { data: suggestions = [] } = useListLoanerCustomerSuggestions(
    { search: customerName.trim() },
    { query: { enabled: dialogOpen && customerTouched && customerName.trim().length >= 2 } as any },
  );

  const overlap = useCheckLoanerOverlap(
    { fleetVehicleId: fleetId ? parseInt(fleetId, 10) : 0, startDate },
    { query: { enabled: dialogOpen && fleetId !== "" } as any },
  );

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getListLoanersQueryKey({ workOrderId: order.id }) });
    queryClient.invalidateQueries({ queryKey: getListLoanersQueryKey() });
  }

  function openAssign() {
    // Pre-fill the borrower from the work order's known customer (the owner of
    // the serviced vehicle); the user can edit or replace it for an unknown
    // customer before saving.
    setFleetId("");
    setNote("");
    setCustomerName(linkedVehicle?.ownerName ?? "");
    setCustomerPhone(linkedVehicle?.ownerPhone ?? "");
    setCustomerVehicleId(order.vehicleId ?? null);
    setCustomerTouched(false);
    setSuggestOpen(false);
    setDialogOpen(true);
  }

  function pickSuggestion(s: LoanerCustomerSuggestion) {
    setCustomerName(s.ownerName ?? "");
    setCustomerPhone(s.ownerPhone ?? "");
    setCustomerVehicleId(s.vehicleId);
    setCustomerTouched(false);
    setSuggestOpen(false);
  }

  function handleCreate() {
    if (!fleetId) {
      toast({ title: "Vyberte náhradní vozidlo", variant: "destructive" });
      return;
    }
    // Overlapping loan: ask for explicit confirmation, but never block.
    if ((overlap.data?.length ?? 0) > 0) {
      setConfirmOverlapOpen(true);
      return;
    }
    doCreate();
  }

  function doCreate() {
    createLoaner.mutate({
      data: {
        fleetVehicleId: parseInt(fleetId, 10),
        workOrderId: order.id,
        customerVehicleId,
        customerName: customerName.trim() || null,
        customerPhone: customerPhone.trim() || null,
        startDate,
        note: note.trim() || null,
      },
    }, {
      onSuccess: () => {
        invalidate();
        setDialogOpen(false);
        setConfirmOverlapOpen(false);
        setFleetId("");
        setNote("");
        setCustomerName("");
        setCustomerPhone("");
        setCustomerVehicleId(null);
        toast({ title: "Zápůjčka vytvořena" });
      },
      onError: () => toast({ title: "Chyba", description: "Zápůjčku se nepodařilo vytvořit.", variant: "destructive" }),
    });
  }

  function handleReturnDate(value: string) {
    if (!loaner) return;
    updateLoaner.mutate({
      id: loaner.id,
      data: {
        endDate: value || null,
        manualEndDate: !!value,
        status: value ? "returned" : "active",
      },
    }, {
      onSuccess: () => { invalidate(); toast({ title: "Datum vrácení upraveno" }); },
      onError: () => toast({ title: "Chyba", variant: "destructive" }),
    });
  }

  function handleReturnNow() {
    if (!loaner) return;
    updateLoaner.mutate({
      id: loaner.id,
      data: { endDate: todayISO(), manualEndDate: true, status: "returned" },
    }, {
      onSuccess: () => { invalidate(); toast({ title: "Vozidlo vráceno" }); },
      onError: () => toast({ title: "Chyba", variant: "destructive" }),
    });
  }

  function handleDelete() {
    if (!loaner) return;
    if (!confirm("Smazat zápůjčku?")) return;
    deleteLoaner.mutate({ id: loaner.id }, {
      onSuccess: () => { invalidate(); toast({ title: "Zápůjčka smazána" }); },
      onError: () => toast({ title: "Chyba", variant: "destructive" }),
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" /> Náhradní vozidlo (zápůjčka)
        </CardTitle>
        {!loaner && (
          <Button size="sm" variant="outline" onClick={openAssign}>
            <Car className="h-4 w-4 mr-2" /> Přidělit náhradní vozidlo
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!loaner ? (
          <p className="text-sm text-muted-foreground">
            K této zakázce není přiřazeno žádné náhradní vozidlo.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              {loaner.fleetLicensePlate && <LicensePlate plate={loaner.fleetLicensePlate} size="md" />}
              <span className="text-sm font-medium">
                {[loaner.fleetMake, loaner.fleetModel].filter(Boolean).join(" ") || "Náhradní vozidlo"}
              </span>
              {loaner.status === "active" ? (
                <Badge className="bg-amber-500 text-white hover:bg-amber-600">Zapůjčeno</Badge>
              ) : (
                <Badge className="bg-emerald-600 text-white hover:bg-emerald-700">Vráceno</Badge>
              )}
            </div>

            {doubleBooked && (
              <div className="flex items-start gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>Překryv zápůjček: toto vozidlo má {activeLoanCount} souběžné aktivní zápůjčky.</span>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <span className="text-muted-foreground">Zapůjčeno od</span>
                <div className="font-medium">{fmtDate(loaner.startDate)}</div>
              </div>
              <div className="space-y-1">
                <Label className="text-muted-foreground font-normal">Datum vrácení (ruční úprava)</Label>
                <Input
                  type="date"
                  value={loaner.endDate ?? ""}
                  min={loaner.startDate}
                  onChange={(e) => handleReturnDate(e.target.value)}
                />
                {!loaner.manualEndDate && loaner.status === "active" && (
                  <p className="text-xs text-muted-foreground">
                    Vozidlo se automaticky vrátí při označení zakázky jako vyfakturované (Zaplaceno).
                  </p>
                )}
              </div>
            </div>

            {loaner.note && (
              <p className="text-sm text-muted-foreground">Poznámka: {loaner.note}</p>
            )}

            <div className="flex items-center gap-2">
              {loaner.status === "active" && (
                <Button size="sm" variant="outline" onClick={handleReturnNow} disabled={updateLoaner.isPending}>
                  Vrátit nyní
                </Button>
              )}
              <Button size="sm" variant="ghost" className="text-destructive" onClick={handleDelete}>
                <Trash2 className="h-4 w-4 mr-1" /> Smazat
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Přidělit náhradní vozidlo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Vozidlo z vozového parku</Label>
              {fleetVehicles.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Žádná vozidla ve vozovém parku.{" "}
                  <Link href="/vehicles/new?fleet=1" className="underline">Přidat vozidlo</Link>
                </p>
              ) : (
                <Select value={fleetId} onValueChange={setFleetId}>
                  <SelectTrigger><SelectValue placeholder="Vyberte vozidlo" /></SelectTrigger>
                  <SelectContent>
                    {fleetVehicles.map((v) => (
                      <SelectItem key={v.id} value={String(v.id)}>
                        {v.licensePlate} — {v.make} {v.model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="text-sm text-muted-foreground">
              Zapůjčeno od: <span className="font-medium text-foreground">{fmtDate(startDate)}</span>
            </div>

            {fleetId && (overlap.data?.length ?? 0) > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-amber-800 dark:text-amber-300">Možný překryv zápůjček</p>
                  <p className="text-amber-700 dark:text-amber-400">
                    Toto vozidlo má v daném období další aktivní zápůjčku. Můžete pokračovat.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-1 relative">
              <Label>Zákazník (jméno)</Label>
              <Input
                value={customerName}
                onChange={(e) => { setCustomerName(e.target.value); setCustomerTouched(true); setCustomerVehicleId(null); setSuggestOpen(true); }}
                onFocus={() => setSuggestOpen(true)}
                onBlur={() => setTimeout(() => setSuggestOpen(false), 150)}
                placeholder="Jméno zákazníka (lze upravit)"
              />
              {suggestOpen && suggestions.length > 0 && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md max-h-56 overflow-auto">
                  {suggestions.map((s) => (
                    <button
                      key={s.vehicleId}
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
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

            <div className="space-y-1">
              <Label>Telefon</Label>
              <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="Telefon zákazníka" />
            </div>

            <div className="space-y-1">
              <Label>Poznámka</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Zrušit</Button>
            <Button onClick={handleCreate} disabled={createLoaner.isPending || !fleetId}>Přidělit</Button>
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
              onClick={(e) => { e.preventDefault(); doCreate(); }}
            >
              Pokračovat i tak
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
