import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGdprSearch,
  getGdprSearchQueryKey,
  useGetAuditLog,
  useGdprAnonymizeVehicle,
  useGdprDeleteVehicle,
  useSetVehicleConsent,
  gdprExportVehicle,
} from "@workspace/api-client-react";
import type { GdprVehicleMatch } from "@workspace/api-client-react";
import type { AuditAction } from "@workspace/audit-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Shield, Download, UserX, Trash2, FileCheck, Search } from "lucide-react";

const ACTION_LABELS: Record<AuditAction, string> = {
  login: "Přihlášení",
  login_failed: "Neúspěšné přihlášení",
  logout: "Odhlášení",
  password_changed: "Změna hesla",
  password_reset_requested: "Žádost o obnovení hesla",
  password_reset: "Obnovení hesla",
  gdpr_export: "Export osobních údajů",
  gdpr_anonymize: "Anonymizace",
  gdpr_delete: "Trvalé smazání",
  gdpr_consent: "Změna souhlasu",
  vehicle_deleted: "Smazání vozidla",
  appointment_deleted: "Smazání termínu",
  work_order_deleted: "Smazání zakázky",
  scanner_password_changed: "Heslo skeneru nastaveno",
  scanner_password_deleted: "Účet skeneru deaktivován",
};

function formatDateTime(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString("cs-CZ");
}

