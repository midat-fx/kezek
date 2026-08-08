import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests run anywhere. Integration tests need a live Postgres + Redis
// (docker compose up -d) and are opt-in via `pnpm test:integration`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
  },
});
