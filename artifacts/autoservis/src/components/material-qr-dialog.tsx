import { QRCodeSVG } from "qrcode.react";
import { useGetMaterialQr } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Printer, Loader2 } from "lucide-react";

type MaterialQrPayload = {
  id: number;
  name: string;
  unit: string | null;
  payload: string;
};

/**
 * Reusable dialog that fetches and prints a material's QR label.
 *
 * The QR payload is the portable `autoservis:material:<id>:<name>` scheme
 * returned by GET /materials/:id/qr — it is NOT a URL and is not tied to any
 * Replit (or other) domain, so printed labels keep working after a move/deploy.
 */
export function MaterialQrDialog({ itemId, onClose }: { itemId: number; onClose: () => void }) {
  const { data, isLoading, isError } = useGetMaterialQr(itemId, {
    query: { staleTime: 60_000 } as any,
  });

  function handlePrint() {
    window.print();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/*
        Print CSS: hide everything via visibility:hidden (overridable by descendants),
        then show only #qr-label-print. Using visibility instead of display:none allows
        the child override to work even when the parent is hidden. Kept with the dialog
        so the print target and its styles always render together.
      */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #qr-label-print, #qr-label-print * { visibility: visible; }
          #qr-label-print {
            position: fixed;
            top: 0;
            left: 0;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 2rem;
            background: white;
          }
        }
      `}</style>

      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>QR štítek</DialogTitle>
        </DialogHeader>

        {isLoading && (
          <div className="py-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          </div>
        )}

        {isError && (
          <p className="text-destructive text-sm text-center py-4">QR kód se nepodařilo načíst.</p>
        )}

        {data && (
          <div className="flex flex-col items-center gap-3 py-2">
            {/* This div is targeted by @media print via id */}
            <div
              id="qr-label-print"
              className="flex flex-col items-center gap-2 p-4 bg-white rounded-lg border"
            >
              <QRCodeSVG value={(data as MaterialQrPayload).payload} size={180} level="M" />
              <p className="font-semibold text-center text-sm">{(data as MaterialQrPayload).name}</p>
              {(data as MaterialQrPayload).unit && (
                <p className="text-xs text-muted-foreground">{(data as MaterialQrPayload).unit}</p>
              )}
            </div>
            <Button onClick={handlePrint} className="w-full">
              <Printer className="h-4 w-4 mr-2" />Tisknout štítek
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
