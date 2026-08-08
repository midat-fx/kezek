import "dotenv/config";
import { runWorker } from "@/lib/notify/worker";

console.log(JSON.stringify({ component: "outbox-worker", event: "start" }));
runWorker().catch((e) => {
  console.error(e);
  process.exit(1);
});
