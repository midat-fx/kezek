"use client";
import { useRouter } from "next/navigation";

export function DatePicker({ value }: { value: string }) {
  const router = useRouter();
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => router.push(`/admin?date=${e.target.value}`)}
      className="rounded-lg border border-zinc-300 bg-white px-2 py-1"
    />
  );
}
