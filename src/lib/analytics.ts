import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Reporting queries. Deliberately raw SQL: each of these is a window-function
 * problem, and expressing them through a query builder would obscure the one
 * thing worth reading.
 */

export type RevenuePoint = {
  day: string;
  revenue: number;
  /** 7-day trailing mean — smooths the weekday sawtooth a salon always has. */
  movingAvg: number;
  /** Running total across the period. */
  cumulative: number;
};

export async function revenueTrend(businessId: string, days = 60): Promise<RevenuePoint[]> {
  const { rows } = await db.execute<{
    day: string;
    revenue: string;
    moving_avg: string;
    cumulative: string;
  }>(sql`
    WITH bounds AS (
      SELECT timezone, (now() AT TIME ZONE timezone)::date AS today
      FROM businesses WHERE id = ${businessId}
    ),
    -- A dense calendar so days with no revenue stay in the series; without
    -- this the moving average would silently skip closed days.
    calendar AS (
      SELECT generate_series((b.today - (${days}::int - 1))::timestamp, b.today::timestamp, interval '1 day')::date AS day
      FROM bounds b
    ),
    daily AS (
      SELECT (bk.start_at AT TIME ZONE b.timezone)::date AS day,
             sum(bk.price_kzt)::bigint AS revenue
      FROM bookings bk, bounds b
      WHERE bk.business_id = ${businessId}
        AND bk.status = 'completed'
        AND (bk.start_at AT TIME ZONE b.timezone)::date >= b.today - (${days}::int - 1)
      GROUP BY 1
    )
    SELECT to_char(c.day, 'YYYY-MM-DD') AS day,
           coalesce(d.revenue, 0) AS revenue,
           round(avg(coalesce(d.revenue, 0)) OVER (
             ORDER BY c.day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
           )) AS moving_avg,
           sum(coalesce(d.revenue, 0)) OVER (ORDER BY c.day) AS cumulative
    FROM calendar c
    LEFT JOIN daily d ON d.day = c.day
    ORDER BY c.day
  `);

  return rows.map((r) => ({
    day: r.day,
    revenue: Number(r.revenue),
    movingAvg: Number(r.moving_avg),
    cumulative: Number(r.cumulative),
  }));
}

export type Utilization = {
  staffId: string;
  staffName: string;
  bookedMinutes: number;
  availableMinutes: number;
  utilization: number; // 0..1
  revenue: number;
};

/**
 * Booked minutes against minutes actually on offer. Availability comes from the
 * master's own hours where they have them and the business hours otherwise —
 * the same precedence the booking engine uses, so the number is comparable to
 * what clients could really see.
 */
export async function utilization(businessId: string, days = 30): Promise<Utilization[]> {
  const { rows } = await db.execute<{
    staff_id: string;
    staff_name: string;
    booked_minutes: string;
    available_minutes: string;
    revenue: string;
  }>(sql`
    WITH bounds AS (
      SELECT timezone, (now() AT TIME ZONE timezone)::date AS today
      FROM businesses WHERE id = ${businessId}
    ),
    days AS (
      SELECT d::date AS day, extract(isodow FROM d)::int AS weekday
      FROM bounds b, generate_series((b.today - ${days}::int)::timestamp, (b.today - 1)::timestamp, interval '1 day') d
    ),
    -- Per master per day: their own window if defined, else the business's.
    capacity AS (
      SELECT st.id AS staff_id, st.name AS staff_name, d.day,
             extract(epoch FROM (
               coalesce(sh.end_time, bh.close_time) - coalesce(sh.start_time, bh.open_time)
             )) / 60 AS minutes
      FROM staff st
      CROSS JOIN days d
      LEFT JOIN business_hours bh
        ON bh.business_id = st.business_id AND bh.weekday = d.weekday
      LEFT JOIN staff_hours sh
        ON sh.staff_id = st.id AND sh.weekday = d.weekday
      WHERE st.business_id = ${businessId} AND st.is_active
        AND coalesce(sh.start_time, bh.open_time) IS NOT NULL
    ),
    booked AS (
      SELECT bk.staff_id,
             sum(extract(epoch FROM (bk.end_at - bk.start_at)) / 60) AS minutes,
             sum(bk.price_kzt) FILTER (WHERE bk.status = 'completed') AS revenue
      FROM bookings bk, bounds b
      WHERE bk.business_id = ${businessId}
        AND bk.status IN ('completed', 'confirmed')
        AND (bk.start_at AT TIME ZONE b.timezone)::date >= b.today - ${days}::int
        AND (bk.start_at AT TIME ZONE b.timezone)::date < b.today
      GROUP BY 1
    )
    SELECT c.staff_id,
           c.staff_name,
           coalesce(bk.minutes, 0)::bigint AS booked_minutes,
           sum(c.minutes)::bigint AS available_minutes,
           coalesce(bk.revenue, 0)::bigint AS revenue
    FROM capacity c
    LEFT JOIN booked bk ON bk.staff_id = c.staff_id
    GROUP BY c.staff_id, c.staff_name, bk.minutes, bk.revenue
    ORDER BY 3 DESC
  `);

  return rows.map((r) => {
    const booked = Number(r.booked_minutes);
    const available = Number(r.available_minutes);
    return {
      staffId: r.staff_id,
      staffName: r.staff_name,
      bookedMinutes: booked,
      availableMinutes: available,
      utilization: available > 0 ? booked / available : 0,
      revenue: Number(r.revenue),
    };
  });
}

