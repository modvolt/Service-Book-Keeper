import { useEffect, useRef, useState } from "react";
import {
  useGetSettings, useUpdateSettings, useSendTestReminder, getGetSettingsQueryKey,
  useGetBackups, useRunBackup, getGetBackupsQueryKey,
  useSetScannerPassword, useDeleteScannerPassword,
  useGetAuthStatus, getGetAuthStatusQueryKey,
  useGetStorageIntegrity, useCleanupStorageOrphans, getGetStorageIntegrityQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, Image as ImageIcon, Mail, Palette, Building2, Trash2, Sun, Moon, Check, Monitor, PenLine, Database, Download, Loader2, FileText, CloudUpload, ShieldCheck, FileArchive, AlertTriangle, RefreshCw, HardDrive } from "lucide-react";
import { AresButton } from "@/components/ares-button";
import { openDataBackupPdf } from "@/lib/data-backup-pdf";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import { usePalette } from "@/hooks/use-palette";
import { cn } from "@/lib/utils";
import { uploadFileWithProgress, UploadError } from "@/lib/upload";

type Form = {
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyIco: string;
  companyDic: string;
  signatureName: string;
  primaryColor: string;
  emailRemindersEnabled: boolean;
  reminderStkDays: string;
  reminderServiceDays: string;
  notificationEmail: string;
  backupsEnabled: boolean;
};

const COLOR_PRESETS = [
  { label: "Modrá", value: "#2563eb" },
  { label: "Červená", value: "#dc2626" },
  { label: "Zelená", value: "#16a34a" },
  { label: "Oranžová", value: "#ea580c" },
  { label: "Fialová", value: "#7c3aed" },
  { label: "Tmavá", value: "#0f172a" },
];

