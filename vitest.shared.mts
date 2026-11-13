import type { ViteUserConfig } from "vite-plus/test/config";
import type { VitestEnvironment } from "vite-plus/test/node";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const workspaceRoot = fileURLToPath(new URL(".", import.meta.url));
const setupFile = fileURLToPath(new URL("./vitest.setup.ts", import.meta.url));

// Real-database suites skip without their URLs. CI and `pnpm test:db exec` set REQUIRE_DB_TESTS=1 so a
// missing URL fails the run instead of passing with skipped suites.
if (process.env.REQUIRE_DB_TESTS === "1") {
	const missing = [
		"COVER_LETTER_TEST_DATABASE_URL",
		"INTEGRATIONS_TEST_DATABASE_URL",
		"OAUTH_TEST_DATABASE_URL",
	].filter((name) => !process.env[name]);
	if (missing.length > 0) {
		throw new Error(
			`REQUIRE_DB_TESTS=1, but ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set. ` +
				"Run the tests through `pnpm test:db exec -- <command>`.",
		);
	}
}

type VitestProjectOptions = {
	name: string;
	dirname: string;
	environment?: VitestEnvironment;
	plugins?: ViteUserConfig["plugins"];
};

export const createVitestProjectConfig = ({
	name,
	dirname,
	environment = "node",
	plugins = [],
}: VitestProjectOptions) =>
	defineConfig({
		root: dirname,
		envDir: workspaceRoot,
		resolve: { tsconfigPaths: true },
		plugins,
		test: {
			name,
			// Separate Vitest processes must not clear another package's module cache.
			fsModuleCachePath: resolve(dirname, "node_modules/.vitest-cache"),
			environment,
			environmentOptions: {
				happyDOM: {
					settings: {
						disableJavaScriptFileLoading: true,
						disableCSSFileLoading: true,
						navigation: {
							disableMainFrameNavigation: true,
							disableChildFrameNavigation: true,
							disableChildPageNavigation: true,
						},
					},
				},
			},
			setupFiles: [setupFile],
			include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
			exclude: ["node_modules", "dist", ".output", "coverage", "reports"],
			// Processes, not threads: with several worker threads compiling WebAssembly (Forme, HarfBuzz, PDF.js), V8 on
			// Linux CPUs with memory protection keys can abort the run with "Check failed: jit_page.has_value()".
			pool: "forks",
			maxWorkers: 2,
			// Isolation stays on: without it, test files in a worker share one module registry, so a
			// `vi.mock` in one file leaks into another and whichever file imported a module first wins.
			// That made every suite mocking `@reactive-resume/env/server` order-dependent and flaky.
			passWithNoTests: true,
			coverage: {
				provider: "v8",
				reportsDirectory: "coverage",
				reporter: ["text", "text-summary", "json-summary", "json", "lcov", "html"],
				include: ["src/**/*.{ts,tsx}"],
				exclude: ["src/**/*.{test,spec}.*", "src/**/*.d.ts", "src/routeTree.gen.ts"],
				reportOnFailure: true,
			},
		},
	});
