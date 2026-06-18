import { Router, type IRouter, json } from "express";
import {
  getOpenAI,
  getOpenAIModel,
} from "@workspace/integrations-openai-ai-server";
import { ImportVehicleFromTpBody } from "@workspace/api-zod";
import { normalizeSpzOrNull } from "../lib/spz";

const router: IRouter = Router();

// TP-import accepts base64 photos, so it needs a larger body limit than the
// small global default. Mounted here (after the auth gate) to avoid pre-auth
// resource amplification.
const largeJson = json({ limit: "15mb" });

// Stored prompts can be configured to return plain JSON, but a model may still
// wrap it in a ```json fenced block. Strip an optional surrounding code fence so
// JSON.parse succeeds either way.
function stripJsonFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

const SYSTEM_PROMPT = `Jsi asistent pro autoservis. Z přiložených fotografií extrahuj údaje o vozidle. Fotografie mohou být různého typu a mohou se kombinovat:
- malý technický průkaz (osvědčení o registraci vozidla část I, Česká republika),
- fotografie registrační značky (SPZ) vozidla,
- fotografie VIN (výrobní štítek, ražba VIN na karoserii nebo VIN za čelním sklem),
- fotografie samotného vozidla,
- fotografie přístrojové desky (palubky) s ukazatelem počtu najetých kilometrů (tachometr).

Údaje ze všech fotografií spoj dohromady. Vrať POUZE platné JSON bez markdown bloku, bez vysvětlení.

Schéma odpovědi:
{
  "licensePlate": string|null,        // SPZ vozidla ve formátu "XXX XXXX" (3 znaky, mezera, 4 znaky), např. "5L1 1642"
  "vin": string|null,                 // VIN / číslo karoserie (přesně 17 znaků, písmena a čísla)
  "registrationYear": number|null,    // ROK první registrace (jen číslo, např. 2018)
  "engineDisplacement": number|null,  // objem motoru v cm³ (kubických cm)
  "make": string|null,                // výrobce / značka vozidla, např. "Volkswagen", "Škoda", "Renault"
  "model": string|null,               // model / typ vozidla, např. "Passat", "Octavia", "Mégane"
  "odometerKm": number|null,          // stav tachometru (počet najetých kilometrů) z fotografie přístrojové desky
  "ownerName": string|null,           // vlastník/provozovatel z TP: jméno a příjmení fyzické osoby, nebo název firmy
  "ownerIco": string|null,            // IČ (identifikační číslo) vlastníka/provozovatele, pokud je v TP uvedeno (8 číslic)
  "ownerAddress": string|null,        // adresa vlastníka/provozovatele jako jeden řetězec (ulice, číslo, město, PSČ)
  "color": string|null,               // barva vozidla uvedená v technickém průkazu (kolonka "Barva")
  "colorObserved": string|null,       // skutečná barva karoserie viditelná na fotografii vozidla
  "colorMismatch": boolean            // true jen když se barva z TP a barva z fotografie zjevně liší
}

Pravidla:
- Vrať pouze údaje, které jsou na fotografiích jednoznačně čitelné nebo jednoznačně určitelné. Jinak null.
- VIN musí mít přesně 17 znaků, jinak null. VIN můžeš přečíst z TP, z výrobního štítku, z ražby na karoserii i z VIN za čelním sklem.
- SPZ můžeš přečíst z TP i z fotografie registrační značky vozidla.
- Engine displacement: pokud vidíš objem v litrech (např. 2.0), převeď na cm³ (2000).
- registrationYear extrahuj POUZE rok (čtyřciferné číslo) z data první registrace.
- make: pouze název výrobce s velkým prvním písmenem (např. "Volkswagen", "Škoda"). Bez modelu.
- model: pouze označení modelu/typu (např. "Passat", "Octavia"). Výrobce do modelu nezahrnuj.
- odometerKm: stav tachometru čti POUZE z fotografie přístrojové desky (palubky). Vrať celé číslo v kilometrech bez mezer a jednotek (např. 185000). Pokud na fotografiích žádný tachometr není, vrať null. Ignoruj denní počítadlo (trip), které bývá menší a má desetinné místo.
- ownerName: vlastníka nebo provozovatele čti z technického průkazu. U fyzické osoby vrať jméno a příjmení, u firmy její název. Pokud není čitelný, vrať null.
- ownerIco: IČ (identifikační číslo organizace) vrať POUZE pokud je na TP uvedeno a má přesně 8 číslic. Bez IČ (fyzická osoba) vrať null.
- ownerAddress: adresu vlastníka/provozovatele vrať jako jeden řetězec (např. "Hlavní 123, 110 00 Praha"). Pokud není čitelná, vrať null.
- color: barvu vozidla čti z technického průkazu (kolonka "Barva"). Vrať český název barvy s velkým prvním písmenem (např. "Černá", "Bílá", "Modrá", "Stříbrná", "Šedá", "Červená", "Zelená"). Pokud TP není přiložen nebo barva není čitelná, vrať null.
- colorObserved: skutečnou barvu karoserie urči z fotografie vozidla (např. záď, bok, nebo fotka SPZ, na které je vidět karoserie). Vrať český název barvy s velkým prvním písmenem. Pokud žádná fotografie karoserie není, vrať null.
- colorMismatch: vrať true POUZE když máš barvu z TP (color) i barvu z fotografie (colorObserved) a tyto barvy si zjevně neodpovídají (jiná barva — ne jen rozdíl odstínu, lesku, metalízy nebo osvětlení). V ostatních případech vrať false.
- Další neuvedené údaje nevracej.`;

