import { defineConfig, devices } from "@playwright/test";

import { testServiceEnv } from "./tests/support/testEnv.ts";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;

// `next dev` must run with NODE_ENV=development; everything else comes from the
// disposable test services (see docker-compose.test.yml).
const { NODE_ENV: _nodeEnv, ...serviceEnv } = testServiceEnv();

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/globalSetup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bunx next dev --port ${PORT}`,
    url: `${baseURL}/join`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...serviceEnv,
      NEXT_PUBLIC_QRCODE_BASE_URL: baseURL,
      NEXTAUTH_URL: baseURL,
      AUTH_TRUST_HOST: "true",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
