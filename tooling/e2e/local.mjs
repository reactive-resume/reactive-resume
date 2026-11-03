import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { checkout, ciEnv, databaseName, databaseUrl, ensureDatabases, root } from "../dev/test-db.mjs";

// Runs the Playwright suite like the CI browser job, against this checkout's own database, storage and port, so
// parallel worktrees never reuse each other's server. `--build` runs `pnpm build` first; other arguments go to Playwright.
const args = process.argv.slice(2).filter((arg) => arg !== "--");
const build = args.includes("--build");
const playwrightArgs = args.filter((arg) => arg !== "--build");

const port = await new Promise((resolvePort, reject) => {
	const server = createServer();
	server.on("error", reject);
	server.listen(0, () => {
		const { port } = server.address();
		server.close(() => resolvePort(port));
	});
});

const database = databaseName("e2e");
const storage = resolve(tmpdir(), `reactive-resume-e2e-${checkout}`);
const env = {
	...process.env,
	...ciEnv,
	APP_URL: `http://localhost:${port}`,
	PORT: String(port),
	DATABASE_URL: databaseUrl(database),
	STORAGE_BACKEND: "local",
	LOCAL_STORAGE_PATH: storage,
	CUSTOM_DOMAIN_TARGET: "domains.example.test",
	CUSTOM_DOMAIN_PROVIDER_SECRET: "isolated-ci-custom-domain-secret",
};

function run(command, commandArgs) {
	const result = spawnSync(command, commandArgs, { cwd: root, env, stdio: "inherit" });
	if (result.error) throw result.error;
	return result.status ?? 1;
}

if (build) {
	const status = run("pnpm", ["build"]);
	if (status !== 0) process.exit(status);
} else if (!existsSync(resolve(root, "apps/server/dist/index.mjs"))) {
	console.error(
		"apps/server/dist/index.mjs is missing. Run `pnpm test:e2e:local --build` to build the app before testing.",
	);
	process.exit(1);
}

await ensureDatabases([database]);
mkdirSync(storage, { recursive: true });
console.error(`\nTesting on ${env.APP_URL} with database ${database} and storage ${storage}\n`);
process.exitCode = run("pnpm", ["exec", "playwright", "test", ...playwrightArgs]);
