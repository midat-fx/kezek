"use server";
import { redirect } from "next/navigation";
import { acceptOffer } from "@/lib/waitlist";

export async function accept(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const result = await acceptOffer(token);
  redirect(`/w/${token}?status=${result.ok ? "booked" : result.error}`);
}
