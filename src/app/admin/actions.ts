"use server";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema as s } from "@/db";
import { setBookingStatus } from "@/lib/booking";
import { requireSession } from "@/lib/session";

export async function updateBookingStatus(formData: FormData): Promise<void> {
  const session = await requireSession();
  const bookingId = String(formData.get("bookingId"));
  const status = String(formData.get("status")) as "completed" | "cancelled" | "no_show";
  if (!["completed", "cancelled", "no_show"].includes(status)) return;
  await setBookingStatus({
    businessId: session.businessId,
    bookingId,
    status,
    actorUserId: session.userId,
  });
  revalidatePath("/admin");
}

export async function saveService(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = formData.get("id") ? String(formData.get("id")) : null;
  const values = {
    name: String(formData.get("name") ?? "").trim(),
    durationMin: Number(formData.get("durationMin")),
    priceKzt: Number(formData.get("priceKzt")),
  };
  if (!values.name || !Number.isFinite(values.durationMin) || !Number.isFinite(values.priceKzt)) return;

  if (id) {
    await db
      .update(s.services)
      .set(values)
      .where(and(eq(s.services.id, id), eq(s.services.businessId, session.businessId)));
  } else {
    await db.insert(s.services).values({ ...values, businessId: session.businessId });
  }
  await db.insert(s.auditLog).values({
    businessId: session.businessId,
    actorUserId: session.userId,
    action: id ? "service.update" : "service.create",
    entity: "service",
    entityId: id,
    meta: values,
  });
  revalidatePath("/admin/services");
}

export async function toggleService(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("id"));
  const [svc] = await db
    .select()
    .from(s.services)
    .where(and(eq(s.services.id, id), eq(s.services.businessId, session.businessId)));
  if (!svc) return;
  await db.update(s.services).set({ isActive: !svc.isActive }).where(eq(s.services.id, id));
  revalidatePath("/admin/services");
}

export async function saveStaff(formData: FormData): Promise<void> {
  const session = await requireSession();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await db.insert(s.staff).values({ businessId: session.businessId, name });
  await db.insert(s.auditLog).values({
    businessId: session.businessId,
    actorUserId: session.userId,
    action: "staff.create",
    entity: "staff",
    meta: { name },
  });
  revalidatePath("/admin/staff");
}

export async function toggleStaff(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = String(formData.get("id"));
  const [row] = await db
    .select()
    .from(s.staff)
    .where(and(eq(s.staff.id, id), eq(s.staff.businessId, session.businessId)));
  if (!row) return;
  await db.update(s.staff).set({ isActive: !row.isActive }).where(eq(s.staff.id, id));
  revalidatePath("/admin/staff");
}

export async function toggleStaffService(formData: FormData): Promise<void> {
  const session = await requireSession();
  const staffId = String(formData.get("staffId"));
  const serviceId = String(formData.get("serviceId"));
  // both must belong to this business
  const [st] = await db
    .select()
    .from(s.staff)
    .where(and(eq(s.staff.id, staffId), eq(s.staff.businessId, session.businessId)));
  const [svc] = await db
    .select()
    .from(s.services)
    .where(and(eq(s.services.id, serviceId), eq(s.services.businessId, session.businessId)));
  if (!st || !svc) return;
  const [link] = await db
    .select()
    .from(s.staffServices)
    .where(and(eq(s.staffServices.staffId, staffId), eq(s.staffServices.serviceId, serviceId)));
  if (link) {
    await db
      .delete(s.staffServices)
      .where(and(eq(s.staffServices.staffId, staffId), eq(s.staffServices.serviceId, serviceId)));
  } else {
    await db.insert(s.staffServices).values({ staffId, serviceId });
  }
  revalidatePath("/admin/staff");
}