router.post("/vehicles/import-tp", largeJson, async (req, res): Promise<void> => {
  const parsed = ImportVehicleFromTpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const userText = "Extrahuj údaje o vozidle z těchto fotografií:";

    // Single inline path via the Responses API (Replit AI integration). The
    // prompt lives in code (SYSTEM_PROMPT) rather than a platform-managed stored
    // prompt — OpenAI is retiring stored prompts, so referencing one by ID is no
    // longer reliable. JSON mode + an explicit "return only JSON" instruction
    // keep the output parseable; stripJsonFences guards a stray code fence.
    const response = await getOpenAI().responses.create({
      model: getOpenAIModel(),
      max_output_tokens: 4096,
      text: { format: { type: "json_object" } },
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "input_text", text: userText },
            ...parsed.data.images.map((b64) => ({
              type: "input_image" as const,
              image_url: `data:image/jpeg;base64,${b64}`,
              detail: "auto" as const,
            })),
          ],
        },
      ],
    });
    const text = response.output_text?.trim() || "{}";

    let extracted: Record<string, unknown>;
    try {
      extracted = JSON.parse(stripJsonFences(text));
    } catch {
      req.log.error({ text }, "Failed to parse TP extraction JSON");
      res.status(502).json({ error: "Nepodařilo se zpracovat odpověď AI." });
      return;
    }

    const cleanStr = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : null;

    const cleanInt = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;

    // IČ must be exactly 8 digits; keep only digits before validating so a
    // value like "123 456 78" or "IČ 12345678" still normalizes correctly.
    const cleanIco = (v: unknown): string | null => {
      const digits = typeof v === "string" ? v.replace(/\D/g, "") : "";
      return digits.length === 8 ? digits : null;
    };

    const ownerName = cleanStr(extracted.ownerName);
    const ownerIco = cleanIco(extracted.ownerIco);
    const ownerAddress = cleanStr(extracted.ownerAddress);

    const color = cleanStr(extracted.color);
    const colorObserved = cleanStr(extracted.colorObserved);
    // Only claim a mismatch when both sources produced a color and the model
    // judged them clearly different — otherwise it's noise (no TP, no body photo).
    const colorMismatch = color != null && colorObserved != null && extracted.colorMismatch === true;

    res.json({
      licensePlate: normalizeSpzOrNull(extracted.licensePlate),
      vin: typeof extracted.vin === "string" && extracted.vin.length === 17 ? extracted.vin : null,
      registrationYear: typeof extracted.registrationYear === "number" ? extracted.registrationYear : null,
      engineDisplacement: typeof extracted.engineDisplacement === "number" ? extracted.engineDisplacement : null,
      make: cleanStr(extracted.make),
      model: cleanStr(extracted.model),
      odometerKm: cleanInt(extracted.odometerKm),
      ownerName,
      ownerIco,
      ownerAddress,
      ownerType: ownerIco ? "company" : "private",
      color,
      colorObserved,
      colorMismatch,
    });
  } catch (err) {
    req.log.error({ err }, "TP import failed");
    res.status(500).json({ error: "Import z technického průkazu selhal." });
  }
});

export default router;
