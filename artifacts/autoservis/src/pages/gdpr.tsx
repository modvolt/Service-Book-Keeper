import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGdprSearch,
  getGdprSearchQueryKey,
  useGetAuditLog,
  useGdprAnonymizeVehicle,
  useGdprDeleteVehicle,
  useSetVehicleConsent,
  useGetConsentHistory,
  useGetRetentionReport,
  getGetConsentHistoryQueryKey,
  gdprExportVehicle,
} from "@workspace/api-client-react";
import type {
  GdprVehicleMatch,
  SetConsentInputLegalBasis,
  ConsentHistoryEntry,
  RetentionCategory,
} from "@workspace/api-client-react";
import { actionLabel, formatDateTime } from "@/lib/audit-labels";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Shield, Download, UserX, Trash2, FileCheck, Search, FileText, Clock, History } from "lucide-react";

// Czech labels for the legal bases (GDPR Art. 6) and consent-history events.
const LEGAL_BASIS_LABELS: Record<string, string> = {
  contract: "Plnění smlouvy",
  legitimate_interest: "Oprávněný zájem",
  consent: "Souhlas",
};
const LEGAL_BASIS_OPTIONS: { value: SetConsentInputLegalBasis; label: string }[] = [
  { value: "consent", label: "Souhlas" },
  { value: "contract", label: "Plnění smlouvy" },
  { value: "legitimate_interest", label: "Oprávněný zájem" },
];
const CONSENT_EVENT_LABELS: Record<string, string> = {
  granted: "Udělen souhlas",
  withdrawn: "Odvolán souhlas",
  updated: "Změna právního základu",
  migrated: "Převzato z historie",
};

function legalBasisLabel(basis: string | null | undefined): string {
  return basis ? (LEGAL_BASIS_LABELS[basis] ?? basis) : "—";
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
  const [reportingId, setReportingId] = useState<number | null>(null);
  const [consentTarget, setConsentTarget] = useState<GdprVehicleMatch | null>(null);
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentBasis, setConsentBasis] = useState<SetConsentInputLegalBasis>("consent");
  const [consentNote, setConsentNote] = useState("");

  const consentHistory = useGetConsentHistory(consentTarget?.id ?? 0, {
    query: {
      enabled: consentTarget !== null,
      queryKey: getGetConsentHistoryQueryKey(consentTarget?.id ?? 0),
    },
  });

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

  // Human-readable (HTML) export — served by the server as a printable document.
  // Uses a plain authed fetch (not codegen) since it returns HTML, not JSON.
  const handleReport = async (vehicle: GdprVehicleMatch) => {
    setReportingId(vehicle.id);
    try {
      const res = await fetch(`/api/gdpr/export/${vehicle.id}/report`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("report failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gdpr-export-${vehicle.licensePlate}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Čitelný export vytvořen", description: `Dokument vozidla ${vehicle.licensePlate} byl stažen.` });
      invalidateGdpr();
    } catch {
      toast({ title: "Chyba", description: "Čitelný export se nepodařilo vytvořit.", variant: "destructive" });
    } finally {
      setReportingId(null);
    }
  };

  const openConsent = (vehicle: GdprVehicleMatch) => {
    setConsentTarget(vehicle);
    setConsentGiven(!!vehicle.consentGivenAt);
    setConsentBasis(vehicle.legalBasis ?? "consent");
    setConsentNote("");
  };

  const submitConsent = async () => {
    if (!consentTarget) return;
    try {
      await setConsent.mutateAsync({
        vehicleId: consentTarget.id,
        data: {
          given: consentGiven,
          legalBasis: consentGiven ? consentBasis : null,
          note: consentNote.trim() || null,
        },
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
                        <div className="space-y-1">
                          {v.consentGivenAt ? (
                            <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                              {formatDateTime(v.consentGivenAt)}
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">Není</Badge>
                          )}
                          {v.legalBasis && (
                            <div>
                              <Badge variant="outline" className="text-xs font-normal">
                                {legalBasisLabel(v.legalBasis)}
                              </Badge>
                            </div>
                          )}
                        </div>
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
                            title="Export dat (JSON)"
                          >
                            {exportingId === v.id ? <Spinner className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={reportingId === v.id}
                            onClick={() => handleReport(v)}
                            title="Čitelný export (HTML)"
                          >
                            {reportingId === v.id ? <Spinner className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
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

      <RetentionCard />

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
                      <TableCell>{actionLabel(entry.action)}</TableCell>
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
            {consentGiven && (
              <div className="space-y-2">
                <Label htmlFor="consent-basis">Právní základ zpracování</Label>
                <Select
                  value={consentBasis ?? "consent"}
                  onValueChange={(val) => setConsentBasis(val as SetConsentInputLegalBasis)}
                >
                  <SelectTrigger id="consent-basis">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEGAL_BASIS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value ?? "consent"}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <History className="h-4 w-4 text-muted-foreground" />
                Historie souhlasu
              </div>
              {consentHistory.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Spinner className="h-4 w-4" /> Načítání…
                </div>
              ) : (consentHistory.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">Žádné záznamy.</p>
              ) : (
                <ul className="max-h-48 overflow-y-auto rounded-md border divide-y text-sm">
                  {consentHistory.data?.map((h: ConsentHistoryEntry) => (
                    <li key={h.id} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{CONSENT_EVENT_LABELS[h.event] ?? h.event}</span>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDateTime(h.createdAt)}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {legalBasisLabel(h.basis)}
                        {h.note ? ` · ${h.note}` : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
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

const RETENTION_YEAR_OPTIONS = [1, 2, 3, 5, 10];

function RetentionCategoryTable({
  title,
  category,
}: {
  title: string;
  category: RetentionCategory;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{title}</h3>
        <Badge variant={category.count > 0 ? "secondary" : "outline"} className="text-muted-foreground">
          {category.count}
        </Badge>
      </div>
      {category.count === 0 ? (
        <p className="text-sm text-muted-foreground">Žádné záznamy nad limitem.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto max-h-64 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Položka</TableHead>
                <TableHead>SPZ</TableHead>
                <TableHead>Datum</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {category.items.map((item, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{item.label}</TableCell>
                  <TableCell>{item.licensePlate || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                    {item.date ? formatDateTime(item.date) : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{item.detail || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function RetentionCard() {
  const [years, setYears] = useState(3);
  const retention = useGetRetentionReport({ years });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Retenční politika
          </CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor="retention-years" className="text-sm text-muted-foreground whitespace-nowrap">
              Limit
            </Label>
            <Select value={String(years)} onValueChange={(v) => setYears(Number(v))}>
              <SelectTrigger id="retention-years" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RETENTION_YEAR_OPTIONS.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y} {y === 1 ? "rok" : y < 5 ? "roky" : "let"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Záznamy starší než zvolený limit, navržené k posouzení a případnému smazání. Nic se nemaže automaticky.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {retention.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" /> Načítání…
          </div>
        ) : !retention.data ? (
          <p className="text-sm text-muted-foreground">Data se nepodařilo načíst.</p>
        ) : (
          <>
            <RetentionCategoryTable title="Zakázky" category={retention.data.workOrders} />
            <RetentionCategoryTable title="Fotografie" category={retention.data.photos} />
            <RetentionCategoryTable title="Kontakty" category={retention.data.contacts} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
