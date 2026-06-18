import { useEffect } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { setScanClientId } from "@/lib/scan-channel";
import { setVehiclePrefill, setWorkOrderPrefill } from "@/lib/scan-prefill";

type HandoffEvent =
  | {
      kind: "new-vehicle";
      prefill: {
        licensePlate: string | null;
        vin: string | null;
        registrationYear: number | null;
        engineDisplacement: number | null;
        make: string | null;
        model: string | null;
        odometerKm: number | null;
        ownerName: string | null;
        ownerIco: string | null;
        ownerAddress: string | null;
        ownerType: string | null;
      };
    }
  | {
      kind: "work-order";
      vehicleId: number;
      licensePlate: string;
      make: string | null;
      model: string | null;
      prefill: { km: number | null };
    };

/**
 * Subscribe the open (PC) session to live scan handoffs from the phone. When a
 * scan completes on the phone, the server pushes a routing decision here and we
 * navigate to the matching pre-filled form — the mechanic never touches the PC.
 * Nothing is saved automatically; the form is for review and confirmation.
 *
 * Mounted once inside the authenticated app shell.
 */
export function useScanHandoff(): void {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;

    function connect() {
      if (closed) return;
      es = new EventSource("/api/scan/events", { withCredentials: true });

      es.addEventListener("connected", (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          if (typeof data?.clientId === "string") setScanClientId(data.clientId);
        } catch {}
      });

      es.addEventListener("handoff", (e) => {
        let data: HandoffEvent;
        try {
          data = JSON.parse((e as MessageEvent).data);
        } catch {
          return;
        }

        if (data.kind === "new-vehicle") {
          setVehiclePrefill({
            licensePlate: data.prefill?.licensePlate ?? null,
            vin: data.prefill?.vin ?? null,
            registrationYear: data.prefill?.registrationYear ?? null,
            engineDisplacement: data.prefill?.engineDisplacement ?? null,
            make: data.prefill?.make ?? null,
            model: data.prefill?.model ?? null,
            currentKm: data.prefill?.odometerKm ?? null,
            ownerName: data.prefill?.ownerName ?? null,
            ownerIco: data.prefill?.ownerIco ?? null,
            ownerAddress: data.prefill?.ownerAddress ?? null,
            ownerType: data.prefill?.ownerType ?? null,
          });
          toast({
            title: "Načteno z telefonu",
            description: "Nové vozidlo — zkontrolujte předvyplněné údaje a uložte.",
          });
          navigate("/vehicles/new");
        } else if (data.kind === "work-order") {
          setWorkOrderPrefill({ km: data.prefill?.km ?? null });
          const label = `${data.make ?? ""} ${data.model ?? ""}`.trim();
          toast({
            title: "Načteno z telefonu",
            description: label ? `${label} — nová zakázka.` : "Nová zakázka pro nalezené vozidlo.",
          });
          navigate(`/work-orders/new?spz=${encodeURIComponent(data.licensePlate ?? "")}`);
        }
      });

      es.onerror = () => {
        // EventSource retries on its own; drop the stale id until reconnect.
        setScanClientId(null);
      };
    }

    connect();

    return () => {
      closed = true;
      es?.close();
      setScanClientId(null);
    };
  }, [navigate, toast]);
}
