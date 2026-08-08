// Pure slot-generation engine: no DB, no Redis, fully unit-tested.
// All instants are UTC epoch ms; wall-clock times only exist relative to an
// IANA timezone, converted via Intl (no date libraries).

export type Range = { startMs: number; endMs: number };
export type DayWindow = { open: string; close: string }; // "HH:MM" local wall time

/** Offset of `timeZone` from UTC in minutes at the given instant (east positive). */
export function tzOffsetMinutes(timeZone: string, utcMs: number): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, number> = {};
  for (const { type, value } of dtf.formatToParts(utcMs)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour === 24 ? 0 : parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUtc - utcMs) / 60000);
}

/** UTC instant of local wall time `HH:MM` on local date `YYYY-MM-DD` in `timeZone`. */
export function localTimeToUtc(dateISO: string, hhmm: string, timeZone: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  // Two-pass: estimate offset at the naive instant, then re-check at the
  // corrected instant so DST transitions resolve correctly.
  const offset1 = tzOffsetMinutes(timeZone, naive);
  const guess = naive - offset1 * 60000;
  const offset2 = tzOffsetMinutes(timeZone, guess);
  return naive - offset2 * 60000;
}

/** ISO weekday (1 = Monday … 7 = Sunday) of local date `YYYY-MM-DD`. */
export function isoWeekday(dateISO: string): number {
  const [y, m, d] = dateISO.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun
  return dow === 0 ? 7 : dow;
}

const overlaps = (a: Range, b: Range) => a.startMs < b.endMs && b.startMs < a.endMs;

export type SlotsInput = {
  dateISO: string; // local date at the business
  timeZone: string;
  window: DayWindow | null; // null = closed that day
  durationMin: number;
  stepMin?: number; // slot grid step, default 15
  busy?: Range[]; // confirmed bookings for the master
  holds?: Range[]; // active Redis holds for the master
  notBeforeMs?: number; // e.g. Date.now(): hide past slots
};

/** Free slots for one master on one local day. */
export function slotsForDay(input: SlotsInput): Range[] {
  const { dateISO, timeZone, window, durationMin, stepMin = 15 } = input;
  if (!window) return [];
  const busy = [...(input.busy ?? []), ...(input.holds ?? [])];
  const openMs = localTimeToUtc(dateISO, window.open, timeZone);
  const closeMs = localTimeToUtc(dateISO, window.close, timeZone);
  const out: Range[] = [];
  for (let start = openMs; start + durationMin * 60000 <= closeMs; start += stepMin * 60000) {
    const slot = { startMs: start, endMs: start + durationMin * 60000 };
    if (input.notBeforeMs !== undefined && slot.startMs < input.notBeforeMs) continue;
    if (busy.some((b) => overlaps(slot, b))) continue;
    out.push(slot);
  }
  return out;
}
