import { defineConfig, devices } from "playwright/test";

const baseURL =
    process.env.FRONTEND_E2E_BASE_URL?.trim() || "http://127.0.0.1:42820";
const persistSuccessArtifacts =
    process.env.FRONTEND_E2E_PERSIST_SUCCESS_ARTIFACTS === "1";

export default defineConfig({
    testDir: "./e2e",
    outputDir: "./test-results/playwright",
    timeout: 45_000,
    expect: {
        timeout: 10_000,
    },
    fullyParallel: false,
    retries: 0,
    webServer: process.env.FRONTEND_E2E_BASE_URL
        ? undefined
        : {
              command: "yarn dev --host 127.0.0.1 --port 42820 --strictPort",
              url: baseURL,
              timeout: 60_000,
              reuseExistingServer: !process.env.CI,
          },
    use: {
        baseURL,
        trace: persistSuccessArtifacts ? "on" : "retain-on-failure",
        video: persistSuccessArtifacts ? "on" : "retain-on-failure",
        screenshot: persistSuccessArtifacts ? "on" : "only-on-failure",
    },
    projects: [
        {
            name: "desktop",
            use: {
                browserName: "chromium",
                viewport: { width: 1440, height: 960 },
                screen: { width: 1440, height: 960 },
            },
        },
        {
            name: "mobile",
            use: {
                ...devices["Pixel 7"],
            },
        },
    ],
});
