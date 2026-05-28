import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type AresFields = { name: string; address: string; dic: string };

export function AresButton({ ico, onLoaded }: { ico: string; onLoaded: (data: AresFields) => void }) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleClick() {
    const clean = ico.replace(/\s+/g, "");
    if (!/^\d{6,8}$/.test(clean)) {
      toast({ title: "Zadejte platné IČO", description: "6–8 číslic", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/ares/${clean}`);
      if (res.status === 404) { toast({ title: "Subjekt nenalezen", variant: "destructive" }); return; }
      if (!res.ok) { toast({ title: "Chyba při načítání z ARES", variant: "destructive" }); return; }
      const data = await res.json();
      onLoaded({
        name: data.name ?? "",
        address: data.address ?? "",
        dic: data.dic ?? "",
      });
      toast({ title: "Údaje načteny z ARES", description: data.name });
    } catch {
      toast({ title: "Chyba spojení", variant: "destructive" });
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