export default function SettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useGetSettings();
  const updateSettings = useUpdateSettings();
  const sendTestReminder = useSendTestReminder();
  const { data: backups } = useGetBackups();
  const runBackup = useRunBackup();
  const {
    data: integrity,
    isFetching: integrityFetching,
    refetch: refetchIntegrity,
  } = useGetStorageIntegrity({ query: { enabled: false } as any });
  const cleanupOrphans = useCleanupStorageOrphans();
  const [integrityChecked, setIntegrityChecked] = useState(false);
  const { data: authStatus } = useGetAuthStatus({
    query: { queryKey: getGetAuthStatusQueryKey(), staleTime: 30_000 } as any,
  });
  const setScannerPassword = useSetScannerPassword();
  const deleteScannerPassword = useDeleteScannerPassword();
  const [scannerPw, setScannerPw] = useState("");
  const [scannerPwConfirm, setScannerPwConfirm] = useState("");
  const [downloadingBackupId, setDownloadingBackupId] = useState<number | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingFull, setExportingFull] = useState(false);
  const [importing, setImporting] = useState(false);
  const [missingFiles, setMissingFiles] = useState<Array<{ filename: string | null; url: string }> | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const fullBackupInputRef = useRef<HTMLInputElement>(null);
  const { theme, setTheme } = useTheme();
  const { palette, setPalette, palettes } = usePalette();

  const [form, setForm] = useState<Form>({
    companyName: "", companyAddress: "", companyPhone: "", companyEmail: "",
    companyIco: "", companyDic: "", signatureName: "", primaryColor: "",
    emailRemindersEnabled: false, reminderStkDays: "30", reminderServiceDays: "14",
    notificationEmail: "", backupsEnabled: false,
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      companyName: settings.companyName ?? "",
      companyAddress: settings.companyAddress ?? "",
      companyPhone: settings.companyPhone ?? "",
      companyEmail: settings.companyEmail ?? "",
      companyIco: settings.companyIco ?? "",
      companyDic: settings.companyDic ?? "",
      signatureName: settings.signatureName ?? "",
      primaryColor: settings.primaryColor ?? "",
      emailRemindersEnabled: settings.emailRemindersEnabled,
      reminderStkDays: String(settings.reminderStkDays),
      reminderServiceDays: String(settings.reminderServiceDays),
      notificationEmail: settings.notificationEmail ?? "",
      backupsEnabled: settings.backupsEnabled ?? false,
    });
  }, [settings]);

  async function handleSave() {
    try {
      await updateSettings.mutateAsync({ data: {
        companyName: form.companyName.trim() || null,
        companyAddress: form.companyAddress.trim() || null,
        companyPhone: form.companyPhone.trim() || null,
        companyEmail: form.companyEmail.trim() || null,
        companyIco: form.companyIco.trim() || null,
        companyDic: form.companyDic.trim() || null,
        signatureName: form.signatureName.trim() || null,
        primaryColor: form.primaryColor.trim() || null,
        emailRemindersEnabled: form.emailRemindersEnabled,
        reminderStkDays: parseInt(form.reminderStkDays, 10) || 30,
        reminderServiceDays: parseInt(form.reminderServiceDays, 10) || 14,
        notificationEmail: form.notificationEmail.trim() || null,
        backupsEnabled: form.backupsEnabled,
      }});
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Nastavení uloženo" });
    } catch (e: any) {
      toast({ title: "Chyba", description: String(e?.message ?? e), variant: "destructive" });
    }
  }

  async function handleSendTest() {
    try {
      const result = await sendTestReminder.mutateAsync();
      if (result.sent) {
        toast({ title: "Souhrn odeslán", description: result.message });
      } else {
        toast({ title: "E-mail neodeslán", description: result.message, variant: "destructive" });
      }
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
    } catch (e: any) {
      const description =
        e?.data && typeof e.data === "object" && "error" in e.data
          ? String((e.data as { error: unknown }).error)
          : "Odeslání souhrnu selhalo.";
      toast({ title: "Chyba", description, variant: "destructive" });
    }
  }

  async function handleRunBackup() {
    try {
      const result = await runBackup.mutateAsync();
      toast({ title: "Záloha vytvořena", description: result.message });
      await queryClient.invalidateQueries({ queryKey: getGetBackupsQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
    } catch (e: any) {
      const description =
        e?.data && typeof e.data === "object" && "error" in e.data
          ? String((e.data as { error: unknown }).error)
          : "Vytvoření zálohy selhalo.";
      toast({ title: "Chyba", description, variant: "destructive" });
    }
  }

  async function handleDownloadBackup(id: number, filename: string) {
    setDownloadingBackupId(id);
    try {
      const res = await fetch(`/api/backups/${id}/download`);
      if (!res.ok) throw new Error("Stažení zálohy selhalo");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.replace(/\.gz$/, "");
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Chyba", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setDownloadingBackupId(null);
    }
  }

  function formatBackupSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleLogoUpload(file: File) {
    setUploading(true);
    try {
      await uploadFileWithProgress({ url: "/api/settings/logo", field: "logo", file });
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Logo nahráno" });
    } catch (err) {
      const description = err instanceof UploadError ? err.message : "Logo se nepodařilo nahrát.";
      toast({ title: "Chyba při nahrávání loga", description, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleSignatureUpload(file: File) {
    setUploadingSignature(true);
    try {
      await uploadFileWithProgress({ url: "/api/settings/signature", field: "signature", file });
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Podpis nahrán" });
    } catch (err) {
      const description = err instanceof UploadError ? err.message : "Podpis se nepodařilo nahrát.";
      toast({ title: "Chyba při nahrávání podpisu", description, variant: "destructive" });
    } finally {
      setUploadingSignature(false);
    }
  }

  async function handleSignatureRemove() {
    if (!confirm("Odstranit obrázek podpisu?")) return;
    try {
      await updateSettings.mutateAsync({ data: { signatureImageUrl: null } });
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Podpis odstraněn" });
    } catch (e: any) {
      toast({ title: "Chyba", description: String(e?.message ?? e), variant: "destructive" });
    }
  }

  async function handleLogoRemove() {
    if (!confirm("Odstranit logo?")) return;
    try {
      await updateSettings.mutateAsync({ data: { logoUrl: null } });
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Logo odstraněno" });
    } catch (e: any) {
      toast({ title: "Chyba", description: String(e?.message ?? e), variant: "destructive" });
    }
  }

  async function handleExportBackup() {
    setExporting(true);
    try {
      const res = await fetch("/api/backup/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `autoservis-zaloha-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast({ title: "Záloha vytvořena", description: "Soubor byl stažen do vašeho zařízení." });
    } catch {
      toast({ title: "Chyba", description: "Zálohu se nepodařilo vytvořit.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  }

  function reportRestoreResult(missing: Array<{ filename: string | null; url: string }>, restoredFiles?: number) {
    setMissingFiles(missing);
    if (missing.length > 0) {
      toast({
        title: "Data obnovena – chybí soubory",
        description: `Záznamy byly obnoveny, ale ${missing.length} fotografií chybí v úložišti.`,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Data obnovena",
        description:
          restoredFiles != null
            ? `Záloha byla načtena. Obnoveno souborů: ${restoredFiles}.`
            : "Záloha byla úspěšně načtena.",
      });
    }
  }

  async function handleImportBackup(file: File) {
    const isZip = file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip";
    const ok = confirm(
      "Obnova ze zálohy SLOUČÍ data ze souboru se současnými: chybějící doplní a existující záznamy (podle ID) přepíše hodnotami ze zálohy. Nic se nemaže. Přepsané hodnoty u existujících záznamů nelze vrátit zpět. Pokračovat?",
    );
    if (!ok) return;
    setImporting(true);
    setMissingFiles(null);
    try {
      if (isZip) {
        const fd = new FormData();
        fd.append("backup", file);
        const res = await fetch("/api/backup/import-full", { method: "POST", body: fd });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? "Obnova selhala.");
        }
        const body = await res.json();
        await queryClient.invalidateQueries();
        reportRestoreResult(body?.missingFiles ?? [], body?.restoredFiles);
        return;
      }

      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new Error("Soubor není platná záloha (neplatný JSON).");
      }
      const res = await fetch("/api/backup/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Obnova selhala.");
      }
      const body = await res.json();
      await queryClient.invalidateQueries();
      reportRestoreResult(body?.missingFiles ?? []);
    } catch (e: any) {
      toast({ title: "Chyba", description: String(e?.message ?? e), variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  async function handleExportFullBackup() {
    setExportingFull(true);
    try {
      const res = await fetch("/api/backup/full");
      if (!res.ok) throw new Error("Export failed");
      const missingCount = Number(res.headers.get("X-Missing-Objects") ?? "0");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `autoservis-uplna-zaloha-${stamp}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast({
        title: "Úplná záloha vytvořena",
        description:
          missingCount > 0
            ? `Soubor byl stažen. Pozor: ${missingCount} fotografií chybělo v úložišti a není v záloze.`
            : "Soubor (data i fotografie) byl stažen do vašeho zařízení.",
        variant: missingCount > 0 ? "destructive" : undefined,
      });
    } catch {
      toast({ title: "Chyba", description: "Úplnou zálohu se nepodařilo vytvořit.", variant: "destructive" });
    } finally {
      setExportingFull(false);
    }
  }

  async function handleCheckIntegrity() {
    setIntegrityChecked(true);
    try {
      await refetchIntegrity();
    } catch {
      toast({ title: "Chyba", description: "Kontrola souborů selhala.", variant: "destructive" });
    }
  }

  async function handleCleanupOrphans() {
    if (!integrity?.orphanObjects?.length) return;
    const ok = confirm(
      `Trvale smazat ${integrity.orphanObjects.length} osamocených souborů z úložiště? Tato akce je nevratná.`,
    );
    if (!ok) return;
    try {
      const result = await cleanupOrphans.mutateAsync({ data: { paths: integrity.orphanObjects } });
      toast({
        title: "Hotovo",
        description: `Smazáno souborů: ${result.deleted.length}. Přeskočeno: ${result.refused.length + result.failed.length}.`,
      });
      await queryClient.invalidateQueries({ queryKey: getGetStorageIntegrityQueryKey() });
      await refetchIntegrity();
    } catch {
      toast({ title: "Chyba", description: "Vyčištění souborů selhalo.", variant: "destructive" });
    }
  }

  async function handleSetScannerPassword() {
    if (scannerPw.length < 8) {
      toast({ title: "Chyba", description: "Heslo musí mít alespoň 8 znaků.", variant: "destructive" });
      return;
    }
    if (scannerPw !== scannerPwConfirm) {
      toast({ title: "Chyba", description: "Hesla se neshodují.", variant: "destructive" });
      return;
    }
    try {
      await setScannerPassword.mutateAsync({ data: { newPassword: scannerPw } });
      setScannerPw("");
      setScannerPwConfirm("");
      await queryClient.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() });
      toast({ title: "Heslo skeneru nastaveno" });
    } catch (e: any) {
      const description =
        e?.data && typeof e.data === "object" && "error" in e.data
          ? String((e.data as { error: unknown }).error)
          : "Nastavení hesla skeneru selhalo.";
      toast({ title: "Chyba", description, variant: "destructive" });
    }
  }

  async function handleDisableScanner() {
    if (!confirm("Opravdu chcete deaktivovat účet skeneru? Přihlášení skeneru přestane fungovat.")) return;
    try {
      await deleteScannerPassword.mutateAsync();
      await queryClient.invalidateQueries({ queryKey: getGetAuthStatusQueryKey() });
      toast({ title: "Účet skeneru deaktivován" });
    } catch (e: any) {
      const description =
        e?.data && typeof e.data === "object" && "error" in e.data
          ? String((e.data as { error: unknown }).error)
          : "Deaktivace skeneru selhala.";
      toast({ title: "Chyba", description, variant: "destructive" });
    }
  }

  async function handleExportPdf() {
    setPdfBusy(true);
    try {
      const ok = await openDataBackupPdf();
      if (!ok) {
        toast({
          title: "Vyskakovací okno blokováno",
          description: "Povolte vyskakovací okna pro tuto stránku a zkuste to znovu.",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Chyba", description: "PDF přehled se nepodařilo vytvořit.", variant: "destructive" });
    } finally {
      setPdfBusy(false);
    }
  }

  if (isLoading) return <div className="p-8 text-muted-foreground">Načítání…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">Nastavení</h1>
        <p className="text-muted-foreground">Údaje firmy, vzhled aplikace a upozornění zákazníkům</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> Firma</CardTitle>
          <CardDescription>Údaje, které se použijí v hlavičkách a budoucích zákaznických e-mailech</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="company-name">Název firmy</Label>
              <Input id="company-name" value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="company-email">E-mail</Label>
              <Input id="company-email" type="email" value={form.companyEmail}
                onChange={(e) => setForm({ ...form, companyEmail: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="company-phone">Telefon</Label>
              <Input id="company-phone" value={form.companyPhone}
                onChange={(e) => setForm({ ...form, companyPhone: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="company-address">Adresa</Label>
              <Input id="company-address" value={form.companyAddress}
                onChange={(e) => setForm({ ...form, companyAddress: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="company-ico">IČO</Label>
              <div className="flex gap-2">
                <Input id="company-ico" value={form.companyIco}
                  onChange={(e) => setForm({ ...form, companyIco: e.target.value })} />
                <AresButton ico={form.companyIco} onLoaded={(d) => setForm(f => ({
                  ...f,
                  companyName: d.name || f.companyName,
                  companyAddress: d.address || f.companyAddress,
                  companyDic: d.dic || f.companyDic,
                }))} />
              </div>
            </div>
            <div>
              <Label htmlFor="company-dic">DIČ</Label>
              <Input id="company-dic" value={form.companyDic}
                onChange={(e) => setForm({ ...form, companyDic: e.target.value })} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ImageIcon className="h-5 w-5" /> Logo</CardTitle>
          <CardDescription>Zobrazí se v levém panelu a v budoucnu na fakturách a e-mailech</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 border rounded-md bg-muted/40 flex items-center justify-center overflow-hidden">
              {settings?.logoUrl ? (
                <img src={`/api/storage${settings.logoUrl}`} alt="Logo" className="max-w-full max-h-full object-contain" />
              ) : (
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2">
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = ""; }} />
              <Button onClick={() => logoInputRef.current?.click()} disabled={uploading}>
                <Upload className="h-4 w-4 mr-2" /> {uploading ? "Nahrávám…" : "Nahrát logo"}
              </Button>
              {settings?.logoUrl && (
                <Button variant="outline" onClick={handleLogoRemove}>
                  <Trash2 className="h-4 w-4 mr-2" /> Odstranit
                </Button>
              )}
              <p className="text-xs text-muted-foreground">PNG, JPG nebo SVG, max 5 MB</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PenLine className="h-5 w-5" /> Podpis mechanika</CardTitle>
          <CardDescription>Použije se všude, kde se podepisuje servis — na zakázkových listech a v servisní historii</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="signature-name">Jméno a příjmení (bude vytištěno pod podpisem)</Label>
            <Input id="signature-name" value={form.signatureName}
              placeholder="např. Jan Novák"
              onChange={(e) => setForm({ ...form, signatureName: e.target.value })} />
          </div>
          <div className="flex items-center gap-4">
            <div className="w-40 h-20 border rounded-md bg-muted/40 flex items-center justify-center overflow-hidden">
              {settings?.signatureImageUrl ? (
                <img src={`/api/storage${settings.signatureImageUrl}`} alt="Podpis" className="max-w-full max-h-full object-contain" />
              ) : (
                <PenLine className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="space-y-2">
              <input ref={signatureInputRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleSignatureUpload(f); e.target.value = ""; }} />
              <Button onClick={() => signatureInputRef.current?.click()} disabled={uploadingSignature}>
                <Upload className="h-4 w-4 mr-2" /> {uploadingSignature ? "Nahrávám…" : "Nahrát podpis"}
              </Button>
              {settings?.signatureImageUrl && (
                <Button variant="outline" onClick={handleSignatureRemove}>
                  <Trash2 className="h-4 w-4 mr-2" /> Odstranit
                </Button>
              )}
              <p className="text-xs text-muted-foreground">Naskenovaný nebo vyfocený podpis (PNG s průhledným pozadím vypadá nejlépe)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Monitor className="h-5 w-5" /> Motiv aplikace</CardTitle>
          <CardDescription>Tmavý režim a barva pozadí (uloženo lokálně v tomto prohlížeči)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <Label className="text-sm">Režim</Label>
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={() => setTheme("light")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-md border text-sm transition-colors",
                  theme === "light" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent",
                )}>
                <Sun className="h-4 w-4" /> Světlý
              </button>
              <button type="button" onClick={() => setTheme("dark")}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-md border text-sm transition-colors",
                  theme === "dark" ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-accent",
                )}>
                <Moon className="h-4 w-4" /> Tmavý
              </button>
            </div>
          </div>

          <div>
            <Label className="text-sm">Barva pozadí</Label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-2">
              {palettes.map((p) => (
                <button key={p.id} type="button" onClick={() => setPalette(p.id)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-md border p-3 transition-colors hover:bg-accent",
                    palette === p.id && "border-primary bg-primary/5 ring-1 ring-primary",
                  )}>
                  <span className="relative w-10 h-10 rounded-full border shadow-inner" style={{ background: p.swatch }}>
                    {palette === p.id && <Check className="absolute inset-0 m-auto h-5 w-5 text-foreground/80" />}
                  </span>
                  <span className="text-xs">{p.label}</span>
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5" /> Hlavní barva</CardTitle>
          <CardDescription>Barva tlačítek, odkazů a zvýraznění (sdílená pro všechny uživatele)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <input type="color" value={form.primaryColor || "#2563eb"}
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
              className="w-14 h-10 rounded border cursor-pointer" />
            <Input value={form.primaryColor} placeholder="#2563eb"
              onChange={(e) => setForm({ ...form, primaryColor: e.target.value })}
              className="w-32 font-mono" />
            {form.primaryColor && (
              <Button variant="ghost" size="sm" onClick={() => setForm({ ...form, primaryColor: "" })}>Výchozí</Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {COLOR_PRESETS.map(p => (
              <button key={p.value} type="button"
                onClick={() => setForm({ ...form, primaryColor: p.value })}
                className="flex items-center gap-2 px-3 py-1.5 rounded-md border hover:bg-accent text-sm">
                <span className="w-4 h-4 rounded-full border" style={{ background: p.value }} />
                {p.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" /> Upozornění e-mailem</CardTitle>
          <CardDescription>Denní souhrn vozidel s blížící se STK a servisy odeslaný na váš e-mail</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTitle>Jak to funguje</AlertTitle>
            <AlertDescription>
              Jednou denně se sestaví souhrn vozidel po termínu nebo s blížící se STK, výměnou oleje, brzdami, rozvody a u automatů i olejem převodovky a odešle se na níže uvedenou adresu.
              Odesílání vyžaduje nastavený SMTP server (proměnné SMTP_HOST, SMTP_USER, SMTP_PASS) — zajistí jej správce při nasazení.
            </AlertDescription>
          </Alert>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="reminders-enabled" className="text-base">Posílat denní souhrn</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Hlavní vypínač automatického odesílání souhrnu</p>
            </div>
            <Switch id="reminders-enabled" checked={form.emailRemindersEnabled}
              onCheckedChange={(v) => setForm({ ...form, emailRemindersEnabled: v })} />
          </div>

          <div>
            <Label htmlFor="notification-email">E-mail pro upozornění</Label>
            <Input id="notification-email" type="email"
              placeholder={form.companyEmail ? `Výchozí: ${form.companyEmail}` : "vas@email.cz"}
              value={form.notificationEmail}
              onChange={(e) => setForm({ ...form, notificationEmail: e.target.value })} />
            <p className="text-xs text-muted-foreground mt-1">
              Nevyplníte-li, použije se e-mail firmy. Tato adresa se používá i pro obnovu hesla.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="reminder-stk">Upozornit na STK (dní předem)</Label>
              <Input id="reminder-stk" type="number" min="1" max="365"
                value={form.reminderStkDays}
                onChange={(e) => setForm({ ...form, reminderStkDays: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="reminder-service">Upozornit na servis (dní předem)</Label>
              <Input id="reminder-service" type="number" min="1" max="365"
                value={form.reminderServiceDays}
                onChange={(e) => setForm({ ...form, reminderServiceDays: e.target.value })} />
            </div>
          </div>

          <div className="rounded-md border p-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-medium text-sm">Odeslat souhrn nyní</div>
              <p className="text-xs text-muted-foreground mt-0.5">Otestujte odesílání — pošle aktuální souhrn na nastavenou adresu. Nejprve uložte změny.</p>
            </div>
            <Button variant="outline" onClick={handleSendTest} disabled={sendTestReminder.isPending}>
              {sendTestReminder.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Odesílám…</>
                : <><Mail className="h-4 w-4 mr-2" /> Odeslat zkušební souhrn</>}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CloudUpload className="h-5 w-5" /> Automatické zálohy na server (S3)</CardTitle>
          <CardDescription>Jednou denně se vytvoří záloha všech dat a nahraje se do úložiště (S3 v produkci)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTitle>Jak to funguje</AlertTitle>
            <AlertDescription>
              Při zapnutí se každý den automaticky vytvoří komprimovaná záloha (vozidla, zakázky, servisní historie, materiály, nastavení) a nahraje se do úložiště aplikace. Uchovává se posledních několik záloh, starší se automaticky mažou. Zálohu lze kdykoli stáhnout a obnovit přes „Obnovit ze zálohy".
            </AlertDescription>
          </Alert>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="backups-enabled" className="text-base">Zapnout automatické zálohy</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Denní záloha do úložiště. Nezapomeňte uložit nastavení.</p>
            </div>
            <Switch id="backups-enabled" checked={form.backupsEnabled}
              onCheckedChange={(v) => setForm({ ...form, backupsEnabled: v })} />
          </div>

          <div className="rounded-md border p-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-medium text-sm">Spustit zálohu nyní</div>
              <p className="text-xs text-muted-foreground mt-0.5">Vytvoří zálohu okamžitě a nahraje ji do úložiště.</p>
            </div>
            <Button variant="outline" onClick={handleRunBackup} disabled={runBackup.isPending}>
              {runBackup.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Zálohuji…</>
                : <><CloudUpload className="h-4 w-4 mr-2" /> Spustit zálohu nyní</>}
            </Button>
          </div>

          <div>
            <div className="font-medium text-sm mb-2">Poslední zálohy</div>
            {!backups || backups.length === 0 ? (
              <p className="text-sm text-muted-foreground">Zatím nebyla vytvořena žádná záloha.</p>
            ) : (
              <div className="rounded-md border divide-y">
                {backups.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 p-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">
                        {new Date(b.createdAt).toLocaleString("cs-CZ")}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {b.filename} · {formatBackupSize(b.sizeBytes)}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => handleDownloadBackup(b.id, b.filename)}
                      disabled={downloadingBackupId === b.id}>
                      {downloadingBackupId === b.id
                        ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Stahuji…</>
                        : <><Download className="h-4 w-4 mr-2" /> Stáhnout</>}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" /> Účet skeneru</CardTitle>
          <CardDescription>
            Samostatné přihlášení pro pracovníka na skenovací stanici. Skener vidí pouze Načtení vozu — nemá přístup k zakázkám, vozidlům ani nastavení.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
              authStatus?.scannerEnabled
                ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                : "bg-muted text-muted-foreground",
            )}>
              {authStatus?.scannerEnabled ? "Aktivní" : "Neaktivní"}
            </span>
            <span className="text-sm text-muted-foreground">
              {authStatus?.scannerEnabled
                ? "Skener se může přihlásit vlastním heslem."
                : "Skener nemá nastavené heslo — přihlásí se stejně jako administrátor."}
            </span>
          </div>

          <div className="rounded-md border p-4 space-y-3">
            <div className="font-medium text-sm">
              {authStatus?.scannerEnabled ? "Změnit heslo skeneru" : "Nastavit heslo skeneru"}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="scanner-pw">Nové heslo (min. 8 znaků)</Label>
                <Input
                  id="scanner-pw"
                  type="password"
                  value={scannerPw}
                  autoComplete="new-password"
                  onChange={(e) => setScannerPw(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="scanner-pw-confirm">Zopakovat heslo</Label>
                <Input
                  id="scanner-pw-confirm"
                  type="password"
                  value={scannerPwConfirm}
                  autoComplete="new-password"
                  onChange={(e) => setScannerPwConfirm(e.target.value)}
                />
              </div>
            </div>
            <Button
              onClick={handleSetScannerPassword}
              disabled={setScannerPassword.isPending || !scannerPw}
            >
              {setScannerPassword.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Ukládám…</>
                : authStatus?.scannerEnabled ? "Změnit heslo" : "Nastavit heslo"}
            </Button>
          </div>

          {authStatus?.scannerEnabled && (
            <div className="rounded-md border border-destructive/30 p-4 space-y-2">
              <div className="font-medium text-sm">Deaktivovat účet skeneru</div>
              <p className="text-sm text-muted-foreground">
                Odstraní heslo skeneru. Pracovník na skenovací stanici se nebude moci přihlásit, dokud heslo znovu nenastavíte.
              </p>
              <Button
                variant="outline"
                className="text-destructive border-destructive/50 hover:bg-destructive/10"
                onClick={handleDisableScanner}
                disabled={deleteScannerPassword.isPending}
              >
                {deleteScannerPassword.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Deaktivuji…</>
                  : <><Trash2 className="h-4 w-4 mr-2" /> Deaktivovat skener</>}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5" /> Zálohování dat</CardTitle>
          <CardDescription>Stáhněte si zálohu všech dat nebo obnovte data ze zálohy</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border p-4 space-y-3">
            <div className="font-medium">Export zálohy</div>
            <p className="text-sm text-muted-foreground">
              Stáhne soubor se všemi vozidly, zakázkami, servisní historií, materiály a nastavením. Soubor si uložte na bezpečné místo.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleExportBackup} disabled={exporting}>
                {exporting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Vytvářím…</> : <><Download className="h-4 w-4 mr-2" /> Stáhnout zálohu (jen data)</>}
              </Button>
              <Button variant="outline" onClick={handleExportFullBackup} disabled={exportingFull}>
                {exportingFull ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Vytvářím…</> : <><FileArchive className="h-4 w-4 mr-2" /> Stáhnout úplnou zálohu (data + fotky)</>}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Záloha „jen data" (JSON) obsahuje záznamy a odkazy na fotografie, ale ne samotné soubory fotografií. Úplná záloha (ZIP) obsahuje i soubory fotografií z úložiště.
            </p>
          </div>

          <div className="rounded-md border p-4 space-y-2">
            <div className="font-medium">Obnova ze zálohy</div>
            <p className="text-sm text-muted-foreground">
              Načte data ze záložního souboru (JSON nebo úplný ZIP) a sloučí je se současnými: chybějící záznamy doplní a existující (podle ID) aktualizuje hodnotami ze zálohy. U úplné zálohy (ZIP) se obnoví i soubory fotografií. Záznamy, které v záloze nejsou, zůstanou zachovány — nic se nemaže.
            </p>
            <input ref={backupInputRef} type="file" accept="application/json,.json,application/zip,.zip" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportBackup(f); e.target.value = ""; }} />
            <Button variant="outline" onClick={() => backupInputRef.current?.click()} disabled={importing}>
              {importing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Obnovuji…</> : <><Upload className="h-4 w-4 mr-2" /> Obnovit ze zálohy (JSON / ZIP)</>}
            </Button>
            {missingFiles && missingFiles.length > 0 && (
              <Alert variant="destructive" className="mt-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Po obnově chybí soubory fotografií</AlertTitle>
                <AlertDescription>
                  <p className="mb-1">
                    Záznamy byly obnoveny, ale {missingFiles.length} fotografií není v úložišti. Pokud máte úplnou zálohu (ZIP), obnovte ji pro doplnění souborů.
                  </p>
                  <ul className="list-disc pl-5 text-xs">
                    {missingFiles.slice(0, 10).map((f) => (
                      <li key={f.url}>{f.filename || f.url}</li>
                    ))}
                    {missingFiles.length > 10 && <li>… a dalších {missingFiles.length - 10}</li>}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {missingFiles && missingFiles.length === 0 && (
              <Alert className="mt-2">
                <Check className="h-4 w-4" />
                <AlertTitle>Obnova dokončena</AlertTitle>
                <AlertDescription>Všechny fotografie jsou v úložišti.</AlertDescription>
              </Alert>
            )}
          </div>
          <div className="rounded-md border p-4 space-y-2">
            <div className="font-medium">Čitelný přehled (PDF)</div>
            <p className="text-sm text-muted-foreground">
              Vytvoří přehledný dokument se všemi vozidly, zakázkami, servisní historií a skladem k vytištění nebo uložení jako PDF. Slouží jako záložní výpis pro případ, že by aplikace přestala fungovat.
            </p>
            <Button variant="outline" onClick={handleExportPdf} disabled={pdfBusy}>
              {pdfBusy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Připravuji…</> : <><FileText className="h-4 w-4 mr-2" /> Vytvořit PDF přehled</>}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Poznámka: PDF přehled je určen jen ke čtení a tisku. Pro úplné obnovení dat zpět do aplikace použijte zálohu ve formátu JSON. Záloha obsahuje záznamy a odkazy na fotografie; samotné soubory fotografií zůstávají v úložišti aplikace.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><HardDrive className="h-5 w-5" /> Kontrola souborů</CardTitle>
          <CardDescription>Ověří, zda ke všem fotografiím existují soubory v úložišti a najde osamocené soubory bez záznamu</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" onClick={handleCheckIntegrity} disabled={integrityFetching}>
            {integrityFetching ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Kontroluji…</> : <><RefreshCw className="h-4 w-4 mr-2" /> Spustit kontrolu</>}
          </Button>

          {integrityChecked && !integrityFetching && integrity && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Zkontrolováno fotografií: {integrity.checkedPhotos}.
              </p>

              {integrity.missingObjects.length > 0 ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Chybějící soubory ({integrity.missingObjects.length})</AlertTitle>
                  <AlertDescription>
                    <p className="mb-1">U těchto fotografií existuje záznam, ale soubor v úložišti chybí:</p>
                    <ul className="list-disc pl-5 text-xs">
                      {integrity.missingObjects.slice(0, 10).map((m) => (
                        <li key={m.photoId}>
                          {(m.filename || m.url)}{m.deleted ? " (v koši)" : ""}
                        </li>
                      ))}
                      {integrity.missingObjects.length > 10 && <li>… a dalších {integrity.missingObjects.length - 10}</li>}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <Check className="h-4 w-4" />
                  <AlertTitle>Žádné chybějící soubory</AlertTitle>
                  <AlertDescription>Ke všem fotografiím existuje soubor v úložišti.</AlertDescription>
                </Alert>
              )}

              {!integrity.orphanScanSupported ? (
                <Alert>
                  <HardDrive className="h-4 w-4" />
                  <AlertTitle>Vyhledání osamocených souborů není dostupné</AlertTitle>
                  <AlertDescription>Aktuální úložiště nepodporuje výpis souborů, proto nelze najít soubory bez záznamu.</AlertDescription>
                </Alert>
              ) : integrity.orphanObjects.length > 0 ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Osamocené soubory ({integrity.orphanObjects.length})</AlertTitle>
                  <AlertDescription>
                    <p className="mb-2">Tyto soubory jsou v úložišti, ale neodkazuje na ně žádný záznam:</p>
                    <ul className="list-disc pl-5 text-xs mb-3">
                      {integrity.orphanObjects.slice(0, 10).map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                      {integrity.orphanObjects.length > 10 && <li>… a dalších {integrity.orphanObjects.length - 10}</li>}
                    </ul>
                    <Button variant="destructive" size="sm" onClick={handleCleanupOrphans} disabled={cleanupOrphans.isPending}>
                      {cleanupOrphans.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Mažu…</> : <><Trash2 className="h-4 w-4 mr-2" /> Smazat osamocené soubory</>}
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <Check className="h-4 w-4" />
                  <AlertTitle>Žádné osamocené soubory</AlertTitle>
                  <AlertDescription>V úložišti nejsou žádné soubory bez záznamu.</AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2 sticky bottom-4 bg-background/80 backdrop-blur p-3 rounded-md border">
        <Button onClick={handleSave} disabled={updateSettings.isPending}>
          {updateSettings.isPending ? "Ukládám…" : "Uložit nastavení"}
        </Button>
      </div>
    </div>
  );
}
