import { Router, type IRouter, json } from "express";
import { eq, ilike, asc, sql } from "drizzle-orm";
import { db, materialsCatalogTable, workOrderMaterialsTable, workOrdersTable } from "@workspace/db";
import { getOpenAI, getOpenAIModel } from "@workspace/integrations-openai-ai-server";
import {
  CreateMaterialBody,
  AddWorkOrderMaterialBody,
  UpdateWorkOrderMaterialBody,
  ImportInvoiceForWorkOrderBody,
  ImportMaterialsBody,
  ListMaterialsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/materials", async (req, res): Promise<void> => {
  const query = ListMaterialsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const rows = query.data.search
    ? await db.select().from(materialsCatalogTable)
        .where(ilike(materialsCatalogTable.name, `%${query.data.search}%`))
        .orderBy(asc(materialsCatalogTable.name))
    : await db.select().from(materialsCatalogTable).orderBy(asc(materialsCatalogTable.name));

  res.json(rows);
});

router.post("/materials", async (req, res): Promise<void> => {
  const parsed = CreateMaterialBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  try {
    const [item] = await db.insert(materialsCatalogTable).values({
      name: parsed.data.name.trim(),
      productNumber: parsed.data.productNumber?.trim() || null,
      unit: parsed.data.unit ?? null,
      defaultPrice: parsed.data.defaultPrice ?? null,
      supplier: parsed.data.supplier?.trim() || null,
    }).returning();
    res.status(201).json(item);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      res.status(409).json({ error: "Materiál s tímto názvem už existuje." });
      return;
    }
    req.log.error({ err }, "Material insert failed");
    res.status(500).json({ error: "Materiál se nepodařilo uložit." });
  }
});

// Bulk import accepts up to 5000 rows, which can exceed the small global body
// limit; mounted here (after the auth gate) with a larger parser.
const importJson = json({ limit: "10mb" });

router.post("/materials/import", importJson, async (req, res): Promise<void> => {
  const parsed = ImportMaterialsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  let skipped = 0;
  // Normalize and drop empty rows. Dedupe within the file: product number is the
  // preferred key (price lists are keyed by it), name is the fallback.
  type ImportRow = { name: string; productNumber: string | null; unit: string | null; defaultPrice: number | null; supplier: string | null };
  const byKey = new Map<string, ImportRow>();
  for (const raw of parsed.data.items) {
    const name = raw.name?.trim() ?? "";
    if (!name) { skipped++; continue; }
    const productNumber = raw.productNumber?.trim() || null;
    const key = productNumber ? `pn:${productNumber.toLowerCase()}` : `nm:${name.toLowerCase()}`;
    byKey.set(key, {
      name,
      productNumber,
      unit: raw.unit?.trim() || null,
      defaultPrice: typeof raw.defaultPrice === "number" && Number.isFinite(raw.defaultPrice) ? Math.round(raw.defaultPrice) : null,
      supplier: raw.supplier?.trim() || null,
    });
  }

  const rows = Array.from(byKey.values());
  if (rows.length === 0) { res.json({ imported: 0, updated: 0, skipped }); return; }

  try {
    const result = await db.transaction(async (tx) => {
      // Pull existing items so we can match price-list rows by product number first
      // (stable across suppliers/renames), then fall back to a case-insensitive name.
      const existing = await tx.select({
        id: materialsCatalogTable.id,
        name: materialsCatalogTable.name,
        productNumber: materialsCatalogTable.productNumber,
      }).from(materialsCatalogTable);
      const byProductNumber = new Map<string, number>();
      const byNameLower = new Map<string, number>();
      for (const e of existing) {
        if (e.productNumber) byProductNumber.set(e.productNumber.toLowerCase(), e.id);
        byNameLower.set(e.name.toLowerCase(), e.id);
      }

      let imported = 0;
      let updated = 0;
      for (const row of rows) {
        const matchId =
          (row.productNumber ? byProductNumber.get(row.productNumber.toLowerCase()) : undefined)
          ?? byNameLower.get(row.name.toLowerCase());

        if (matchId !== undefined) {
          // Only overwrite fields the import actually provides (coalesce keeps
          // existing values otherwise). Name is left as-is to avoid colliding with
          // the case-insensitive name unique index.
          await tx.update(materialsCatalogTable)
            .set({
              productNumber: sql`coalesce(${row.productNumber}, ${materialsCatalogTable.productNumber})`,
              unit: sql`coalesce(${row.unit}, ${materialsCatalogTable.unit})`,
              defaultPrice: sql`coalesce(${row.defaultPrice}, ${materialsCatalogTable.defaultPrice})`,
              supplier: sql`coalesce(${row.supplier}, ${materialsCatalogTable.supplier})`,
            })
            .where(eq(materialsCatalogTable.id, matchId));
          // Keep the product-number lookup in sync so later rows in the same import resolve correctly.
          if (row.productNumber) byProductNumber.set(row.productNumber.toLowerCase(), matchId);
          updated++;
        } else {
          const [inserted] = await tx.insert(materialsCatalogTable)
            .values({ name: row.name, productNumber: row.productNumber, unit: row.unit, defaultPrice: row.defaultPrice, supplier: row.supplier })
            .returning({ id: materialsCatalogTable.id });
          if (inserted) {
            if (row.productNumber) byProductNumber.set(row.productNumber.toLowerCase(), inserted.id);
            byNameLower.set(row.name.toLowerCase(), inserted.id);
          }
          imported++;
        }
      }
      return { imported, updated };
    });

    res.json({ ...result, skipped });
  } catch (err) {
    req.log.error({ err }, "Materials import failed");
    res.status(500).json({ error: "Import ceníku selhal." });
  }
});

