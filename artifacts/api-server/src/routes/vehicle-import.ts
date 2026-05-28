import { Router, type IRouter } from "express";
import { getOpenAI } from "@workspace/integrations-openai-ai-server";
import { ImportVehicleFromTpBody } from "@workspace/api-zod";

const router: IRouter = Router();

const SYSTEM_PROMPT = `Jsi asistent pro autoservis. Z fotografií malého technického průkazu (osvědčení o registraci vozidla část I, Česká republika) extrahuj následující údaje. Vrať POUZE platné JSON bez markdown bloku, bez vysvětlení.

Schéma odpovědi:
{
  "licensePlate": string|null,        // SPZ vozidla, např. "5L1 1642" (zachovej mezery)
  "make": string|null,                // tovární značka, např. "PEUGEOT"
  "model": string|null,               // obchodní označení / typ / varianta / verze
  "year": number|null,                // rok první registrace (jen pokud je jasně uvedeno)
  "color": string|null,               // barva vozidla česky, např. "BÍLÁ", "ČERNÁ"
  "vin": string|null,                 // VIN / číslo karoserie (17 znaků)
  "engineDisplacement": number|null,  // objem motoru v cm³ (kubických cm)
  "registrationDate": string|null,    // datum první registrace ve formátu YYYY-MM-DD
  "ownerName": string|null,           // jméno a příjmení vlastníka nebo provozovatele
  "ownerAddress": string|null         // adresa vlastníka (ulice, čp, město, PSČ)
}

Pravidla:
- Pokud údaj na fotografii nevidíš nebo si nejsi jistý, použij null.
- Datum vyplňuj přesně ve formátu YYYY-MM-DD.
- VIN musí mít 17 znaků (písmena/čísla), jinak null.
- Engine displacement: pokud vidíš objem v litrech (např. 2.0), převeď na cm³ (2000).
- Obojí strany TP mohou obsahovat různé údaje, zkombinuj je.`;

router.post("/vehicles/import-tp", async (req, res): Promise<void> => {
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
      model: "gpt-5.4",
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Extrahuj údaje z těchto fotografií malého technického průkazu:" },
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

    res.json({
      licensePlate: typeof extracted.licensePlate === "string" ? extracted.licensePlate : null,
      make: typeof extracted.make === "string" ? extracted.make : null,
      model: typeof extracted.model === "string" ? extracted.model : null,
      year: typeof extracted.year === "number" ? extracted.year : null,
      color: typeof extracted.color === "string" ? extracted.color : null,
      vin: typeof extracted.vin === "string" ? extracted.vin : null,
      engineDisplacement: typeof extracted.engineDisplacement === "number" ? extracted.engineDisplacement : null,
      registrationDate: typeof extracted.registrationDate === "string" ? extracted.registrationDate : null,
      ownerName: typeof extracted.ownerName === "string" ? extracted.ownerName : null,
      ownerAddress: typeof extracted.ownerAddress === "string" ? extracted.ownerAddress : null,
    });
  } catch (err) {
    req.log.error({ err }, "TP import failed");
    res.status(500).json({ error: "Import z technického průkazu selhal." });
  }
});

export default router;
