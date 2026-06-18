import { Router, type IRouter, json } from "express";
import { eq, ilike, ne, and, inArray } from "drizzle-orm";
import { db, materialsCatalogTable, workOrdersTable, vehiclesTable } from "@workspace/db";
import { getOpenAI, getOpenAIModel } from "@workspace/integrations-openai-ai-server";
import { normalizeSpzOrNull } from "../lib/spz";
import { z } from "zod";

const router: IRouter = Router();

// Scan-materials accepts base64 photos that can exceed the small global default.
// Mounted after the auth gate to avoid pre-auth resource amplification.
const largeJson = json({ limit: "15mb" });

const ScanMaterialsBody = z.object({
  licensePlate: z.string().min(1),
  workOrderId: z.number().int().positive().optional().nullable(),
  images: z.array(z.string()).min(0).max(8),
  qrMaterialIds: z.array(z.number().int().positive()).optional(),
}).refine(
  (d) => d.images.length > 0 || (d.qrMaterialIds && d.qrMaterialIds.length > 0),
  { message: "Musí být nahrazen alespoň jeden obrázek nebo QR kód." },
);

const SCAN_SYSTEM_PROMPT = `Jsi asistent pro autoservis. Z přiložených fotografií (obaly, etikety, nádoby, díly) identifikuj autodíly a spotřební materiál. Vrať POUZE platné JSON bez markdown bloku.

Schéma odpovědi:
{
  "items": [
    {
      "name": string,       // název dílu/materiálu česky, např. "Motorový olej 5W-40", "Vzduchový filtr"
      "quantity": string,   // množství jako řetězec, např. "1", "2", "4.5"
      "unit": string|null   // jednotka (ks, l, kg, m) nebo null
    }
  ]
}

Pravidla:
- Identifikuj pouze reálné fyzické autodíly a spotřební materiál (oleje, filtry, brzdové destičky, atd.).
- Pokud nevidíš žádné identifikovatelné díly, vrať { "items": [] }.
- Nevymýšlej položky, které na fotografiích nejsou.`;

