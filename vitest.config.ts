import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

import { testServiceEnv } from "./tests/support/testEnv.ts";

/**
 * Projects:
 * - unit:        pure server/shared helpers, no services.
 * - component:   React Testing Library in jsdom, no services.
 * - integration: real tRPC routers against disposable PostgreSQL + Redis
 *                (`bun test:services:up`). See tests/README.md.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    server: {
      deps: {
        // next-auth imports `next/server` without an extension (ESM).
        inline: ["next-auth"],
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          environment: "jsdom",
          include: ["src/**/*.test.tsx", "tests/component/**/*.test.tsx"],
          setupFiles: ["./tests/support/componentSetup.ts"],
          env: {
            SKIP_ENV_VALIDATION: "1",
          },
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["./tests/support/integrationGlobalSetup.ts"],
          env: testServiceEnv(),
          // Each file shares one Prisma/Redis connection; keep files serial so
          // concurrency tests measure the app rather than the test runner.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
