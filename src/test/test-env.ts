import "dotenv/config";

// Integration tests run against a throwaway database and a separate Redis
// index so they never touch the dev data you have open in the browser.
// Derived the same way in global setup and in each worker — no cross-process
// env plumbing needed.
export const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://kezek:kezek@localhost:5433/kezek";
export const TEST_DB = process.env.TEST_DB_NAME ?? "kezek_test";

export const TEST_DB_URL = (() => {
  const u = new URL(ADMIN_URL);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
})();

export const TEST_REDIS_URL = (() => {
  const u = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  u.pathname = "/1"; // db 1; the dev server uses db 0
  return u.toString();
})();
