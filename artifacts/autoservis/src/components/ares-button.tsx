import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { fetchAres, isValidIco, type AresFields } from "@/lib/ares";

export function AresButton({ ico, onLoaded }: { ico: string; onLoaded: (data: AresFields) => void }) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleClick() {
    if (!isValidIco(ico)) {
      toast({ title: "Zadejte platné IČO", description: "6–8 číslic", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const result = await fetchAres(ico);
      if (!result.ok) {
        if (result.reason === "notfound") toast({ title: "Subjekt nenalezen", variant: "destructive" });
        else toast({ title: "Chyba při načítání z ARES", variant: "destructive" });
        return;
      }
      onLoaded(result.data);
      toast({ title: "Údaje načteny z ARES", description: result.data.name });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={loading || !ico.trim()}>
      {loading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1.5" />}
      Načíst z ARES
    </Button>
  );
}
