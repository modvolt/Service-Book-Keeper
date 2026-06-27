import { Badge } from "@/components/ui/badge";
import { AlertCircle, Clock, PackageSearch, CalendarClock, CheckCircle2, FileText, FileCheck2, FileX2, Wallet, CircleDollarSign, CircleSlash } from "lucide-react";
import type { ReactNode } from "react";

export type WorkOrderStatus =
  | "open"
  | "in_progress"
  | "waiting_parts"
  | "needs_return"
  | "completed";

export const WORK_ORDER_STATUSES: { value: WorkOrderStatus; label: string }[] = [
  { value: "open", label: "Nová" },
  { value: "in_progress", label: "Probíhá" },
  { value: "waiting_parts", label: "Čeká na díly" },
  { value: "needs_return", label: "Má přijet znovu" },
  { value: "completed", label: "Dokončeno" },
];

export function statusLabel(status: string): string {
  return WORK_ORDER_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function WorkOrderStatusBadge({
  status,
  size = "default",
}: {
  status: string;
  size?: "default" | "sm";
}): ReactNode {
  const cls = size === "sm" ? "" : "text-sm px-3 py-1";
  const Icon = size === "sm" ? null : (() => {
    switch (status) {
      case "open": return <AlertCircle className="h-3 w-3 mr-1" />;
      case "in_progress": return <Clock className="h-3 w-3 mr-1" />;
      case "waiting_parts": return <PackageSearch className="h-3 w-3 mr-1" />;
      case "needs_return": return <CalendarClock className="h-3 w-3 mr-1" />;
      case "completed": return <CheckCircle2 className="h-3 w-3 mr-1" />;
      default: return null;
    }
  })();

  switch (status) {
    case "open":
      return <Badge variant="secondary" className={cls}>{Icon}Nová</Badge>;
    case "in_progress":
      return <Badge className={`bg-amber-500 text-white hover:bg-amber-600 ${cls}`}>{Icon}Probíhá</Badge>;
    case "waiting_parts":
      return <Badge className={`bg-orange-500 text-white hover:bg-orange-600 ${cls}`}>{Icon}Čeká na díly</Badge>;
    case "needs_return":
      return <Badge className={`bg-violet-500 text-white hover:bg-violet-600 ${cls}`}>{Icon}Má přijet znovu</Badge>;
    case "completed":
      return <Badge className={`bg-emerald-600 text-white hover:bg-emerald-700 ${cls}`}>{Icon}Dokončeno</Badge>;
    default:
      return <Badge className={cls}>{status}</Badge>;
  }
}

export type InvoiceStatus = "not_invoiced" | "ready_to_invoice" | "invoiced";

export const INVOICE_STATUSES: { value: InvoiceStatus; label: string }[] = [
  { value: "not_invoiced", label: "Nefakturováno" },
  { value: "ready_to_invoice", label: "Připraveno k fakturaci" },
  { value: "invoiced", label: "Vyfakturováno" },
];

export function invoiceStatusLabel(status: string): string {
  return INVOICE_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function InvoiceStatusBadge({
  status,
  size = "default",
}: {
  status: string;
  size?: "default" | "sm";
}): ReactNode {
  const cls = size === "sm" ? "" : "text-sm px-3 py-1";
  const Icon = size === "sm" ? null : (() => {
    switch (status) {
      case "not_invoiced": return <FileX2 className="h-3 w-3 mr-1" />;
      case "ready_to_invoice": return <FileText className="h-3 w-3 mr-1" />;
      case "invoiced": return <FileCheck2 className="h-3 w-3 mr-1" />;
      default: return null;
    }
  })();

  switch (status) {
    case "not_invoiced":
      return <Badge variant="outline" className={cls}>{Icon}Nefakturováno</Badge>;
    case "ready_to_invoice":
      return <Badge className={`bg-sky-500 text-white hover:bg-sky-600 ${cls}`}>{Icon}Připraveno k fakturaci</Badge>;
    case "invoiced":
      return <Badge className={`bg-indigo-600 text-white hover:bg-indigo-700 ${cls}`}>{Icon}Vyfakturováno</Badge>;
    default:
      return <Badge className={cls}>{status}</Badge>;
  }
}

export type PaymentStatus = "unpaid" | "partial" | "paid";

export const PAYMENT_STATUSES: { value: PaymentStatus; label: string }[] = [
  { value: "unpaid", label: "Nezaplaceno" },
  { value: "partial", label: "Částečně zaplaceno" },
  { value: "paid", label: "Zaplaceno" },
];

export function paymentStatusLabel(status: string): string {
  return PAYMENT_STATUSES.find((s) => s.value === status)?.label ?? status;
}

export function PaymentStatusBadge({
  status,
  size = "default",
}: {
  status: string;
  size?: "default" | "sm";
}): ReactNode {
  const cls = size === "sm" ? "" : "text-sm px-3 py-1";
  const Icon = size === "sm" ? null : (() => {
    switch (status) {
      case "unpaid": return <CircleSlash className="h-3 w-3 mr-1" />;
      case "partial": return <Wallet className="h-3 w-3 mr-1" />;
      case "paid": return <CircleDollarSign className="h-3 w-3 mr-1" />;
      default: return null;
    }
  })();

  switch (status) {
    case "unpaid":
      return <Badge variant="outline" className={`text-red-600 border-red-300 ${cls}`}>{Icon}Nezaplaceno</Badge>;
    case "partial":
      return <Badge className={`bg-amber-500 text-white hover:bg-amber-600 ${cls}`}>{Icon}Částečně zaplaceno</Badge>;
    case "paid":
      return <Badge className={`bg-emerald-600 text-white hover:bg-emerald-700 ${cls}`}>{Icon}Zaplaceno</Badge>;
    default:
      return <Badge className={cls}>{status}</Badge>;
  }
}
