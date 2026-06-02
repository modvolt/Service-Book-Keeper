import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLogin, useForgotPassword, getGetAuthStatusQueryKey } from "@workspace/api-client-react";
import { Wrench, ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const login = useLogin({
    mutation: {
      onSuccess: () => {
        queryClient.setQueryData(getGetAuthStatusQueryKey(), { authenticated: true });
        queryClient.invalidateQueries();
      },
      onError: (err) => {
        const message =
          err?.data && typeof err.data === "object" && "error" in err.data
            ? String((err.data as { error: unknown }).error)
            : "Přihlášení se nezdařilo";
        toast({ variant: "destructive", title: "Chyba přihlášení", description: message });
      },
    },
  });

  const forgot = useForgotPassword({
    mutation: {
      onSuccess: () => setForgotSent(true),
      onError: () => {
        // Generic success message regardless, to avoid enumeration.
        setForgotSent(true);
      },
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    login.mutate({ data: { password } });
  };

  const onForgotSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    forgot.mutate({ data: { email: email.trim() } });
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
          <CardTitle className="text-xl">AutoServis</CardTitle>
        </CardHeader>
        <CardContent>
          {mode === "login" ? (
            <form onSubmit={onSubmit} className="space-y-4">
              <input type="text" name="username" autoComplete="username" value="mechanik" readOnly hidden />
              <div className="space-y-2">
                <Label htmlFor="password">Heslo</Label>
                <Input
                  id="password"
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Zadejte heslo"
                />
              </div>
              <Button type="submit" className="w-full" disabled={login.isPending || !password}>
                {login.isPending ? "Přihlašování…" : "Přihlásit se"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => { setMode("forgot"); setForgotSent(false); }}
              >
                Zapomenuté heslo?
              </button>
            </form>
          ) : forgotSent ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Pokud e-mail odpovídá nastavené adrese, byl na něj odeslán odkaz pro obnovu hesla.
                Odkaz platí 1 hodinu.
              </p>
              <Button variant="outline" className="w-full" onClick={() => setMode("login")}>
                <ArrowLeft className="h-4 w-4 mr-2" /> Zpět na přihlášení
              </Button>
            </div>
          ) : (
            <form onSubmit={onForgotSubmit} className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Zadejte e-mailovou adresu nastavenou pro upozornění. Pošleme na ni odkaz pro nastavení nového hesla.
              </p>
              <div className="space-y-2">
                <Label htmlFor="forgot-email">E-mail</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vas@email.cz"
                />
              </div>
              <Button type="submit" className="w-full" disabled={forgot.isPending || !email.trim()}>
                {forgot.isPending ? "Odesílání…" : "Odeslat odkaz pro obnovu"}
              </Button>
              <button
                type="button"
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => setMode("login")}
              >
                Zpět na přihlášení
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
