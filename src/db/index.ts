import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
export { schema };

/**
 * A transaction handle, or the pool itself. Helpers that must be able to join
 * a caller's transaction take this rather than reaching for `db` directly.
 */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;
