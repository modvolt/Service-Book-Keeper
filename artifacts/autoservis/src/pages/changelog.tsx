import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { History, Sparkles } from "lucide-react";

type ChangeEntry = {
  version: string;
  date: string;
  title: string;
  changes: string[];
};

const CHANGELOG: ChangeEntry[] = [
  {
    version: "1.1",
    date: "30. 5. 2026",
    title: "Zálohování dat",
    changes: [
      "Nová sekce Zálohování dat v Nastavení.",
      "Stažení kompletní zálohy všech dat do souboru a obnova ze zálohy.",
      "Čitelný PDF přehled všech vozidel, zakázek, servisní historie a skladu k tisku nebo uložení.",
      "Záznam změn dostupný v levém menu.",
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <History className="h-6 w-6" /> Záznam změn
        </h1>
        <p className="text-muted-foreground">Přehled novinek a úprav v aplikaci.</p>
      </div>

      <div className="space-y-4">
        {CHANGELOG.map((entry) => (
          <Card key={entry.version}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  {entry.title}
                </CardTitle>
                <div className="flex items-center gap-2 text-sm">
                  <span className="rounded-full bg-primary/10 text-primary px-2.5 py-0.5 font-medium">
                    verze {entry.version}
                  </span>
                  <span className="text-muted-foreground">{entry.date}</span>
                </div>
              </div>
              <CardDescription className="sr-only">{entry.title}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {entry.changes.map((c, i) => (
                  <li key={i} className="flex gap-2 text-sm">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                    <span>{c}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
