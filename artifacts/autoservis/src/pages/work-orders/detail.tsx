import { useState, useRef, useMemo } from "react";
import { useRoute, Link } from "wouter";
import { LicensePlate } from "@/components/license-plate";
import {
  useGetWorkOrder, useUpdateWorkOrder, useListWorkOrderPhotos, useDeletePhoto, useDeleteWorkOrder,
  useListWorkOrderMaterials, useAddWorkOrderMaterial, useDeleteWorkOrderMaterial,
  useListMaterials, useImportInvoiceForWorkOrder, useGetVehicleByPlate,
  getGetWorkOrderQueryKey, getListWorkOrderPhotosQueryKey, getListWorkOrdersQueryKey,
  getListWorkOrderMaterialsQueryKey, getListMaterialsQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Camera, Upload, Trash2, CheckCircle2, X, Loader2, Plus, Minus, Package, Sparkles, FileText, Pencil, Check } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cs } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { WorkOrderStatusBadge, WORK_ORDER_STATUSES, type WorkOrderStatus } from "@/lib/work-order-status";
import { DEFAULT_HOURLY_RATE, computeLaborPrice } from "@/lib/labor";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

type Suggestion = { name: string; quantity: string; unit: string | null; unitPrice: number | null };

export default function WorkOrderDetail() {
  const [, params] = useRoute("/work-orders/:id");
  const id = params ? parseInt(params.id, 10) : NaN;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const invoiceInputRef = useRef<HTMLInputElement>(null);

  const { data: order, isLoading } = useGetWorkOrder(id, { query: { enabled: !isNaN(id) } as any });
  const { data: linkedVehicle } = useGetVehicleByPlate(order?.licensePlate ?? "", { query: { enabled: !!order?.licensePlate } as any });
  const isAutomatic = linkedVehicle?.transmission === "automatic";
  const { data: photos, isLoading: photosLoading } = useListWorkOrderPhotos(id, { query: { enabled: !isNaN(id) } as any });
  const { data: materials = [] } = useListWorkOrderMaterials(id, { query: { enabled: !isNaN(id) } as any });
  const { data: catalog = [] } = useListMaterials();
  const updateOrder = useUpdateWorkOrder();
  const deletePhoto = useDeletePhoto();
  const deleteOrder = useDeleteWorkOrder();
  const addMaterial = useAddWorkOrderMaterial();
  const deleteMaterial = useDeleteWorkOrderMaterial();
  const importInvoice = useImportInvoiceForWorkOrder();

  const [uploading, setUploading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    km: "", description: "", oilChange: false, transmissionOil: false, brakes: false,
    timing: false, airFilter: false, cabinFilter: false, stk: false, otherWork: "", otherServices: "", notes: "",
    laborHours: "", laborPrice: "", serviceDate: "",
  });

  // Inline labor edit
  const [laborEditing, setLaborEditing] = useState(false);
  const [laborHoursInput, setLaborHoursInput] = useState("");
  const [laborPriceInput, setLaborPriceInput] = useState("");
  const [laborPriceManual, setLaborPriceManual] = useState(false);
  const [editPriceManual, setEditPriceManual] = useState(false);

  function handleInlineHoursChange(value: string) {
    const cleaned = value.replace(",", ".");
    setLaborHoursInput(cleaned);
    if (!laborPriceManual) setLaborPriceInput(computeLaborPrice(cleaned));
  }
  function handleInlinePriceChange(value: string) {
    setLaborPriceInput(value);
    setLaborPriceManual(value.trim() !== "");
  }
  function handleEditHoursChange(value: string) {
    const cleaned = value.replace(",", ".");
    setEditForm(f => ({
      ...f,
      laborHours: cleaned,
      laborPrice: editPriceManual ? f.laborPrice : computeLaborPrice(cleaned),
    }));
  }
  function handleEditPriceChange(value: string) {
    setEditForm(f => ({ ...f, laborPrice: value }));
    setEditPriceManual(value.trim() !== "");
  }

  // Material add form
  const [matName, setMatName] = useState("");
  const [matQty, setMatQty] = useState("");
  const [matUnit, setMatUnit] = useState("");
  const [matPrice, setMatPrice] = useState("");

  function adjustMatQty(delta: number) {
    setMatQty(prev => {
      const current = parseFloat((prev || "0").replace(",", ".")) || 0;
      const next = Math.max(0, current + delta);
      return Number.isInteger(next) ? String(next) : next.toFixed(2).replace(/\.?0+$/, "");
    });
  }
  const [showSuggest, setShowSuggest] = useState(false);

  // Invoice import dialog
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceFiles, setInvoiceFiles] = useState<File[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const matchedCatalog = useMemo(() => {
    const q = matName.trim().toLowerCase();
    if (q.length < 1) return [];
    return catalog.filter(c => c.name.toLowerCase().includes(q)).slice(0, 6);
  }, [matName, catalog]);

  function openEdit() {
    if (!order) return;
    setEditForm({
      km: order.km?.toString() ?? "", description: order.description ?? "",
      oilChange: order.oilChange ?? false, transmissionOil: order.transmissionOil ?? false,
      brakes: order.brakes ?? false, timing: order.timing ?? false,
      airFilter: order.airFilter ?? false, cabinFilter: order.cabinFilter ?? false,
      stk: order.stk ?? false,
      otherWork: order.otherWork ?? "", otherServices: order.otherServices ?? "", notes: order.notes ?? "",
      laborHours: order.laborHours ?? "", laborPrice: order.laborPrice != null ? String(order.laborPrice) : "",
      serviceDate: order.serviceDate ?? "",
    });
    setEditPriceManual(order.laborPrice != null);
    setEditMode(true);
  }

  function invalidateOrder() {
    queryClient.invalidateQueries({ queryKey: getGetWorkOrderQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListWorkOrdersQueryKey() });
  }

  function startLaborEdit() {
    if (!order) return;
    setLaborHoursInput(order.laborHours ?? "");
    setLaborPriceInput(order.laborPrice != null ? String(order.laborPrice) : "");
    setLaborPriceManual(order.laborPrice != null);
    setLaborEditing(true);
  }

  function saveLabor() {
    updateOrder.mutate({
      id,
      data: {
        laborHours: laborHoursInput.trim() || null,
        laborPrice: laborPriceInput ? parseInt(laborPriceInput, 10) : null,
      }
    }, {
      onSuccess: () => { invalidateOrder(); setLaborEditing(false); toast({ title: "Práce uložena" }); },
      onError: () => toast({ title: "Chyba", description: "Práci se nepodařilo uložit.", variant: "destructive" }),
    });
  }

  function handleQuickStatus(value: string) {
    updateOrder.mutate({ id, data: { status: value as WorkOrderStatus } }, {
      onSuccess: () => { invalidateOrder(); toast({ title: "Stav změněn" }); },
      onError: () => toast({ title: "Chyba", description: "Stav se nepodařilo změnit.", variant: "destructive" }),
    });
  }

  function handleSave() {
    updateOrder.mutate({
      id,
      data: {
        km: editForm.km ? parseInt(editForm.km) : null,
        description: editForm.description || null,
        oilChange: editForm.oilChange,
        transmissionOil: editForm.transmissionOil,
        brakes: editForm.brakes,
        timing: editForm.timing,
        airFilter: editForm.airFilter,
        cabinFilter: editForm.cabinFilter,
        stk: editForm.stk,
        serviceDate: editForm.serviceDate || null,
        otherWork: editForm.otherWork || null,
        otherServices: editForm.otherServices || null,
        notes: editForm.notes || null,
        laborHours: editForm.laborHours.trim() || null,
        laborPrice: editForm.laborPrice ? parseInt(editForm.laborPrice, 10) : null,
      }
    }, {
      onSuccess: () => { invalidateOrder(); setEditMode(false); toast({ title: "Zakázka aktualizována" }); },
      onError: () => toast({ title: "Chyba", description: "Změny se nepodařilo uložit.", variant: "destructive" }),
    });
  }

  async function handlePhotoUpload(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await fetch(`/api/work-orders/${id}/photos`, { method: "POST", body: formData });
      if (!res.ok) throw new Error("Upload failed");
      queryClient.invalidateQueries({ queryKey: getListWorkOrderPhotosQueryKey(id) });
      toast({ title: "Fotka přidána" });
    } catch {
      toast({ title: "Chyba při nahrávání fotky", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handlePhotoUpload(file);
    e.target.value = "";
  }

  function invalidateMaterials() {
    queryClient.invalidateQueries({ queryKey: getListWorkOrderMaterialsQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListMaterialsQueryKey() });
  }

  function handleAddMaterial(e?: React.FormEvent) {
    e?.preventDefault();
    if (!matName.trim()) return;
    addMaterial.mutate({
      id,
      data: {
        name: matName.trim(),
        quantity: matQty.trim() || "1",
        unit: matUnit.trim() || null,
        unitPrice: matPrice ? parseInt(matPrice, 10) : null,
      }
    }, {
      onSuccess: () => {
        setMatName(""); setMatQty(""); setMatUnit(""); setMatPrice("");
        setShowSuggest(false);
        invalidateMaterials();
      },
      onError: () => toast({ title: "Chyba", description: "Materiál se nepodařilo přidat.", variant: "destructive" }),
    });
  }

  function pickSuggestion(name: string, unit: string | null, defaultPrice: number | null) {
    setMatName(name);
    if (unit) setMatUnit(unit);
    if (defaultPrice != null && !matPrice) setMatPrice(String(defaultPrice));
    setShowSuggest(false);
  }

  function handleDeleteMaterial(matId: number) {
    deleteMaterial.mutate({ id: matId }, {
      onSuccess: invalidateMaterials,
      onError: () => toast({ title: "Chyba", variant: "destructive" }),
    });
  }

  function handleInvoiceFiles(files: FileList | null) {
    if (!files) return;
    const list = Array.from(files).slice(0, 4 - invoiceFiles.length);
    setInvoiceFiles((prev) => [...prev, ...list].slice(0, 4));
  }

  async function handleRunInvoiceImport() {
    if (invoiceFiles.length === 0) return;
    try {
      const images = await Promise.all(invoiceFiles.map(fileToBase64));
      importInvoice.mutate({ id, data: { images } }, {
        onSuccess: (res) => {
          setSuggestions(res.items as Suggestion[]);
          if (res.items.length === 0) {
            toast({ title: "Žádné položky", description: "Z fotografie se nepodařilo rozeznat materiál." });
          }
        },
        onError: () => toast({ title: "Import selhal", variant: "destructive" }),
      });
    } catch {
      toast({ title: "Chyba", description: "Soubor se nepodařilo načíst.", variant: "destructive" });
    }
  }

  async function addAllSuggestions() {
    const failed: Suggestion[] = [];
    for (const s of suggestions) {
      const ok = await new Promise<boolean>((resolve) => {
        addMaterial.mutate({
          id,
          data: { name: s.name, quantity: s.quantity, unit: s.unit, unitPrice: s.unitPrice }
        }, {
          onSuccess: () => resolve(true),
          onError: () => resolve(false),
        });
      });
      if (!ok) failed.push(s);
    }
    invalidateMaterials();
    const succeeded = suggestions.length - failed.length;
    if (failed.length === 0) {
      setSuggestions([]);
      setInvoiceFiles([]);
      setInvoiceOpen(false);
      toast({ title: "Materiály přidány", description: `Přidáno ${succeeded} položek.` });
    } else {
      setSuggestions(failed);
      toast({
        title: "Část položek selhala",
        description: `Přidáno ${succeeded} z ${succeeded + failed.length}. Zbývající můžete zkusit znovu.`,
        variant: "destructive",
      });
    }
  }

  function addOneSuggestion(idx: number) {
    const s = suggestions[idx];
    addMaterial.mutate({
      id,
      data: { name: s.name, quantity: s.quantity, unit: s.unit, unitPrice: s.unitPrice }
    }, {
      onSuccess: () => {
        invalidateMaterials();
        setSuggestions(prev => prev.filter((_, i) => i !== idx));
      }
    });
  }

  const dateStr = (d?: string | null) => {
    if (!d) return "-";
    try { return format(parseISO(d), 'd. M. yyyy HH:mm', { locale: cs }); } catch { return d; }
  };

  const materialsTotal = useMemo(() => materials.reduce((sum, m) => {
    const q = parseFloat(m.quantity) || 0;
    return sum + (m.unitPrice ?? 0) * q;
  }, 0), [materials]);

  const grandTotal = materialsTotal + (order?.laborPrice ?? 0);

  if (isLoading) return (
    <div className="space-y-4">
      <div className="h-8 w-64 bg-muted animate-pulse rounded" />
      <div className="grid gap-4 md:grid-cols-2">
        {[1,2,3].map(i => <div key={i} className="h-48 bg-muted animate-pulse rounded-xl" />)}
      </div>
    </div>
  );

  if (!order) return <div className="text-center py-16 text-muted-foreground">Zakázka nenalezena.</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4 flex-wrap">
        <Link href="/work-orders">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1 min-w-[200px]">
          <div className="flex items-center gap-3 flex-wrap">
            <LicensePlate plate={order.licensePlate} size="xl" />
            <WorkOrderStatusBadge status={order.status} />
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Zakázka #{order.id} — {order.serviceDate
              ? <>servis {format(parseISO(order.serviceDate), 'd. M. yyyy', { locale: cs })} (vytvořena {dateStr(order.createdAt)})</>
              : <>vytvořena {dateStr(order.createdAt)}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground">Stav</Label>
            <Select value={order.status} onValueChange={handleQuickStatus}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WORK_ORDER_STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!editMode ? (
            <Button variant="outline" onClick={openEdit}>Upravit</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setEditMode(false)}>Zrušit</Button>
              <Button onClick={handleSave} disabled={updateOrder.isPending}>Uložit</Button>
            </>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" size="icon"><Trash2 className="h-4 w-4" /></Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Smazat zakázku?</AlertDialogTitle>
                <AlertDialogDescription>Tato akce je nevratná. Budou smazány i všechny fotky a materiály.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Zrušit</AlertDialogCancel>
                <AlertDialogAction onClick={() => {
                  deleteOrder.mutate({ id }, { onSuccess: () => { window.history.back(); } });
                }}>Smazat</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Details */}
        <Card>
          <CardHeader><CardTitle>Detaily zakázky</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {editMode ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Km</Label>
                    <Input type="number" value={editForm.km} onChange={e => setEditForm(f => ({ ...f, km: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Datum servisu</Label>
                    <Input type="date" value={editForm.serviceDate} onChange={e => setEditForm(f => ({ ...f, serviceDate: e.target.value }))} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Popis</Label>
                  <Textarea value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Poznámky</Label>
                  <Textarea value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Km</span>
                  <span>{order.km ? `${order.km.toLocaleString('cs-CZ')} km` : "-"}</span>
                  {order.completedAt && <>
                    <span className="text-muted-foreground">Dokončeno</span>
                    <span>{dateStr(order.completedAt)}</span>
                  </>}
                </div>
                {order.description && (
                  <div className="pt-2 border-t">
                    <p className="text-muted-foreground text-xs mb-1">Popis</p>
                    <p>{order.description}</p>
                  </div>
                )}
                {order.notes && (
                  <div className="pt-2 border-t">
                    <p className="text-muted-foreground text-xs mb-1">Poznámky</p>
                    <p>{order.notes}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Service items */}
        <Card>
          <CardHeader><CardTitle>Servisní úkony</CardTitle></CardHeader>
          <CardContent>
            {editMode ? (
              <div className="space-y-3">
                {[
                  { key: "oilChange", label: "Výměna motorového oleje" },
                  ...(isAutomatic || editForm.transmissionOil ? [{ key: "transmissionOil", label: "Olej v převodovce" }] : []),
                  { key: "brakes", label: "Servis brzd" },
                  { key: "timing", label: "Rozvody" },
                  { key: "airFilter", label: "Filtr vzduchový" },
                  { key: "cabinFilter", label: "Filtr kabinový" },
                  { key: "stk", label: "STK" },
                ].map(item => (
                  <div key={item.key} className="flex items-center space-x-2">
                    <Checkbox
                      id={`edit-${item.key}`}
                      checked={editForm[item.key as keyof typeof editForm] as boolean}
                      onCheckedChange={v => setEditForm(f => ({ ...f, [item.key]: !!v }))}
                    />
                    <Label htmlFor={`edit-${item.key}`}>{item.label}</Label>
                  </div>
                ))}
                <div className="space-y-1 pt-2">
                  <Label>Ostatní servisní úkony</Label>
                  <Textarea placeholder="Další úkony mimo standardní položky..." value={editForm.otherServices} onChange={e => setEditForm(f => ({ ...f, otherServices: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Ostatní práce</Label>
                  <Input value={editForm.otherWork} onChange={e => setEditForm(f => ({ ...f, otherWork: e.target.value }))} />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {[
                  { checked: order.oilChange, label: "Výměna motorového oleje" },
                  ...(order.transmissionOil ? [{ checked: true, label: "Olej v převodovce" }] : []),
                  { checked: order.brakes, label: "Servis brzd" },
                  { checked: order.timing, label: "Rozvody" },
                  { checked: order.airFilter, label: "Filtr vzduchový" },
                  { checked: order.cabinFilter, label: "Filtr kabinový" },
                  { checked: order.stk, label: "STK" },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-3 py-2">
                    <div className={`h-5 w-5 rounded-full flex items-center justify-center ${item.checked ? "bg-emerald-100 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                      {item.checked ? <CheckCircle2 className="h-3.5 w-3.5" /> : <X className="h-3 w-3" />}
                    </div>
                    <span className={`text-sm ${item.checked ? "font-medium" : "text-muted-foreground line-through"}`}>{item.label}</span>
                  </div>
                ))}
                {order.otherServices && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-1">Ostatní servisní úkony</p>
                    <p className="text-sm whitespace-pre-wrap">{order.otherServices}</p>
                  </div>
                )}
                {order.otherWork && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-1">Ostatní práce</p>
                    <p className="text-sm">{order.otherWork}</p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Práce a cena */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Práce a cena</CardTitle>
            {!editMode && !laborEditing && (
              <Button variant="ghost" size="sm" onClick={startLaborEdit}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />Upravit práci
              </Button>
            )}
            {!editMode && laborEditing && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => setLaborEditing(false)} disabled={updateOrder.isPending}>
                  <X className="h-3.5 w-3.5 mr-1.5" />Zrušit
                </Button>
                <Button size="sm" onClick={saveLabor} disabled={updateOrder.isPending}>
                  {updateOrder.isPending
                    ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    : <Check className="h-3.5 w-3.5 mr-1.5" />}
                  Uložit
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {editMode ? (
            <div className="grid grid-cols-2 gap-4 max-w-md">
              <div className="space-y-1">
                <Label>Počet hodin práce</Label>
                <Input
                  type="text" inputMode="decimal" placeholder="2.5"
                  value={editForm.laborHours}
                  onChange={e => handleEditHoursChange(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Cena za práci (Kč) <span className="text-xs text-muted-foreground font-normal">— sazba {DEFAULT_HOURLY_RATE} Kč/h</span></Label>
                <Input
                  type="number" placeholder="1500"
                  value={editForm.laborPrice}
                  onChange={e => handleEditPriceChange(e.target.value)}
                />
              </div>
            </div>
          ) : laborEditing ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Práce (h)</Label>
                <Input
                  type="text" inputMode="decimal" placeholder="2.5"
                  value={laborHoursInput}
                  onChange={e => handleInlineHoursChange(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveLabor(); if (e.key === "Escape") setLaborEditing(false); }}
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Cena práce (Kč) — sazba {DEFAULT_HOURLY_RATE} Kč/h</Label>
                <Input
                  type="number" placeholder="1500"
                  value={laborPriceInput}
                  onChange={e => handleInlinePriceChange(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveLabor(); if (e.key === "Escape") setLaborEditing(false); }}
                />
              </div>
              <div className="flex flex-col justify-end">
                <p className="text-xs text-muted-foreground mb-1">Materiál</p>
                <p className="font-semibold">{materialsTotal.toLocaleString("cs-CZ")} Kč</p>
              </div>
              <div className="flex flex-col justify-end">
                <p className="text-xs text-muted-foreground mb-1">Celkem (po uložení)</p>
                <p className="font-bold text-lg text-primary">
                  {(materialsTotal + (laborPriceInput ? parseInt(laborPriceInput, 10) || 0 : 0)).toLocaleString("cs-CZ")} Kč
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Práce</p>
                <p className="font-semibold">{order.laborHours ? `${order.laborHours} h` : "-"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Cena práce</p>
                <p className="font-semibold">{order.laborPrice != null ? `${order.laborPrice.toLocaleString("cs-CZ")} Kč` : "-"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Materiál</p>
                <p className="font-semibold">{materialsTotal.toLocaleString("cs-CZ")} Kč</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Celkem</p>
                <p className="font-bold text-lg text-primary">{grandTotal.toLocaleString("cs-CZ")} Kč</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Materials */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="flex items-center gap-2"><Package className="h-5 w-5" />Materiál ({materials.length})</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setInvoiceOpen(true)}>
              <Sparkles className="h-4 w-4 mr-2" />Načíst z faktury
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Add form */}
          <form onSubmit={handleAddMaterial} className="grid gap-3 md:grid-cols-[2fr_1fr_1.4fr_1fr_auto]">
            <div className="relative">
              <Input
                placeholder="Název dílu / materiálu"
                value={matName}
                onChange={(e) => { setMatName(e.target.value); setShowSuggest(true); }}
                onFocus={() => setShowSuggest(true)}
                onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              />
              {showSuggest && matchedCatalog.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-popover border rounded-md shadow-md max-h-56 overflow-auto">
                  {matchedCatalog.map(c => (
                    <button
                      type="button"
                      key={c.id}
                      onMouseDown={(e) => { e.preventDefault(); pickSuggestion(c.name, c.unit ?? null, c.defaultPrice ?? null); }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between gap-3"
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {c.unit ?? ""}{c.defaultPrice != null ? ` · ${c.defaultPrice} Kč` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Input type="number" placeholder="Cena/ks (Kč)" value={matPrice} onChange={e => setMatPrice(e.target.value)} />
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => adjustMatQty(-1)} aria-label="Snížit množství">
                <Minus className="h-4 w-4" />
              </Button>
              <Input
                type="text" inputMode="decimal" placeholder="Množství" value={matQty}
                onChange={e => setMatQty(e.target.value.replace(",", "."))}
                className="text-center"
              />
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => adjustMatQty(1)} aria-label="Zvýšit množství">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <Input placeholder="ks / l / kg" value={matUnit} onChange={e => setMatUnit(e.target.value)} />
            <Button type="submit" disabled={addMaterial.isPending || !matName.trim()}>
              <Plus className="h-4 w-4 mr-2" />Přidat
            </Button>
          </form>

          {materials.length === 0 ? (
            <div className="text-center py-8 border-2 border-dashed rounded-lg text-muted-foreground">
              <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Žádný materiál na zakázce.</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left text-xs uppercase text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Název</th>
                    <th className="px-3 py-2 font-medium text-right">Množství</th>
                    <th className="px-3 py-2 font-medium text-right">Cena/ks</th>
                    <th className="px-3 py-2 font-medium text-right">Celkem</th>
                    <th className="px-3 py-2 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {materials.map(m => {
                    const q = parseFloat(m.quantity) || 0;
                    const total = (m.unitPrice ?? 0) * q;
                    return (
                      <tr key={m.id}>
                        <td className="px-3 py-2 font-medium">{m.name}</td>
                        <td className="px-3 py-2 text-right">{m.quantity}{m.unit ? ` ${m.unit}` : ""}</td>
                        <td className="px-3 py-2 text-right">{m.unitPrice != null ? `${m.unitPrice.toLocaleString("cs-CZ")} Kč` : "-"}</td>
                        <td className="px-3 py-2 text-right font-semibold">{m.unitPrice != null ? `${total.toLocaleString("cs-CZ")} Kč` : "-"}</td>
                        <td className="px-3 py-2">
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteMaterial(m.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-muted/30">
                    <td className="px-3 py-2 font-semibold" colSpan={3}>Materiál celkem</td>
                    <td className="px-3 py-2 text-right font-bold">{materialsTotal.toLocaleString("cs-CZ")} Kč</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Photos */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Fotky ({photos?.length ?? 0})</CardTitle>
            <div className="flex gap-2">
              <input
                ref={fileInputRef} type="file" accept="image/*" capture="environment"
                className="hidden" onChange={handleFileChange}
              />
              <Button variant="outline" size="sm" onClick={() => { if (fileInputRef.current) { fileInputRef.current.removeAttribute("capture"); fileInputRef.current.click(); } }} disabled={uploading}>
                <Upload className="h-4 w-4 mr-2" />Nahrát
              </Button>
              <Button size="sm" onClick={() => { if (fileInputRef.current) { fileInputRef.current.setAttribute("capture", "environment"); fileInputRef.current.click(); } }} disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Camera className="h-4 w-4 mr-2" />}
                Fotit
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {photosLoading ? (
            <div className="grid grid-cols-3 gap-3">
              {[1,2,3].map(i => <div key={i} className="aspect-square bg-muted animate-pulse rounded-lg" />)}
            </div>
          ) : !photos || photos.length === 0 ? (
            <div className="text-center py-10 border-2 border-dashed rounded-lg">
              <Camera className="h-10 w-10 text-muted-foreground mx-auto mb-2 opacity-30" />
              <p className="text-sm text-muted-foreground">Zatím žádné fotky.</p>
              <p className="text-xs text-muted-foreground">Použijte tlačítko "Fotit" pro pořízení fotky přímo z telefonu.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {photos.map(photo => (
                <div key={photo.id} className="relative group aspect-square">
                  <Dialog>
                    <DialogTrigger asChild>
                      <img
                        src={`/api/storage${photo.url}`} alt="Fotka zakázky"
                        className="w-full h-full object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity border"
                        onError={e => { (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='%23f0f0f0'/%3E%3Ctext x='50' y='55' text-anchor='middle' fill='%23999' font-size='12'%3EFotka%3C/text%3E%3C/svg%3E"; }}
                      />
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl p-2">
                      <img src={`/api/storage${photo.url}`} alt="Fotka zakázky" className="w-full h-auto rounded-lg max-h-[80vh] object-contain" />
                    </DialogContent>
                  </Dialog>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" size="icon" className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Smazat fotku?</AlertDialogTitle>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Zrušit</AlertDialogCancel>
                        <AlertDialogAction onClick={() => {
                          deletePhoto.mutate({ id: photo.id }, {
                            onSuccess: () => queryClient.invalidateQueries({ queryKey: getListWorkOrderPhotosQueryKey(id) })
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

      {/* Invoice import dialog */}
      <Dialog open={invoiceOpen} onOpenChange={(open) => { setInvoiceOpen(open); if (!open) { setInvoiceFiles([]); setSuggestions([]); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-amber-500" />Načíst materiál z faktury / dodacího listu</DialogTitle>
            <DialogDescription>
              Vyfoťte nebo nahrajte fotografie dokladu. Rozpoznáme jednotlivé položky a před přidáním je můžete zkontrolovat.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <input
              ref={invoiceInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={(e) => { handleInvoiceFiles(e.target.files); e.target.value = ""; }}
            />
            <div className="flex gap-2">
              <Button
                type="button" variant="outline" className="flex-1"
                onClick={() => { if (invoiceInputRef.current) { invoiceInputRef.current.removeAttribute("capture"); invoiceInputRef.current.click(); } }}
                disabled={invoiceFiles.length >= 4 || importInvoice.isPending}
              >
                <Upload className="h-4 w-4 mr-2" />Vybrat soubor
              </Button>
              <Button
                type="button" variant="outline" className="flex-1"
                onClick={() => { if (invoiceInputRef.current) { invoiceInputRef.current.setAttribute("capture", "environment"); invoiceInputRef.current.click(); } }}
                disabled={invoiceFiles.length >= 4 || importInvoice.isPending}
              >
                <Camera className="h-4 w-4 mr-2" />Fotit
              </Button>
            </div>

            {invoiceFiles.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {invoiceFiles.map((f, i) => (
                  <div key={i} className="relative aspect-video rounded-lg border bg-muted overflow-hidden">
                    <img src={URL.createObjectURL(f)} alt={f.name} className="w-full h-full object-cover" />
                    <Button
                      type="button" variant="destructive" size="icon"
                      className="absolute top-1 right-1 h-6 w-6"
                      onClick={() => setInvoiceFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      disabled={importInvoice.isPending}
                    ><X className="h-3 w-3" /></Button>
                  </div>
                ))}
              </div>
            )}

            {suggestions.length > 0 && (
              <div className="border rounded-lg max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-left text-xs uppercase text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Název</th>
                      <th className="px-3 py-2 font-medium text-right">Množ.</th>
                      <th className="px-3 py-2 font-medium text-right">Cena/ks</th>
                      <th className="px-3 py-2 w-12"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {suggestions.map((s, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2">{s.name}</td>
                        <td className="px-3 py-2 text-right">{s.quantity}{s.unit ? ` ${s.unit}` : ""}</td>
                        <td className="px-3 py-2 text-right">{s.unitPrice != null ? `${s.unitPrice} Kč` : "-"}</td>
                        <td className="px-3 py-2">
                          <Button variant="ghost" size="icon" onClick={() => addOneSuggestion(i)} title="Přidat">
                            <Plus className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <DialogFooter className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setInvoiceOpen(false)} disabled={importInvoice.isPending}>Zavřít</Button>
            {suggestions.length === 0 ? (
              <Button type="button" onClick={handleRunInvoiceImport} disabled={invoiceFiles.length === 0 || importInvoice.isPending}>
                {importInvoice.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Zpracovávám...</> : <><Sparkles className="h-4 w-4 mr-2" />Rozpoznat položky</>}
              </Button>
            ) : (
              <Button type="button" onClick={addAllSuggestions} disabled={addMaterial.isPending}>
                <Plus className="h-4 w-4 mr-2" />Přidat všechny ({suggestions.length})
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
