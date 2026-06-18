import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useListMaterials, useGetMaterialQr } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QrCode, Search, Printer, Loader2 } from "lucide-react";

type MaterialQrPayload = {
  id: number;
  name: string;
  unit: string | null;
  payload: string;
};

function QrPrintDialog({ itemId, onClose }: { itemId: number; onClose: () => void }) {
  const { data, isLoading, isError } = useGetMaterialQr(itemId, {
    query: { staleTime: 60_000 } as any,
  });

  function handlePrint() {
    window.print();
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/*
        No print:hidden on DialogContent so it stays visible when printing.
        Print CSS uses visibility to show only #qr-label-print; the dialog backdrop
        and other content become invisible while the QR label remains.
      */}
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

export default function QrStitkyPage() {
  const [search, setSearch] = useState("");
  const [printItemId, setPrintItemId] = useState<number | null>(null);

  const { data: items = [], isLoading } = useListMaterials({ search: search || undefined });

  return (
    <>
      {/*
        Print CSS: hide everything via visibility:hidden (overridable by descendants),
        then show only #qr-label-print. Using visibility instead of display:none allows
        the child override to work even when the parent is hidden.
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

      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <QrCode className="h-7 w-7 text-primary shrink-0" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">QR štítky</h1>
            <p className="text-muted-foreground text-sm">Generujte a tiskněte QR kódy pro položky skladu.</p>
          </div>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Hledat materiál…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Katalog materiálů</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <div className="py-12 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            )}

            {!isLoading && items.length === 0 && (
              <div className="py-12 text-center text-muted-foreground text-sm">
                {search ? "Žádné materiály neodpovídají hledání." : "Katalog je prázdný."}
              </div>
            )}

            {!isLoading && items.length > 0 && (
              <div className="divide-y">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30 transition-colors">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{item.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                        {item.productNumber && <span className="font-mono">{item.productNumber}</span>}
                        {item.unit && <span>{item.unit}</span>}
                        {item.defaultPrice != null && (
                          <span>{item.defaultPrice.toLocaleString("cs-CZ")} Kč</span>
                        )}
                        {item.supplier && <span>{item.supplier}</span>}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPrintItemId(item.id)}
                      className="ml-3 shrink-0"
                    >
                      <QrCode className="h-3.5 w-3.5 mr-1.5" />Tisk QR
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {printItemId !== null && (
        <QrPrintDialog itemId={printItemId} onClose={() => setPrintItemId(null)} />
      )}
    </>
  );
}
