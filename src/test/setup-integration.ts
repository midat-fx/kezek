import { TEST_DB_URL, TEST_REDIS_URL } from "./test-env";

// App modules build their Pool / Redis client at import time, so these must be
// set before any test file imports them. setupFiles run first, which is why
// this assignment lives here rather than inside a test.
process.env.DATABASE_URL = TEST_DB_URL;
process.env.REDIS_URL = TEST_REDIS_URL;
