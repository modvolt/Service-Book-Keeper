import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLogin, getGetAuthStatusQueryKey } from "@workspace/api-client-react";
import { Wrench } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage() {
  const [password, setPassword] = useState("");
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

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    login.mutate({ data: { password } });
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
          <form onSubmit={onSubmit} className="space-y-4">
            <input
              type="text"
              name="username"
              autoComplete="username"
              value="mechanik"
              readOnly
              hidden
            />
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
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