// TODO: swap requireAuth for requireScannerOrAdmin once Task A (Scanner role middleware) is merged.
router.post("/work-orders/scan-materials", largeJson, async (req, res): Promise<void> => {
  const parsed = ScanMaterialsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const normalizedPlate = normalizeSpzOrNull(parsed.data.licensePlate);
  if (!normalizedPlate) {
    res.status(400).json({ error: "Neplatná SPZ." });
    return;
  }

  // Resolve the vehicle
  const [vehicle] = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(ilike(vehiclesTable.licensePlate, normalizedPlate));

  let openOrder: { id: number } | undefined;

  if (parsed.data.workOrderId) {
    // Caller selected a specific order — validate it is open and belongs to this vehicle/SPZ
    const [candidate] = await db
      .select({ id: workOrdersTable.id, vehicleId: workOrdersTable.vehicleId, licensePlate: workOrdersTable.licensePlate, status: workOrdersTable.status })
      .from(workOrdersTable)
      .where(eq(workOrdersTable.id, parsed.data.workOrderId));

    if (!candidate || candidate.status === "completed") {
      res.status(404).json({ error: "Vybraná zakázka není otevřená." });
      return;
    }

    const orderMatchesVehicle = vehicle && candidate.vehicleId === vehicle.id;
    const orderMatchesPlate = (candidate.licensePlate ?? "").replace(/\s+/g, "").toUpperCase() === normalizedPlate.toUpperCase();
    if (!orderMatchesVehicle && !orderMatchesPlate) {
      res.status(404).json({ error: "Vybraná zakázka nepatří k tomuto vozidlu." });
      return;
    }

    openOrder = { id: candidate.id };
  } else {
    // Auto-select: find any open work order for this plate — via vehicleId link or SPZ match.
    // All non-completed statuses count as open for scan purposes.
    if (vehicle) {
      const rows = await db
        .select({ id: workOrdersTable.id })
        .from(workOrdersTable)
        .where(
          and(
            eq(workOrdersTable.vehicleId, vehicle.id),
            ne(workOrdersTable.status, "completed"),
          ),
        )
        .limit(1);
      openOrder = rows[0];
    }

    // Fall back to SPZ-only match if vehicle not in DB or no vehicleId-linked order found
    if (!openOrder) {
      const rows = await db
        .select({ id: workOrdersTable.id })
        .from(workOrdersTable)
        .where(
          and(
            ilike(workOrdersTable.licensePlate, normalizedPlate),
            ne(workOrdersTable.status, "completed"),
          ),
        )
        .limit(1);
      openOrder = rows[0];
    }
  }

  if (!openOrder) {
    res.status(404).json({ error: "Pro toto vozidlo neexistuje otevřená zakázka." });
    return;
  }

  try {
    // Fetch catalog once for fuzzy matching (AI path) and QR lookups
    const catalog = await db
      .select({
        id: materialsCatalogTable.id,
        name: materialsCatalogTable.name,
        unit: materialsCatalogTable.unit,
        defaultPrice: materialsCatalogTable.defaultPrice,
        askQuantityOnScan: materialsCatalogTable.askQuantityOnScan,
      })
      .from(materialsCatalogTable);

    // ── QR-detected items ───────────────────────────────────────────────────
    const qrIds = parsed.data.qrMaterialIds ?? [];
    const qrSuggestions: {
      name: string;
      quantity: string;
      unit: string | null;
      unitPrice: number | null;
      catalogId: number | null;
      askQuantityOnScan: boolean;
      source: "ai" | "qr";
    }[] = [];

    if (qrIds.length > 0) {
      const qrItems = await db
        .select({
          id: materialsCatalogTable.id,
          name: materialsCatalogTable.name,
          unit: materialsCatalogTable.unit,
          defaultPrice: materialsCatalogTable.defaultPrice,
          askQuantityOnScan: materialsCatalogTable.askQuantityOnScan,
        })
        .from(materialsCatalogTable)
        .where(inArray(materialsCatalogTable.id, qrIds));

      // Preserve the order from the client-supplied ID list, dedup by ID
      const seen = new Set<number>();
      for (const id of qrIds) {
        if (seen.has(id)) continue;
        seen.add(id);
        const item = qrItems.find((r) => r.id === id);
        if (!item) continue;
        qrSuggestions.push({
          name: item.name,
          quantity: "1",
          unit: item.unit ?? null,
          unitPrice: item.defaultPrice ?? null,
          catalogId: item.id,
          askQuantityOnScan: item.askQuantityOnScan,
          source: "qr",
        });
      }
    }

    // ── AI-analysed items (images array contains only non-QR photos) ─────────
    // Client-side: only images that did NOT contain a QR code are forwarded to AI.
    const rawItems: unknown[] = [];

    if (parsed.data.images.length > 0) {
      const imageContents = parsed.data.images.map((b64) => ({
        type: "image_url" as const,
        image_url: { url: `data:image/jpeg;base64,${b64}` },
      }));

      const response = await getOpenAI().chat.completions.create({
        model: getOpenAIModel(),
        max_completion_tokens: 4096,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SCAN_SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Identifikuj díly a materiál z těchto fotografií:" },
              ...imageContents,
            ],
          },
        ],
      });

      const text = response.choices[0]?.message?.content ?? '{"items":[]}';
      let extracted: { items?: unknown };
      try {
        extracted = JSON.parse(text);
      } catch {
        req.log.error({ text }, "Scan-materials JSON parse failed");
        res.status(502).json({ error: "Nepodařilo se zpracovat odpověď AI." });
        return;
      }

      if (Array.isArray(extracted.items)) rawItems.push(...extracted.items);
    }

    const aiSuggestions = (
      await Promise.all(
        rawItems.map(async (raw: unknown) => {
          const it = raw as Record<string, unknown>;
          const name = typeof it.name === "string" ? it.name.trim() : "";
          if (!name) return null;

          const rawQ =
            typeof it.quantity === "string"
              ? it.quantity.trim().replace(",", ".")
              : typeof it.quantity === "number"
              ? String(it.quantity)
              : "1";
          const qNum = parseFloat(rawQ);
          const quantity = Number.isFinite(qNum) && qNum > 0 ? String(qNum) : "1";
          const unit = typeof it.unit === "string" && it.unit ? it.unit : null;

          // Fuzzy catalog match via ilike on the extracted name
          const hits = await db
            .select({
              id: materialsCatalogTable.id,
              unit: materialsCatalogTable.unit,
              defaultPrice: materialsCatalogTable.defaultPrice,
              askQuantityOnScan: materialsCatalogTable.askQuantityOnScan,
            })
            .from(materialsCatalogTable)
            .where(ilike(materialsCatalogTable.name, `%${name}%`))
            .limit(1);

          const hit = hits[0];
          return {
            name,
            quantity,
            unit: hit?.unit ?? unit,
            unitPrice: hit?.defaultPrice ?? null,
            catalogId: hit?.id ?? null,
            askQuantityOnScan: hit?.askQuantityOnScan ?? false,
            source: "ai" as const,
          };
        }),
      )
    ).filter((x) => x !== null) as {
      name: string;
      quantity: string;
      unit: string | null;
      unitPrice: number | null;
      catalogId: number | null;
      askQuantityOnScan: boolean;
      source: "ai" | "qr";
    }[];

    // QR items first, then AI items
    const suggestions = [...qrSuggestions, ...aiSuggestions];

    res.json({ workOrderId: openOrder.id, suggestions });
  } catch (err) {
    req.log.error({ err }, "Scan-materials failed");
    res.status(500).json({ error: "Sken materiálu selhal." });
  }
});

export default router;
