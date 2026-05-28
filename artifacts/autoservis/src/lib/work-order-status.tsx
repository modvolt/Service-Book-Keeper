import { Badge } from "@/components/ui/badge";
import { AlertCircle, Clock, PackageSearch, CalendarClock, CheckCircle2 } from "lucide-react";
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