router.delete("/materials/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [row] = await db.delete(materialsCatalogTable).where(eq(materialsCatalogTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Materiál nenalezen" }); return; }
  res.sendStatus(204);
});

router.get("/work-orders/:id/materials", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [order] = await db.select({ id: workOrdersTable.id }).from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Zakázka nenalezena" }); return; }
  const rows = await db.select().from(workOrderMaterialsTable)
    .where(eq(workOrderMaterialsTable.workOrderId, id))
    .orderBy(asc(workOrderMaterialsTable.createdAt));
  res.json(rows);
});

router.post("/work-orders/:id/materials", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = AddWorkOrderMaterialBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [order] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Zakázka nenalezena" }); return; }

  // Normalize quantity: accept Czech comma decimals, fall back to "1" for invalid input
  const rawQty = parsed.data.quantity?.toString().trim().replace(",", ".") ?? "1";
  const qtyNum = parseFloat(rawQty);
  const normalizedQty = Number.isFinite(qtyNum) && qtyNum > 0 ? String(qtyNum) : "1";

  const [row] = await db.insert(workOrderMaterialsTable).values({
    workOrderId: id,
    name: parsed.data.name.trim(),
    quantity: normalizedQty,
    unit: parsed.data.unit ?? null,
    unitPrice: parsed.data.unitPrice ?? null,
  }).returning();

  // Auto-add to catalog if it doesn't exist (case-insensitive)
  try {
    const existing = await db.select().from(materialsCatalogTable)
      .where(ilike(materialsCatalogTable.name, parsed.data.name.trim()));
    if (existing.length === 0) {
      await db.insert(materialsCatalogTable).values({
        name: parsed.data.name.trim(),
        unit: parsed.data.unit ?? null,
        defaultPrice: parsed.data.unitPrice ?? null,
      }).onConflictDoNothing();
    }
  } catch (err) {
    req.log.warn({ err }, "Auto-add to catalog failed");
  }

  res.status(201).json(row);
});

router.patch("/work-order-materials/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = UpdateWorkOrderMaterialBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updates: { quantity?: string; unit?: string | null; unitPrice?: number | null } = {};

  if (parsed.data.quantity !== undefined) {
    // Normalize quantity: accept Czech comma decimals, fall back to "1" for invalid input
    const rawQty = parsed.data.quantity.toString().trim().replace(",", ".");
    const qtyNum = parseFloat(rawQty);
    updates.quantity = Number.isFinite(qtyNum) && qtyNum > 0 ? String(qtyNum) : "1";
  }
  if (parsed.data.unit !== undefined) updates.unit = parsed.data.unit ?? null;
  if (parsed.data.unitPrice !== undefined) updates.unitPrice = parsed.data.unitPrice ?? null;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Žádné změny k uložení." });
    return;
  }

  const [row] = await db.update(workOrderMaterialsTable)
    .set(updates)
    .where(eq(workOrderMaterialsTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Položka nenalezena" }); return; }
  res.json(row);
});

