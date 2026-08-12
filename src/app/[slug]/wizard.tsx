"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type Master = { id: string; name: string };
type Service = { id: string; name: string; durationMin: number; priceKzt: number; staff: Master[] };
type Slot = { startMs: number; endMs: number };
type Hold = { holdToken: string; expiresInSec: number; slot: Slot };

const fmtPrice = (kzt: number) => `${kzt.toLocaleString("ru-RU")} ₸`;

/** Offered instead of an empty slot grid: a full day is a lead, not a dead end. */
function WaitlistBox({
  slug,
  serviceId,
  staffId,
  date,
}: {
  slug: string;
  serviceId: string;
  staffId: string;
  date: string;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "joined" | "error">("idle");

  if (state === "joined") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        You are on the waitlist for {date}. The moment a slot frees up we message you first — you get
        15 minutes to claim it.
      </div>
    );
  }

  async function submit() {
    setState("sending");
    const res = await fetch(`/api/public/${slug}/waitlist`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serviceId, staffId, date, name, phone }),
    });
    setState(res.ok ? "joined" : "error");
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <p className="text-sm text-zinc-700">
        This day is fully booked. Join the waitlist — if someone cancels, the slot is offered
        to you.
      </p>
      <div className="mt-3 space-y-2">
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2"
        />
        <input
          placeholder="+7701…"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2"
        />
        <button
          onClick={submit}
          disabled={state === "sending" || !name.trim() || !phone.trim()}
          className="w-full rounded-lg border border-zinc-900 px-4 py-2 text-zinc-900 disabled:opacity-50"
        >
          {state === "sending" ? "Joining…" : "Join the waitlist"}
        </button>
        {state === "error" && (
          <p className="text-sm text-red-600">That did not work — check the phone number and try again</p>
        )}
      </div>
    </div>
  );
}

