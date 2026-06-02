import { useState } from "react";
import { useResetPassword } from "@workspace/api-client-react";
import { Wrench, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

function getToken(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("token") ?? "";
}

function appRoot(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "") || "/";
}

export default function ResetPasswordPage() {
  const [token] = useState(getToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const { toast } = useToast();

  const reset = useResetPassword({
    mutation: {
      onSuccess: () => setDone(true),
      onError: (err) => {
        const message =
          err?.data && typeof err.data === "object" && "error" in err.data
            ? String((err.data as { error: unknown }).error)
            : "Obnova hesla se nezdařila.";
        toast({ variant: "destructive", title: "Chyba", description: message });
      },
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast({ variant: "destructive", title: "Chyba", description: "Heslo musí mít alespoň 8 znaků." });
      return;
    }
    if (password !== confirm) {
      toast({ variant: "destructive", title: "Chyba", description: "Hesla se neshodují." });
      return;
    }
    reset.mutate({ data: { token, newPassword: password } });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-3 text-center">
          <div className="flex justify-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Wrench className="h-6 w-6 text-primary" />
            </div>
          </div>
          <CardTitle className="text-xl">Nové heslo</CardTitle>
        </CardHeader>
        <CardContent>
          {!token ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Chybí platný odkaz pro obnovu hesla. Vyžádejte si nový odkaz na přihlašovací stránce.
              </p>
              <Button variant="outline" className="w-full" onClick={() => { window.location.href = appRoot(); }}>
                Zpět na přihlášení
              </Button>
            </div>
          ) : done ? (
            <div className="space-y-4 text-center">
              <div className="flex justify-center">
                <CheckCircle2 className="h-10 w-10 text-green-600" />
              </div>
              <p className="text-sm text-muted-foreground">Heslo bylo úspěšně změněno. Nyní se můžete přihlásit.</p>
              <Button className="w-full" onClick={() => { window.location.href = appRoot(); }}>
                Přejít na přihlášení
              </Button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Nové heslo</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoFocus
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Alespoň 8 znaků"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Heslo znovu</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Zopakujte heslo"
                />
              </div>
              <Button type="submit" className="w-full" disabled={reset.isPending || !password || !confirm}>
                {reset.isPending ? "Ukládání…" : "Nastavit nové heslo"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
