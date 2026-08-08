-- Double-booking protection at the database level.
-- Redis slot holds are the first line of defense; this constraint is the last:
-- no two confirmed bookings for the same master may overlap in time.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "staff_id" WITH =,
    tstzrange("start_at", "end_at") WITH &&
  )
  WHERE ("status" = 'confirmed');
--> statement-breakpoint
CREATE INDEX "bookings_business_start_idx" ON "bookings" ("business_id", "start_at");
--> statement-breakpoint
CREATE INDEX "audit_log_business_created_idx" ON "audit_log" ("business_id", "created_at");