export default function GdprPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  const search = useGdprSearch(
    { q: trimmed },
    { query: { enabled: trimmed.length >= 2, queryKey: getGdprSearchQueryKey({ q: trimmed }) } },
  );
  const auditLog = useGetAuditLog({ limit: 50 });

  const invalidateGdpr = () => {
    queryClient.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        typeof q.queryKey[0] === "string" &&
        (q.queryKey[0] as string).startsWith("/api/gdpr"),
    });
  };

  const anonymize = useGdprAnonymizeVehicle();
  const remove = useGdprDeleteVehicle();
  const setConsent = useSetVehicleConsent();

  const [exportingId, setExportingId] = useState<number | null>(null);
  const [consentTarget, setConsentTarget] = useState<GdprVehicleMatch | null>(null);
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentNote, setConsentNote] = useState("");

  const handleExport = async (vehicle: GdprVehicleMatch) => {
    setExportingId(vehicle.id);
    try {
      const data = await gdprExportVehicle(vehicle.id);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gdpr-export-${vehicle.licensePlate}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Export vytvořen", description: `Data vozidla ${vehicle.licensePlate} byla stažena.` });
      invalidateGdpr();
    } catch {
      toast({ title: "Chyba", description: "Export se nepodařilo vytvořit.", variant: "destructive" });
    } finally {
      setExportingId(null);
    }
  };

  const openConsent = (vehicle: GdprVehicleMatch) => {
    setConsentTarget(vehicle);
    setConsentGiven(!!vehicle.consentGivenAt);
    setConsentNote("");
  };

  const submitConsent = async () => {
    if (!consentTarget) return;
    try {
      await setConsent.mutateAsync({
        vehicleId: consentTarget.id,
        data: { given: consentGiven, note: consentNote.trim() || null },
      });
      toast({ title: "Souhlas uložen" });
      setConsentTarget(null);
      invalidateGdpr();
    } catch {
      toast({ title: "Chyba", description: "Souhlas se nepodařilo uložit.", variant: "destructive" });
    }
  };

  const handleAnonymize = async (vehicle: GdprVehicleMatch) => {
    try {
      await anonymize.mutateAsync({ vehicleId: vehicle.id });
      toast({ title: "Anonymizováno", description: `Osobní údaje vozidla ${vehicle.licensePlate} byly odstraněny.` });
      invalidateGdpr();
    } catch {
      toast({ title: "Chyba", description: "Anonymizace se nezdařila.", variant: "destructive" });
    }
  };

  const handleDelete = async (vehicle: GdprVehicleMatch) => {
    try {
      await remove.mutateAsync({ vehicleId: vehicle.id });
      toast({ title: "Smazáno", description: `Vozidlo ${vehicle.licensePlate} a všechna data byla smazána.` });
      invalidateGdpr();
    } catch {
      toast({ title: "Chyba", description: "Smazání se nezdařilo.", variant: "destructive" });
    }
  };

  const results = search.data?.vehicles ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Ochrana osobních údajů (GDPR)</h1>
          <p className="text-sm text-muted-foreground">
            Vyhledání, export, anonymizace a mazání osobních údajů na žádost subjektu údajů.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vyhledání osobních údajů</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Jméno, telefon, e-mail nebo SPZ"
              className="pl-9"
            />
          </div>

          {trimmed.length > 0 && trimmed.length < 2 && (
            <p className="text-sm text-muted-foreground">Zadejte alespoň 2 znaky.</p>
          )}

          {search.isLoading && trimmed.length >= 2 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Vyhledávání…
            </div>
          )}

          {trimmed.length >= 2 && !search.isLoading && results.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenalezeny žádné záznamy.</p>
          )}

          {results.length > 0 && (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SPZ</TableHead>
                    <TableHead>Vlastník</TableHead>
                    <TableHead>Kontakt</TableHead>
                    <TableHead>Souhlas</TableHead>
                    <TableHead className="text-center">Záznamy</TableHead>
                    <TableHead className="text-right">Akce</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-medium">{v.licensePlate}</TableCell>
                      <TableCell>
                        <div>{v.ownerName || <span className="text-muted-foreground">—</span>}</div>
                        <div className="text-xs text-muted-foreground">
                          {v.ownerType === "company" ? "Firma" : "Soukromá osoba"}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div>{v.ownerPhone || <span className="text-muted-foreground">—</span>}</div>
                        <div className="text-muted-foreground">{v.ownerEmail || ""}</div>
                      </TableCell>
                      <TableCell>
                        {v.consentGivenAt ? (
                          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            {formatDateTime(v.consentGivenAt)}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Není</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {v.serviceRecordCount + v.workOrderCount + v.appointmentCount + (v.loanerCount ?? 0)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={exportingId === v.id}
                            onClick={() => handleExport(v)}
                            title="Export dat"
                          >
                            {exportingId === v.id ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openConsent(v)}
                            title="Souhlas se zpracováním"
                          >
                            <FileCheck className="h-4 w-4" />
                          </Button>

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" title="Anonymizovat" className="text-amber-600 dark:text-amber-400">
                                <UserX className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Anonymizovat údaje vozidla {v.licensePlate}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Odstraní jméno, adresu, IČO/DIČ, telefon a e-mail vlastníka a kontaktní údaje z termínů.
                                  Technická servisní historie zůstane zachována. Akci nelze vrátit zpět.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleAnonymize(v)}>Anonymizovat</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>

                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="sm" title="Trvale smazat" className="text-rose-600 dark:text-rose-400">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Trvale smazat vozidlo {v.licensePlate}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Trvale odstraní vozidlo, servisní historii, zakázky, termíny i fotografie.
                                  Tuto akci nelze vrátit zpět.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-rose-600 hover:bg-rose-700"
                                  onClick={() => handleDelete(v)}
                                >Smazat</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Záznam o činnostech</CardTitle>
        </CardHeader>
        <CardContent>
          {auditLog.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Načítání…
            </div>
          ) : (auditLog.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Žádné záznamy.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48">Čas</TableHead>
                    <TableHead>Akce</TableHead>
                    <TableHead>Detail</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLog.data?.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatDateTime(entry.createdAt)}
                      </TableCell>
                      <TableCell>{ACTION_LABELS[entry.action as AuditAction] ?? entry.action}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{entry.detail || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={consentTarget !== null} onOpenChange={(open) => !open && setConsentTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Souhlas se zpracováním údajů</DialogTitle>
            <DialogDescription>
              {consentTarget ? `Vozidlo ${consentTarget.licensePlate}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="consent-given">Souhlas udělen</Label>
              <Switch id="consent-given" checked={consentGiven} onCheckedChange={setConsentGiven} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="consent-note">Poznámka / účel zpracování</Label>
              <Textarea
                id="consent-note"
                value={consentNote}
                onChange={(e) => setConsentNote(e.target.value)}
                placeholder="Např. servis vozidla, fakturace"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsentTarget(null)}>Zrušit</Button>
            <Button onClick={submitConsent} disabled={setConsent.isPending}>
              {setConsent.isPending ? "Ukládání…" : "Uložit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
