import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, logbookEntriesTable } from "@workspace/db";
import {
  CreateLogbookEntryBody,
  UpdateLogbookEntryParams,
  UpdateLogbookEntryBody,
  DeleteLogbookEntryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/logbook", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(logbookEntriesTable)
    .orderBy(desc(logbookEntriesTable.entryDate), desc(logbookEntriesTable.id));
  res.json(rows);
});

router.post("/logbook", async (req, res): Promise<void> => {
  const parsed = CreateLogbookEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [row] = await db.insert(logbookEntriesTable).values({
    entryDate: parsed.data.entryDate,
    title: parsed.data.title,
    content: parsed.data.content ?? null,
  }).returning();
  res.status(201).json(row);
});

router.patch("/logbook/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const params = UpdateLogbookEntryParams.safeParse({ id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateLogbookEntryBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const data: Partial<typeof logbookEntriesTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.entryDate) data.entryDate = parsed.data.entryDate;
  if (parsed.data.title) data.title = parsed.data.title;
  if (parsed.data.content !== undefined) data.content = parsed.data.content;

  const [row] = await db.update(logbookEntriesTable).set(data)
    .where(eq(logbookEntriesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Záznam nenalezen" }); return; }
  res.json(row);
});

router.delete("/logbook/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const params = DeleteLogbookEntryParams.safeParse({ id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  await db.delete(logbookEntriesTable).where(eq(logbookEntriesTable.id, params.data.id));
  res.status(204).end();
});

export default router;