export function BookingWizard({ slug, timezone }: { slug: string; timezone: string }) {
  const [services, setServices] = useState<Service[] | null>(null);
  const [service, setService] = useState<Service | null>(null);
  const [master, setMaster] = useState<Master | null>(null);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [hold, setHold] = useState<Hold | null>(null);
  const [holdLeft, setHoldLeft] = useState(0);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const fmtTime = useMemo(
    () =>
      new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: timezone }),
    [timezone],
  );

  useEffect(() => {
    fetch(`/api/public/${slug}/catalog`)
      .then((r) => r.json())
      .then((d) => setServices(d.services ?? []))
      .catch(() => setError("Could not load services"));
  }, [slug]);

  // Data lands asynchronously; loading state is `slots === null`,
  // reset in the event handlers that change service/master/date.
  const loadSlots = useCallback(() => {
    if (!service || !master) return;
    fetch(`/api/public/${slug}/slots?serviceId=${service.id}&staffId=${master.id}&date=${date}`)
      .then((r) => r.json())
      .then((d) => setSlots(d.slots ?? []))
      .catch(() => setError("Could not load available times"));
  }, [slug, service, master, date]);

  useEffect(loadSlots, [loadSlots]);

  // Hold countdown (initial value is set in pickSlot)
  useEffect(() => {
    if (!hold) return;
    const t = setInterval(() => setHoldLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [hold]);

  async function pickSlot(slot: Slot) {
    if (!service || !master) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/public/${slug}/hold`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serviceId: service.id, staffId: master.id, date, startMs: slot.startMs }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("That time was just taken — pick another one");
      loadSlots();
      return;
    }
    const h: Hold = await res.json();
    setHold(h);
    setHoldLeft(h.expiresInSec);
  }

  async function confirm() {
    if (!service || !master || !hold) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/public/${slug}/book`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        serviceId: service.id,
        staffId: master.id,
        startMs: hold.slot.startMs,
        endMs: hold.slot.endMs,
        holdToken: hold.holdToken,
        name,
        phone,
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(
        d.error === "hold_expired"
          ? "The hold expired — pick a time again"
          : d.error === "bad_request"
            ? "Check the name and phone (format +7701…)"
            : "That time is already taken — pick another one",
      );
      if (d.error !== "bad_request") {
        setHold(null);
        loadSlots();
      }
      return;
    }
    setDone(true);
  }

  if (done && service && master && hold) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <div className="text-4xl">✅</div>
        <h2 className="mt-2 text-xl font-semibold text-emerald-900">You are booked!</h2>
        <p className="mt-2 text-emerald-800">
          {service.name} · {master.name}
          <br />
          {new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeZone: timezone }).format(hold.slot.startMs)}{" "}
          at {fmtTime.format(hold.slot.startMs)}
        </p>
        <button
          onClick={() => location.reload()}
          className="mt-4 rounded-lg bg-emerald-700 px-4 py-2 text-sm text-white"
        >
          Book again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Step 1: service */}
      <section>
        <h2 className="mb-2 font-semibold text-zinc-800">1 · Service</h2>
        {!services ? (
          <p className="text-sm text-zinc-400">Loading…</p>
        ) : (
          <div className="grid gap-2">
            {services.map((svc) => (
              <button
                key={svc.id}
                onClick={() => {
                  setService(svc);
                  setMaster(null);
                  setHold(null);
                  setSlots(null);
                }}
                className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
                  service?.id === svc.id
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white hover:border-zinc-400"
                }`}
              >
                <span>
                  {svc.name}
                  <span className={service?.id === svc.id ? "text-zinc-300" : "text-zinc-400"}>
                    {" "}
                    · {svc.durationMin} min
                  </span>
                </span>
                <span className="shrink-0 font-medium">{fmtPrice(svc.priceKzt)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Step 2: master */}
      {service && (
        <section>
          <h2 className="mb-2 font-semibold text-zinc-800">2 · Staff member</h2>
          <div className="flex flex-wrap gap-2">
            {service.staff.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  setMaster(m);
                  setHold(null);
                  setSlots(null);
                }}
                className={`rounded-full border px-4 py-2 transition ${
                  master?.id === m.id
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white hover:border-zinc-400"
                }`}
              >
                {m.name}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Step 3: date + slot */}
      {service && master && !hold && (
        <section>
          <h2 className="mb-2 font-semibold text-zinc-800">3 · Date and time</h2>
          <input
            type="date"
            value={date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(e) => {
              setDate(e.target.value);
              setSlots(null);
            }}
            className="mb-3 rounded-lg border border-zinc-300 px-3 py-2"
          />
          {!slots ? (
            <p className="text-sm text-zinc-400">Loading…</p>
          ) : slots.length === 0 ? (
            <WaitlistBox
              slug={slug}
              serviceId={service.id}
              staffId={master.id}
              date={date}
            />
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {slots.map((slot) => (
                <button
                  key={slot.startMs}
                  disabled={busy}
                  onClick={() => pickSlot(slot)}
                  className="rounded-lg border border-zinc-200 bg-white px-2 py-2 text-sm transition hover:border-zinc-900 disabled:opacity-50"
                >
                  {fmtTime.format(slot.startMs)}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Step 4: contacts */}
      {hold && (
        <section className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="font-semibold text-zinc-800">4 · Your details</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Slot {fmtTime.format(hold.slot.startMs)} held for another{" "}
            <span className={holdLeft < 60 ? "font-semibold text-red-600" : "font-semibold"}>
              {Math.floor(holdLeft / 60)}:{String(holdLeft % 60).padStart(2, "0")}
            </span>
          </p>
          <div className="mt-3 space-y-3">
            <input
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
            <input
              placeholder="+7701…"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2"
            />
            <div className="flex gap-2">
              <button
                onClick={confirm}
                disabled={busy || !name.trim() || !phone.trim() || holdLeft === 0}
                className="flex-1 rounded-lg bg-zinc-900 px-4 py-2 text-white disabled:opacity-50"
              >
                {busy ? "Confirming…" : "Confirm booking"}
              </button>
              <button
                onClick={() => {
                  setHold(null);
                  loadSlots();
                }}
                className="rounded-lg border border-zinc-300 px-4 py-2"
              >
                Back
              </button>
            </div>
          </div>
        </section>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