export type CohortRow = {
  cohort: string; // YYYY-MM of first visit
  size: number;
  /** retained[i] = clients who came back i months after their first visit. */
  retained: number[];
};

/**
 * Classic cohort retention: group clients by the month of their first completed
 * visit, then count how many returned in each subsequent month.
 */
export async function cohorts(businessId: string, months = 6): Promise<CohortRow[]> {
  const { rows } = await db.execute<{
    cohort: string;
    month_offset: number;
    clients: string;
  }>(sql`
    WITH bounds AS (
      SELECT timezone FROM businesses WHERE id = ${businessId}
    ),
    visits AS (
      SELECT bk.client_id,
             date_trunc('month', bk.start_at AT TIME ZONE b.timezone) AS month
      FROM bookings bk, bounds b
      WHERE bk.business_id = ${businessId} AND bk.status = 'completed'
    ),
    first_visit AS (
      SELECT client_id, min(month) AS cohort_month FROM visits GROUP BY 1
    )
    SELECT to_char(f.cohort_month, 'YYYY-MM') AS cohort,
           (extract(year FROM age(v.month, f.cohort_month)) * 12
            + extract(month FROM age(v.month, f.cohort_month)))::int AS month_offset,
           count(DISTINCT v.client_id)::bigint AS clients
    FROM visits v
    JOIN first_visit f USING (client_id)
    WHERE f.cohort_month >= date_trunc('month', now()) - (${months} || ' months')::interval
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);

  const byCohort = new Map<string, number[]>();
  for (const r of rows) {
    const list = byCohort.get(r.cohort) ?? [];
    list[r.month_offset] = Number(r.clients);
    byCohort.set(r.cohort, list);
  }

  return [...byCohort.entries()].map(([cohort, retained]) => ({
    cohort,
    size: retained[0] ?? 0,
    retained: Array.from({ length: retained.length }, (_, i) => retained[i] ?? 0),
  }));
}

export type TopClient = {
  rank: number;
  name: string;
  phone: string;
  visits: number;
  revenue: number;
  /** Share of total revenue accounted for by this client and everyone above. */
  cumulativeShare: number;
};

/** Who the business actually lives on — ranked, with a running Pareto share. */
export async function topClients(businessId: string, limit = 10): Promise<TopClient[]> {
  const { rows } = await db.execute<{
    rank: string;
    name: string;
    phone: string;
    visits: string;
    revenue: string;
    cumulative_share: string;
  }>(sql`
    WITH per_client AS (
      SELECT c.id, c.name, c.phone,
             count(*) FILTER (WHERE bk.status = 'completed')::bigint AS visits,
             coalesce(sum(bk.price_kzt) FILTER (WHERE bk.status = 'completed'), 0)::bigint AS revenue
      FROM clients c
      LEFT JOIN bookings bk ON bk.client_id = c.id
      WHERE c.business_id = ${businessId}
      GROUP BY c.id
    ),
    ranked AS (
      SELECT *,
             rank() OVER (ORDER BY revenue DESC) AS rank,
             sum(revenue) OVER (ORDER BY revenue DESC, id
                                ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running,
             sum(revenue) OVER () AS total
      FROM per_client
    )
    SELECT rank, name, phone, visits, revenue,
           CASE WHEN total > 0 THEN round(running::numeric / total, 4) ELSE 0 END AS cumulative_share
    FROM ranked
    WHERE revenue > 0
    ORDER BY rank
    LIMIT ${limit}
  `);

  return rows.map((r) => ({
    rank: Number(r.rank),
    name: r.name,
    phone: r.phone,
    visits: Number(r.visits),
    revenue: Number(r.revenue),
    cumulativeShare: Number(r.cumulative_share),
  }));
}
