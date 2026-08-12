import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema as s } from "@/db";
import { accept } from "./actions";

/**
 * Landing page for the link in a waitlist offer. Deliberately a single button:
 * the client tapped through from an SMS and the slot is on a countdown.
 */
export default async function WaitlistOfferPage(ctx: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { token } = await ctx.params;
  const { status } = await ctx.searchParams;

  const [entry] = await db
    .select({
      status: s.waitlistEntries.status,
      offerSlotStartAt: s.waitlistEntries.offerSlotStartAt,
      offerExpiresAt: s.waitlistEntries.offerExpiresAt,
      serviceName: s.services.name,
      staffName: s.staff.name,
      businessName: s.businesses.name,
      timezone: s.businesses.timezone,
    })
    .from(s.waitlistEntries)
    .innerJoin(s.services, eq(s.waitlistEntries.serviceId, s.services.id))
    .innerJoin(s.staff, eq(s.waitlistEntries.offerStaffId, s.staff.id))
    .innerJoin(s.businesses, eq(s.waitlistEntries.businessId, s.businesses.id))
    .where(eq(s.waitlistEntries.offerToken, token));

  if (!entry && status !== "booked") notFound();

  const shell = (children: React.ReactNode) => (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 text-center">
        {children}
      </div>
    </main>
  );

  if (status === "booked") {
    return shell(
      <>
        <div className="text-4xl">✅</div>
        <h1 className="mt-2 text-xl font-semibold text-zinc-900">The slot is yours</h1>
        <p className="mt-2 text-zinc-600">We sent a confirmation by SMS.</p>
      </>,
    );
  }

  if (status === "expired" || entry.status !== "offered") {
    return shell(
      <>
        <div className="text-4xl">⌛</div>
        <h1 className="mt-2 text-xl font-semibold text-zinc-900">This offer is no longer active</h1>
        <p className="mt-2 text-zinc-600">
          The slot has moved on to the next person in the queue. You are still on the waitlist.
        </p>
      </>,
    );
  }

  const fmt = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: entry.timezone,
  });

  return shell(
    <>
      <h1 className="text-xl font-semibold text-zinc-900">{entry.businessName}</h1>
      <p className="mt-4 text-zinc-700">
        A slot opened up for “{entry.serviceName}” with {entry.staffName}:
      </p>
      <p className="mt-1 text-lg font-semibold">{fmt.format(entry.offerSlotStartAt!)}</p>
      <p className="mt-2 text-sm text-zinc-500">
        This offer is valid until {fmt.format(entry.offerExpiresAt!)}
      </p>
      <form action={accept}>
        <input type="hidden" name="token" value={token} />
        <button className="mt-5 w-full rounded-lg bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700">
          Claim this slot
        </button>
      </form>
    </>,
  );
}
