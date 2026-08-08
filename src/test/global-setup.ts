import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { ADMIN_URL, TEST_DB, TEST_DB_URL } from "./test-env";

/** Creates the test database and applies migrations once per `vitest` run. */
export async function setup() {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB]);
  if (!rowCount) await admin.query(`CREATE DATABASE "${TEST_DB}"`);
  await admin.end();

  // Fresh schema every run: a half-applied migration from a previous run must
  // never be able to make a test pass or fail for the wrong reason.
  // The `drizzle` schema holds the migration journal — drop it too, or
  // drizzle-kit sees every migration as already applied and creates nothing.
  const db = new Client({ connectionString: TEST_DB_URL });
  await db.connect();
  await db.query("DROP SCHEMA IF EXISTS drizzle CASCADE;");
  await db.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await db.end();

  execFileSync("./node_modules/.bin/drizzle-kit", ["migrate"], {
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "inherit",
  });
}
