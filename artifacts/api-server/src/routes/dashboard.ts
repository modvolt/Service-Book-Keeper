import { Router, type IRouter } from "express";
import { eq, ne, gte, lte, and, count, sql, isNull } from "drizzle-orm";
import { db, vehiclesTable, workOrdersTable } from "@workspace/db";
import { photosTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const now = new Date();
  const thirtyDaysFromNow = new Date(now);
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalVehiclesResult] = await db
    .select({ count: count() })
    .from(vehiclesTable)
    .where(isNull(vehiclesTable.deletedAt));
  const [openResult] = await db
    .select({ count: count() })
    .from(workOrdersTable)
    .where(and(ne(workOrdersTable.status, "completed"), isNull(workOrdersTable.deletedAt)));
  const [inProgressResult] = await db
    .select({ count: count() })
    .from(workOrdersTable)
    .where(and(eq(workOrdersTable.status, "in_progress"), isNull(workOrdersTable.deletedAt)));
  const [completedMonthResult] = await db
    .select({ count: count() })
    .from(workOrdersTable)
    .where(
      and(
        eq(workOrdersTable.status, "completed"),
        gte(workOrdersTable.completedAt, startOfMonth),
        isNull(workOrdersTable.deletedAt),
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
        isNull(vehiclesTable.deletedAt),
      ),
    );

  const recentWorkOrders = await db
    .select({
      order: workOrdersTable,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      ownerName: vehiclesTable.ownerName,
    })
    .from(workOrdersTable)
    .leftJoin(vehiclesTable, eq(workOrdersTable.vehicleId, vehiclesTable.id))
    .where(isNull(workOrdersTable.deletedAt))
    .orderBy(sql`${workOrdersTable.createdAt} desc`)
    .limit(8);

  // Attach vehicle make/model, owner name and photos to recent work orders
  const withPhotos = await Promise.all(
    recentWorkOrders.map(async (r) => {
      const photos = await db
        .select()
        .from(photosTable)
        .where(and(eq(photosTable.workOrderId, r.order.id), isNull(photosTable.deletedAt)));
      return { ...r.order, make: r.make ?? null, model: r.model ?? null, ownerName: r.ownerName ?? null, photos };
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
