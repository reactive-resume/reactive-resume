#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureDatabases } from "../dev/test-db.mjs";
import { aiBaseUrl, apiOnly, appUrl, database, env, healthy, ports, root, state } from "./env.mjs";

// The standing dev server for Calm captures: Vite with hot reload on :3410, the API (tsx watch, clock from
// fake-clock.mjs) on :3411 and the e2e AI stub on :3412, against the private database rr_calm_capture.
//
//   node tooling/calm/dev.mjs start    start in the background (log: <work>/state/dev.log) and wait until it answers
//   node tooling/calm/dev.mjs status   say whether it answers
//   node tooling/calm/dev.mjs stop     stop it
//   node tooling/calm/dev.mjs restart
//   node tooling/calm/dev.mjs run      run in the foreground
const pidFile = resolve(state, "dev.pid");
const logFile = resolve(state, "dev.log");
const command = process.argv[2] ?? "status";
const wait = (ms) => new Promise((done) => setTimeout(done, ms));

function stop() {
	if (!existsSync(pidFile)) return;
	// The background process leads its own process group; its children are spawned without pnpm, so they stay in it.
	try {
		process.kill(-Number(readFileSync(pidFile, "utf8")), "SIGTERM");
	} catch {
		// Already gone.
	}
	rmSync(pidFile);
}

async function start() {
	if (await healthy()) return console.log(`Already running on ${appUrl}`);
	stop();
	mkdirSync(state, { recursive: true });
	const log = openSync(logFile, "a");
	const child = spawn(process.execPath, [import.meta.filename, "run"], { detached: true, stdio: ["ignore", log, log] });
	child.unref();
	writeFileSync(pidFile, String(child.pid));
	for (let i = 0; i < 90; i++) {
		if (await healthy()) return console.log(`Running on ${appUrl} (log: ${logFile})`);
		await wait(2000);
	}
	console.error(`Not answering after 3 minutes. Read ${logFile}`);
	process.exitCode = 1;
}

async function run() {
	mkdirSync(env.LOCAL_STORAGE_PATH, { recursive: true });
	await ensureDatabases([database]);
	// Node 24 runs the e2e stub's TypeScript as it is.
	const { startAiStub } = await import(pathToFileURL(resolve(root, "tests/e2e/fixtures/ai-stub.ts")).href);
	await startAiStub(ports.ai);
	console.log(`AI stub on ${aiBaseUrl}`);

	// A process that exits (a bad config edit, a crash while several agents are mid-change) comes back by itself.
	const keep = (name, cwd, bin, args) => {
		const child = spawn(resolve(root, cwd, "node_modules/.bin", bin), args, {
			cwd: resolve(root, cwd),
			env: { ...process.env, ...env },
			stdio: "inherit",
		});
		child.on("exit", (code) => {
			console.error(`[calm] ${name} exited (${code}); restarting in 3s`);
			setTimeout(() => keep(name, cwd, bin, args), 3000);
		});
	};
	keep("server", "apps/server", "tsx", [
		"watch",
		"--tsconfig",
		"../../tsconfig.json",
		"--import",
		pathToFileURL(resolve(import.meta.dirname, "fake-clock.mjs")).href,
		"src/index.ts",
	]);
	if (!apiOnly) keep("web", "apps/web", "vp", ["dev"]);
}

if (command === "run") await run();
else if (command === "start") await start();
else if (command === "stop") stop();
else if (command === "restart") {
	stop();
	await wait(1500);
	await start();
} else
	console.log((await healthy()) ? `Running on ${appUrl}` : `Not running. Start it: node tooling/calm/dev.mjs start`);
