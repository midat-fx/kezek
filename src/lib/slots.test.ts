import { describe, expect, it } from "vitest";
import { isoWeekday, localTimeToUtc, slotsForDay, tzOffsetMinutes } from "./slots";

describe("tzOffsetMinutes", () => {
  it("Almaty is UTC+5 (no DST)", () => {
    expect(tzOffsetMinutes("Asia/Almaty", Date.UTC(2026, 0, 15))).toBe(300);
    expect(tzOffsetMinutes("Asia/Almaty", Date.UTC(2026, 6, 15))).toBe(300);
  });
  it("New York flips between EST and EDT", () => {
    expect(tzOffsetMinutes("America/New_York", Date.UTC(2026, 0, 15))).toBe(-300);
    expect(tzOffsetMinutes("America/New_York", Date.UTC(2026, 6, 15))).toBe(-240);
  });
});

describe("localTimeToUtc", () => {
  it("10:00 Almaty = 05:00 UTC", () => {
    expect(localTimeToUtc("2026-08-10", "10:00", "Asia/Almaty")).toBe(
      Date.UTC(2026, 7, 10, 5, 0),
    );
  });
  it("handles a DST-transition day without drifting", () => {
    // US spring forward 2026-03-08: 10:00 EDT = 14:00 UTC
    expect(localTimeToUtc("2026-03-08", "10:00", "America/New_York")).toBe(
      Date.UTC(2026, 2, 8, 14, 0),
    );
  });
});

describe("isoWeekday", () => {
  it("Monday=1, Sunday=7", () => {
    expect(isoWeekday("2026-08-10")).toBe(1); // Monday
    expect(isoWeekday("2026-08-16")).toBe(7); // Sunday
  });
});

describe("slotsForDay", () => {
  const base = {
    dateISO: "2026-08-11",
    timeZone: "Asia/Almaty",
    window: { open: "10:00", close: "12:00" },
    durationMin: 60,
    stepMin: 30,
  };
  const at = (hh: number, mm = 0) => Date.UTC(2026, 7, 11, hh - 5, mm); // local → UTC

  it("generates the full grid when free", () => {
    const slots = slotsForDay(base);
    expect(slots.map((s) => s.startMs)).toEqual([at(10), at(10, 30), at(11)]);
  });

  it("closed day yields no slots", () => {
    expect(slotsForDay({ ...base, window: null })).toEqual([]);
  });

  it("last slot must END by closing time", () => {
    const slots = slotsForDay({ ...base, durationMin: 90 });
    expect(slots.map((s) => s.startMs)).toEqual([at(10), at(10, 30)]);
  });

  it("excludes slots overlapping busy bookings", () => {
    const busy = [{ startMs: at(10, 30), endMs: at(11, 30) }];
    const slots = slotsForDay({ ...base, busy });
    expect(slots.map((s) => s.startMs)).toEqual([]); // every 60-min slot touches 10:30–11:30
  });

  it("back-to-back bookings do not block adjacent slots", () => {
    const busy = [{ startMs: at(10), endMs: at(11) }];
    const slots = slotsForDay({ ...base, busy });
    expect(slots.map((s) => s.startMs)).toEqual([at(11)]); // 11:00 starts exactly at busy end
  });

  it("holds block like bookings", () => {
    const holds = [{ startMs: at(11), endMs: at(12) }];
    const slots = slotsForDay({ ...base, holds });
    expect(slots.map((s) => s.startMs)).toEqual([at(10)]);
  });

  it("notBeforeMs hides past slots", () => {
    const slots = slotsForDay({ ...base, notBeforeMs: at(10, 45) });
    expect(slots.map((s) => s.startMs)).toEqual([at(11)]);
  });
});
