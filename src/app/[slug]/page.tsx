import { notFound } from "next/navigation";
import { businessBySlug } from "@/lib/public";
import { BookingWizard } from "./wizard";

export default async function PublicBookingPage(ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const biz = await businessBySlug(slug);
  if (!biz) notFound();
  return (
    <main className="mx-auto max-w-lg p-4 sm:p-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-zinc-900">{biz.name}</h1>
        <p className="text-sm text-zinc-500">Online booking · {biz.timezone}</p>
      </header>
      <BookingWizard slug={slug} timezone={biz.timezone} />
    </main>
  );
}
