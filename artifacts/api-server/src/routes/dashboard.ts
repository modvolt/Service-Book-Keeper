import { Router, type IRouter } from "express";
import { eq, gte, lte, and, count, sql } from "drizzle-orm";
import { db, vehiclesTable, workOrdersTable } from "@workspace/db";
import { photosTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now);
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalVehiclesResult] = await db.select({ count: count() }).from(vehiclesTable);
  const [openResult] = await db
    .select({ count: count() })
    .from(workOrdersTable)
    .where(eq(workOrdersTable.status, "open"));
  const [inProgressResult] = await db
    .select({ count: count() })
    .from(workOrdersTable)
    .where(eq(workOrdersTable.status, "in_progress"));
  const [completedMonthResult] = await db
    .select({ count: count() })
    .from(workOrdersTable)
    .where(
      and(
        eq(workOrdersTable.status, "completed"),
        gte(workOrdersTable.completedAt, startOfMonth),
      ),
    );

  const todayStr = now.toISOString().split("T")[0];
  const thirtyDaysStr = thirtyDaysFromNow.toISOString().split("T")[0];
  const [stkExpiringSoonResult] = await db
    .select({ count: count() })
    .from(vehiclesTable)
    .where(
      and(
        gte(vehiclesTable.stkValidUntil, todayStr),
        lte(vehiclesTable.stkValidUntil, thirtyDaysStr),
      ),
    );

  const recentWorkOrders = await db
    .select()
    .from(workOrdersTable)
    .orderBy(sql`${workOrdersTable.createdAt} desc`)
    .limit(8);

  // Attach photos to recent work orders
  const withPhotos = await Promise.all(
    recentWorkOrders.map(async (wo) => {
      const photos = await db
        .select()
        .from(photosTable)
        .where(eq(photosTable.workOrderId, wo.id));
      return { ...wo, photos };
    }),
  );

  res.json({
    totalVehicles: totalVehiclesResult.count,
    openWorkOrders: openResult.count,
    inProgressWorkOrders: inProgressResult.count,
    completedThisMonth: completedMonthResult.count,
    stkExpiringSoon: stkExpiringSoonResult.count,
    recentWorkOrders: withPhotos,
  });
});

export default router;