router.delete("/work-order-materials/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
  const [row] = await db.delete(workOrderMaterialsTable).where(eq(workOrderMaterialsTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Položka nenalezena" }); return; }
  res.sendStatus(204);
});

const INVOICE_SYSTEM_PROMPT = `Jsi asistent pro autoservis. Z fotografie dodacího listu, faktury, paragonu nebo účtenky za autodíly extrahuj jednotlivé položky (materiál/díly). Vrať POUZE platné JSON bez markdown bloku.

Schéma odpovědi:
{
  "items": [
    {
      "name": string,            // název dílu/materiálu česky, např. "Brzdové destičky přední"
      "quantity": string,        // množství jako řetězec, např. "2", "1.5", "4"
      "unit": string|null,       // jednotka (ks, l, kg, m) nebo null
      "unitPrice": number|null   // cena za jednotku v Kč (celé číslo, bez DPH pokud je rozlišeno)
    }
  ]
}

Pravidla:
- Vynech řádky, které nejsou materiál (doprava, sleva, mezisoučty, DPH, "Celkem", "K úhradě").
- Když si nejsi jistý položkou, raději ji vynech.
- Ceny zaokrouhli na celé Kč.
- Pokud nevidíš žádné položky, vrať { "items": [] }.`;

router.post("/work-orders/:id/import-invoice", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const parsed = ImportInvoiceForWorkOrderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [order] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Zakázka nenalezena" }); return; }

  const images = parsed.data.images ?? [];
  const pdfs = parsed.data.pdfs ?? [];
  if (images.length === 0 && pdfs.length === 0) {
    res.status(400).json({ error: "Nahrajte alespoň jeden obrázek nebo PDF." });
    return;
  }

  try {
    const imageContents = images.map((b64) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/jpeg;base64,${b64}` },
    }));
    const pdfContents = pdfs.map((p, i) => ({
      type: "file" as const,
      file: {
        filename: p.filename ?? `faktura-${i + 1}.pdf`,
        file_data: `data:application/pdf;base64,${p.data}`,
      },
    }));

    const response = await getOpenAI().chat.completions.create({
      model: getOpenAIModel(),
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: INVOICE_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Extrahuj položky materiálu z této faktury / dodacího listu:" },
            ...pdfContents,
            ...imageContents,
          ],
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? '{"items":[]}';
    let extracted: { items?: unknown };
    try { extracted = JSON.parse(text); } catch {
      req.log.error({ text }, "Invoice JSON parse failed");
      res.status(502).json({ error: "Nepodařilo se zpracovat odpověď AI." });
      return;
    }

    const items = Array.isArray(extracted.items) ? extracted.items : [];
    const cleaned = items
      .map((raw: unknown) => {
        const it = raw as Record<string, unknown>;
        const name = typeof it.name === "string" ? it.name.trim() : "";
        if (!name) return null;
        const rawQ = typeof it.quantity === "string"
          ? it.quantity.trim().replace(",", ".")
          : typeof it.quantity === "number"
          ? String(it.quantity)
          : "1";
        const qNum = parseFloat(rawQ);
        const quantity = Number.isFinite(qNum) && qNum > 0 ? String(qNum) : "1";
        const unit = typeof it.unit === "string" && it.unit ? it.unit : null;
        const unitPrice = typeof it.unitPrice === "number" ? Math.round(it.unitPrice) : null;
        return { name, quantity, unit, unitPrice };
      })
      .filter((x): x is { name: string; quantity: string; unit: string | null; unitPrice: number | null } => x !== null);

    res.json({ items: cleaned });
  } catch (err) {
    req.log.error({ err }, "Invoice import failed");
    res.status(500).json({ error: "Import faktury selhal." });
  }
});

export default router;
