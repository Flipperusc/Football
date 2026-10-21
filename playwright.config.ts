import { defineConfig, devices } from "@playwright/test";

if (process.env.E2E_ACTIVE !== "1") throw new Error("Run pnpm test:e2e so tests use an isolated database and credentials.");
const baseURL = "http://127.0.0.1:3109";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: { baseURL, actionTimeout: 15_000, navigationTimeout: 60_000, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.PLAYWRIGHT_CHANNEL } }],
  webServer: {
    command: `node node_modules/next/dist/bin/next ${process.env.E2E_USE_BUILD === "1" ? "start" : "dev"} --hostname 127.0.0.1 --port 3109`,
    url: baseURL, reuseExistingServer: false, timeout: 180_000,
    env: { DATABASE_URL: process.env.E2E_DATABASE_URL!, DEEPSEEK_API_KEY: "", NEXT_TELEMETRY_DISABLED: "1" }
  }
});
