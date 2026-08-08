import "dotenv/config";
import puppeteer from "puppeteer-core";
import type { Page } from "puppeteer-core";

// Captures the README screenshots against a running dev server.
// Usage: pnpm dev, then `pnpm screenshots` (needs Google Chrome installed).
const BASE = process.env.SCREENSHOT_BASE ?? "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "docs/screenshots";


/** Waits until the slot grid has rendered (times vary with the seeded day). */
async function waitForSlots(page: { waitForFunction: (fn: string) => Promise<unknown> }) {
  await page.waitForFunction(
    `[...document.querySelectorAll('button')].some(b => /^\\d{2}:\\d{2}$/.test(b.textContent?.trim() ?? ''))`,
  );
}

/** Screenshot clipped to the actual content height — no acres of empty page. */
async function shot(page: Page, name: string) {
  const height = await page.evaluate(
    () => Math.max(document.body.scrollHeight, 320) + 24,
  );
  await page.screenshot({
    path: `${OUT}/${name}.png`,
    clip: { x: 0, y: 0, width: 1280, height: Math.min(height, 1600) },
  });
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();

  // 1. Public booking wizard, mid-flow (service + master picked, slots visible)
  await page.goto(`${BASE}/aruzhan`, { waitUntil: "networkidle0" });
  await page.locator("button ::-p-text(Женская стрижка)").click();
  await page.locator("button ::-p-text(Dana)").click();
  await waitForSlots(page);
  await shot(page, "01-booking-wizard");

  // 2. Hold countdown + contact step.
  // Pick whatever slot is free rather than a fixed time — a previous run may
  // still be holding one (holds live for 5 minutes).
  await page.evaluate((): void => {
    const slot = [...document.querySelectorAll("button")].find((b) =>
      /^\d{2}:\d{2}$/.test(b.textContent?.trim() ?? ""),
    );
    slot?.click();
  });
  await page.waitForSelector('input[placeholder="Имя"]');
  await shot(page, "02-slot-hold");

  // 3. Admin login
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.type('input[type="email"]', "owner@kezek.dev");
  await page.type('input[type="password"]', "kezek-demo");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click('button[type="submit"], form button'),
  ]);

  // Admin pages hold an open SSE connection, so networkidle never fires:
  // wait for the content itself instead.
  const admin = { waitUntil: "domcontentloaded" as const };

  // 4. Admin calendar
  await page.goto(`${BASE}/admin`, admin);
  await page.waitForSelector("h1 ::-p-text(Календарь)");
  await shot(page, "03-admin-calendar");

  // 5. Reports (wait for the chart bars to render)
  await page.goto(`${BASE}/admin/reports`, admin);
  await page.waitForSelector("svg .recharts-bar-rectangle", { timeout: 15_000 });
  await shot(page, "04-reports");

  // 6. Clients CRM
  await page.goto(`${BASE}/admin/clients`, admin);
  await page.waitForSelector("table tbody tr");
  await shot(page, "05-clients");

  await browser.close();
  console.log(`Screenshots written to ${OUT}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
