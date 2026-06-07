import { Router, type IRouter, json } from "express";
import { getOpenAI, getOpenAIModel } from "@workspace/integrations-openai-ai-server";
import { ImportVehicleFromTpBody } from "@workspace/api-zod";
import { normalizeSpzOrNull } from "../lib/spz";

const router: IRouter = Router();

// TP-import accepts base64 photos, so it needs a larger body limit than the
// small global default. Mounted here (after the auth gate) to avoid pre-auth
// resource amplification.
const largeJson = json({ limit: "15mb" });

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
  "odometerKm": number|null           // stav tachometru (počet najetých kilometrů) z fotografie přístrojové desky
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
- Jiné údaje (jméno, adresa, barva) nevracej.`;

router.post("/vehicles/import-tp", largeJson, async (req, res): Promise<void> => {
  const parsed = ImportVehicleFromTpBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const imageContents = parsed.data.images.map((b64) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/jpeg;base64,${b64}` },
    }));

    const response = await getOpenAI().chat.completions.create({
      model: getOpenAIModel(),
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Extrahuj údaje o vozidle z těchto fotografií:" },
            ...imageContents,
          ],
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "{}";
    let extracted: Record<string, unknown>;
    try {
      extracted = JSON.parse(text);
    } catch {
      req.log.error({ text }, "Failed to parse TP extraction JSON");
      res.status(502).json({ error: "Nepodařilo se zpracovat odpověď AI." });
      return;
    }

    const cleanStr = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : null;

    const cleanInt = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null;

    res.json({
      licensePlate: normalizeSpzOrNull(extracted.licensePlate),
      vin: typeof extracted.vin === "string" && extracted.vin.length === 17 ? extracted.vin : null,
      registrationYear: typeof extracted.registrationYear === "number" ? extracted.registrationYear : null,
      engineDisplacement: typeof extracted.engineDisplacement === "number" ? extracted.engineDisplacement : null,
      make: cleanStr(extracted.make),
      model: cleanStr(extracted.model),
      odometerKm: cleanInt(extracted.odometerKm),
    });
  } catch (err) {
    req.log.error({ err }, "TP import failed");
    res.status(500).json({ error: "Import z technického průkazu selhal." });
  }
});

export default router;
