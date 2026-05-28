import { Router, type IRouter } from "express";
import { getOpenAI } from "@workspace/integrations-openai-ai-server";
import { ImportVehicleFromTpBody } from "@workspace/api-zod";

const router: IRouter = Router();

const SYSTEM_PROMPT = `Jsi asistent pro autoservis. Z fotografií malého technického průkazu (osvědčení o registraci vozidla část I, Česká republika) extrahuj POUZE následující jasně čitelné údaje. Vrať POUZE platné JSON bez markdown bloku, bez vysvětlení.

Schéma odpovědi:
{
  "licensePlate": string|null,        // SPZ vozidla, např. "5L1 1642" (zachovej mezery)
  "vin": string|null,                 // VIN / číslo karoserie (přesně 17 znaků, písmena a čísla)
  "registrationYear": number|null,    // ROK první registrace (jen číslo, např. 2018)
  "engineDisplacement": number|null   // objem motoru v cm³ (kubických cm)
}

Pravidla:
- Vrať pouze údaje, které jsou na fotografii jednoznačně čitelné. Jinak null.
- VIN musí mít přesně 17 znaků, jinak null.
- Engine displacement: pokud vidíš objem v litrech (např. 2.0), převeď na cm³ (2000).
- registrationYear extrahuj POUZE rok (čtyřciferné číslo) z data první registrace.
- Žádné další údaje (jméno, adresa, barva, značka, model) nevracej.`;

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
      max_completion_tokens: 4096,
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
      vin: typeof extracted.vin === "string" && extracted.vin.length === 17 ? extracted.vin : null,
      registrationYear: typeof extracted.registrationYear === "number" ? extracted.registrationYear : null,
      engineDisplacement: typeof extracted.engineDisplacement === "number" ? extracted.engineDisplacement : null,
    });
  } catch (err) {
    req.log.error({ err }, "TP import failed");
    res.status(500).json({ error: "Import z technického průkazu selhal." });
  }
});

export default router;
