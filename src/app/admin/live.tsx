"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Subscribes to the SSE stream and re-renders server components on
// calendar changes — the admin sees new bookings without reloading.
export function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const es = new EventSource("/api/admin/events");
    es.onmessage = () => router.refresh();
    return () => es.close();
  }, [router]);
  return null;
}
