import { useState } from "react";
import { useListMaterials } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QrCode, Search, Loader2 } from "lucide-react";
import { MaterialQrDialog } from "@/components/material-qr-dialog";

export default function QrStitkyPage() {
  const [search, setSearch] = useState("");
  const [printItemId, setPrintItemId] = useState<number | null>(null);

  const { data: items = [], isLoading } = useListMaterials({ search: search || undefined });

  return (
    <>
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
        <MaterialQrDialog itemId={printItemId} onClose={() => setPrintItemId(null)} />
      )}
    </>
  );
}
