import { defineConfig } from "vitest/config";

const testDb = process.env.TEST_DATABASE_URL ?? "postgresql://hub:hub@localhost:5432/hub_test";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/*/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    fileParallelism: false,
    globalSetup: ["./test/global-setup.ts"],
    env: {
      DATABASE_URL: testDb,
      HUB_URL: "http://hub.test",
      HUB_ORG_SLUG: "test-org",
      HUB_ORG_NAME: "Test Org",
      HUB_AGENT_MODE: "kagent",
      HUB_REQUEST_TIMEOUT_MINUTES: "30",
      SLACK_WEBHOOK_URL: "",
      SMTP_URL: "",
    },
  },
});
