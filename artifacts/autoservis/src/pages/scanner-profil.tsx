import { useState } from "react";
import { useChangeScannerPassword } from "@workspace/api-client-react";
import { KeyRound, CheckCircle2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function ScannerProfilPage() {
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [done, setDone] = useState(false);

  const changePw = useChangeScannerPassword({
    mutation: {
      onSuccess: () => {
        setDone(true);
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      },
      onError: (err) => {
        const message =
          err?.data && typeof err.data === "object" && "error" in err.data
            ? String((err.data as { error: unknown }).error)
            : "Změna hesla se nezdařila.";
        toast({ variant: "destructive", title: "Chyba", description: message });
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({ variant: "destructive", title: "Chyba", description: "Nové heslo musí mít alespoň 8 znaků." });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ variant: "destructive", title: "Chyba", description: "Nová hesla se neshodují." });
      return;
    }
    changePw.mutate({ data: { currentPassword, newPassword } });
  }

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Profil skeneru</h1>
        <p className="text-sm text-muted-foreground mt-1">Správa přihlašovacích údajů skenovacího účtu.</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            <CardTitle className="text-base">Změna hesla</CardTitle>
          </div>
          <CardDescription>
            Pro změnu hesla zadejte současné heslo a zvolte nové.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {done ? (
            <div className="space-y-4 text-center py-2">
              <div className="flex justify-center">
                <CheckCircle2 className="h-10 w-10 text-green-600" />
              </div>
              <p className="text-sm text-muted-foreground">Heslo bylo úspěšně změněno.</p>
              <Button variant="outline" className="w-full" onClick={() => setDone(false)}>
                Změnit znovu
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-pw">Současné heslo</Label>
                <Input
                  id="current-pw"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-pw">Nové heslo</Label>
                <Input
                  id="new-pw"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Alespoň 8 znaků"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-pw">Nové heslo znovu</Label>
                <Input
                  id="confirm-pw"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Zopakujte nové heslo"
                  required
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={changePw.isPending || !currentPassword || !newPassword || !confirmPassword}
              >
                {changePw.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Ukládám…</>
                ) : (
                  "Změnit heslo"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
