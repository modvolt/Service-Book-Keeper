import { useEffect, useRef, useState } from "react";
import {
  useGetSettings, useUpdateSettings, getGetSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, Image as ImageIcon, Mail, Palette, Building2, Trash2, Sun, Moon, Check, Monitor, PenLine } from "lucide-react";
import { AresButton } from "@/components/ares-button";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/hooks/use-theme";
import { usePalette } from "@/hooks/use-palette";
import { cn } from "@/lib/utils";

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
  const logoInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const { theme, setTheme } = useTheme();
  const { palette, setPalette, palettes } = usePalette();

  const [form, setForm] = useState<Form>({
    companyName: "", companyAddress: "", companyPhone: "", companyEmail: "",
    companyIco: "", companyDic: "", signatureName: "", primaryColor: "",
    emailRemindersEnabled: false, reminderStkDays: "30", reminderServiceDays: "14",
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
      }});
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Nastavení uloženo" });
    } catch (e: any) {
      toast({ title: "Chyba", description: String(e?.message ?? e), variant: "destructive" });
    }
  }

  async function handleLogoUpload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("logo", file);
      const res = await fetch("/api/settings/logo", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Logo nahráno" });
    } catch {
      toast({ title: "Chyba při nahrávání loga", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function handleSignatureUpload(file: File) {
    setUploadingSignature(true);
    try {
      const fd = new FormData();
      fd.append("signature", file);
      const res = await fetch("/api/settings/signature", { method: "POST", body: fd });
      if (!res.ok) throw new Error("Upload failed");
      await queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      toast({ title: "Podpis nahrán" });
    } catch {
      toast({ title: "Chyba při nahrávání podpisu", variant: "destructive" });
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
                <img src={`/api${settings.logoUrl}`} alt="Logo" className="max-w-full max-h-full object-contain" />
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
                <img src={`/api${settings.signatureImageUrl}`} alt="Podpis" className="max-w-full max-h-full object-contain" />
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
          <CardDescription>Automatické e-maily zákazníkům před vypršením servisu a STK</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTitle>Připravujeme</AlertTitle>
            <AlertDescription>
              Odesílání e-mailů zatím není aktivní — jakmile připojíme e-mailovou službu, využijí se zde uložená nastavení a u zákazníků uložené adresy.
              Upozornění se bude týkat: vypršení STK, intervalu výměny motorového oleje a u automatických převodovek také oleje v převodovce.
            </AlertDescription>
          </Alert>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label htmlFor="reminders-enabled" className="text-base">Posílat upozornění zákazníkům</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Globální vypínač pro všechna automatická upozornění</p>
            </div>
            <Switch id="reminders-enabled" checked={form.emailRemindersEnabled}
              onCheckedChange={(v) => setForm({ ...form, emailRemindersEnabled: v })} />
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
