import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Admin users (owner or staff member with a login). Clients don't log in.
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["owner", "staff"] }).notNull().default("staff"),
  businessId: uuid("business_id").references(() => businesses.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const businesses = pgTable("businesses", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Asia/Almaty"),
  currency: text("currency").notNull().default("KZT"),
  // How long a picked slot is held in Redis before checkout expires
  holdTtlSec: integer("hold_ttl_sec").notNull().default(300),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Opening hours per ISO weekday (1 = Monday … 7 = Sunday). No row = closed.
export const businessHours = pgTable(
  "business_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(), // 1-7 ISO
    openTime: time("open_time").notNull(), // local wall time, e.g. 09:00
    closeTime: time("close_time").notNull(),
  },
  (t) => [uniqueIndex("business_hours_unique").on(t.businessId, t.weekday)],
);

export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id), // optional login for this master
  name: text("name").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Personal schedule overriding business hours. No rows = inherits business hours.
export const staffHours = pgTable(
  "staff_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    staffId: uuid("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
    weekday: smallint("weekday").notNull(), // 1-7 ISO
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
  },
  (t) => [uniqueIndex("staff_hours_unique").on(t.staffId, t.weekday)],
);

export const services = pgTable("services", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  durationMin: integer("duration_min").notNull(),
  priceKzt: integer("price_kzt").notNull(),
  isActive: boolean("is_active").notNull().default(true),
});

// Which masters perform which services (M:N)
export const staffServices = pgTable(
  "staff_services",
  {
    staffId: uuid("staff_id").notNull().references(() => staff.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.serviceId] })],
);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("clients_business_phone_unique").on(t.businessId, t.phone)],
);

export const bookingStatuses = ["confirmed", "completed", "cancelled", "no_show"] as const;
export type BookingStatus = (typeof bookingStatuses)[number];

// Overlap protection lives in the DB too: an EXCLUDE USING gist constraint on
// (staff_id, tstzrange(start_at, end_at)) WHERE status = 'confirmed' is added
// in a hand-written migration — Redis holds are the first line, this is the last.
export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  staffId: uuid("staff_id").notNull().references(() => staff.id),
  serviceId: uuid("service_id").notNull().references(() => services.id),
  clientId: uuid("client_id").notNull().references(() => clients.id),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  status: text("status", { enum: bookingStatuses }).notNull().default("confirmed"),
  priceKzt: integer("price_kzt").notNull(), // snapshot of service price at booking time
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessId: uuid("business_id").notNull().references(() => businesses.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  action: text("action").notNull(), // e.g. booking.create, booking.cancel, service.update
  entity: text("entity").notNull(),
  entityId: uuid("entity_id"),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
