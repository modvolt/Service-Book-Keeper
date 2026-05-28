import { useState, useRef } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetWorkOrder, useUpdateWorkOrder, useListWorkOrderPhotos, useDeletePhoto, useDeleteWorkOrder,
  getGetWorkOrderQueryKey, getListWorkOrderPhotosQueryKey, getListWorkOrdersQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Camera, Upload, Trash2, CheckCircle2, X, Loader2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cs } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { WorkOrderStatusBadge, WORK_ORDER_STATUSES, type WorkOrderStatus } from "@/lib/work-order-status";

export default function WorkOrderDetail() {
  const [, params] = useRoute("/work-orders/:id");
  const id = params ? parseInt(params.id, 10) : NaN;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: order, isLoading } = useGetWorkOrder(id, { query: { enabled: !isNaN(id) } as any });
  const { data: photos, isLoading: photosLoading } = useListWorkOrderPhotos(id, { query: { enabled: !isNaN(id) } as any });
  const updateOrder = useUpdateWorkOrder();
  const deletePhoto = useDeletePhoto();
  const deleteOrder = useDeleteWorkOrder();

  const [uploading, setUploading] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState({
    status: "open", km: "", description: "", oilChange: false, brakes: false,
    timing: false, stk: false, otherWork: "", otherServices: "", notes: ""
  });

  function openEdit() {
    if (!order) return;
    setEditForm({
      status: order.status, km: order.km?.toString() ?? "", description: order.description ?? "",
      oilChange: order.oilChange ?? false, brakes: order.brakes ?? false, timing: order.timing ?? false, stk: order.stk ?? false,
      otherWork: order.otherWork ?? "", otherServices: order.otherServices ?? "", notes: order.notes ?? ""
    });
    setEditMode(true);
  }

  async function handleSave() {
    updateOrder.mutate({
      id,
      data: {
        status: editForm.status as WorkOrderStatus,
        km: editForm.km ? parseInt(editForm.km) : null,
        description: editForm.description || null,
        oilChange: editForm.oilChange,
        brakes: editForm.brakes,
        timing: editForm.timing,
        stk: editForm.stk,
        otherWork: editForm.otherWork || null,
        otherServices: editForm.otherServices || null,
        notes: editForm.notes || null,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetWorkOrderQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListWorkOrdersQueryKey() });
        setEditMode(false);
        toast({ title: "Zakázka aktualizována" });
      }
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

  const dateStr = (d?: string | null) => {
    if (!d) return "-";
    try { return format(parseISO(d), 'd. M. yyyy HH:mm', { locale: cs }); } catch { return d; }
  };

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
      <div className="flex items-center gap-4">
        <Link href="/work-orders">
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-bold font-mono uppercase tracking-wider">{order.licensePlate}</h1>
            <WorkOrderStatusBadge status={order.status} />
          </div>
          <p className="text-muted-foreground text-sm mt-1">Zakázka #{order.id} — vytvořena {dateStr(order.createdAt)}</p>
        </div>
        <div className="flex gap-2">
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
                <AlertDialogDescription>Tato akce je nevratná. Budou smazány i všechny fotky.</AlertDialogDescription>
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
                <div className="space-y-1">
                  <Label>Stav</Label>
                  <Select value={editForm.status} onValueChange={v => setEditForm(f => ({ ...f, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WORK_ORDER_STATUSES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Km</Label>
                  <Input type="number" value={editForm.km} onChange={e => setEditForm(f => ({ ...f, km: e.target.value }))} />
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
                  { key: "oilChange", label: "Výměna oleje" },
                  { key: "brakes", label: "Servis brzd" },
                  { key: "timing", label: "Rozvody" },
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
                  { checked: order.oilChange, label: "Výměna oleje" },
                  { checked: order.brakes, label: "Servis brzd" },
                  { checked: order.timing, label: "Rozvody" },
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

      {/* Photos */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Fotky ({photos?.length ?? 0})</CardTitle>
            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleFileChange}
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
                        src={`/api/storage${photo.url}`}
                        alt="Fotka zakázky"
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
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
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
    </div>
  );
}
