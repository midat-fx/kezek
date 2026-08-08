import { calendarChannel } from "@/lib/booking";
import { redis } from "@/lib/redis";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// SSE stream of calendar changes for the admin UI.
// Each connection gets its own Redis subscriber (a subscribing connection
// can't run other commands); closed on client disconnect.
export async function GET() {
  const session = await getSession();
  if (!session) return new Response("unauthorized", { status: 401 });

  const sub = redis().duplicate();
  await sub.subscribe(calendarChannel(session.businessId));
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval>;

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: hello\ndata: {}\n\n`));
      sub.on("message", (_channel, message) => {
        controller.enqueue(encoder.encode(`data: ${message}\n\n`));
      });
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 25_000);
    },
    cancel() {
      clearInterval(heartbeat);
      void sub.quit();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
