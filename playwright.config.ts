import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const baseURL = process.env.APP_URL ?? `http://localhost:${port}`;
const isCI = process.env.CI === "true" || process.env.CI === "1";

export default defineConfig({
	testDir: "./tests/e2e/specs",
	fullyParallel: true,
	forbidOnly: isCI,
	retries: 0,
	workers: isCI ? 1 : undefined,
	timeout: 30_000,
	expect: {
		timeout: 10_000,
	},
	reporter: isCI
		? [["list"], ["github"], ["junit", { outputFile: "test-results/e2e-junit.xml" }]]
		: [["list"], ["html", { open: "never" }]],
	use: {
		baseURL,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
	webServer: {
		// Run node directly: pnpm >=12.6 moves script children into their own process group,
		// so Playwright's group kill misses the server and the job hangs after the tests finish.
		command: "node apps/server/dist/index.mjs",
		url: `${baseURL}/api/health`,
		reuseExistingServer: !isCI,
		timeout: 120_000,
		env: {
			...process.env,
			APP_URL: baseURL,
			NODE_ENV: "production",
			PORT: String(port),
		},
	},
});
