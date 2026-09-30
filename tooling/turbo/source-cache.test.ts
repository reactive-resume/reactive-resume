import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const turbo = join(root, "node_modules", "turbo", "bin", "turbo");
const tasks = ["build", "typecheck", "test", "test:coverage", "test:ci", "test:agent"];
type DryTask = { taskId: string; task: string; hash: string };
let directory: string;
let baseline: Map<string, DryTask>;

function dryRun(environment: NodeJS.ProcessEnv = {}) {
	const output = execFileSync(process.execPath, [turbo, "run", ...tasks, "--dry=json"], {
		cwd: directory,
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
		env: { ...process.env, ...environment, TURBO_TELEMETRY_DISABLED: "1" },
	});
	const result = JSON.parse(output) as { tasks: DryTask[] };
	return new Map(result.tasks.map((task) => [task.taskId, task]));
}

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "reactive-resume-turbo-cache-"));
	const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
	await writeFile(
		join(directory, "package.json"),
		JSON.stringify({ private: true, packageManager: packageJson.packageManager }),
	);
	await writeFile(join(directory, "pnpm-workspace.yaml"), 'packages: ["packages/*"]\n');
	await writeFile(join(directory, ".gitignore"), "node_modules/\n.turbo/\ncoverage/\nreports/\n");
	await writeFile(join(directory, "turbo.json"), await readFile(join(root, "turbo.json")));
	for (const file of ["vitest.shared.mts", "vitest.setup.ts"]) {
		await writeFile(join(directory, file), "export {};\n");
	}

	// app -> api -> pdf mirrors a source-consumed dependency with no build script.
	const dependencies: Record<string, string[]> = { app: ["api"], api: ["pdf"], pdf: [] };
	let lock = "lockfileVersion: '9.0'\nimporters:\n  .: {}\n";
	for (const [name, deps] of Object.entries(dependencies)) {
		const packageDirectory = join(directory, "packages", name);
		await mkdir(packageDirectory, { recursive: true });
		await writeFile(join(packageDirectory, "source.ts"), "export const value = 1;\n");
		await writeFile(
			join(packageDirectory, "package.json"),
			JSON.stringify({
				name,
				version: "0.0.0",
				private: true,
				dependencies: Object.fromEntries(deps.map((dependency) => [dependency, "workspace:*"])),
				scripts:
					name === "pdf"
						? {}
						: Object.fromEntries(
								tasks.map((task) => {
									const output = task === "test:coverage" ? "coverage" : "reports";
									return [
										task,
										`node -e 'const fs = require("node:fs"); fs.mkdirSync("${output}", { recursive: true }); fs.writeFileSync("${output}/${task.replace(":", "-")}.txt", "complete");'`,
									];
								}),
							),
			}),
		);
		lock += `  packages/${name}:`;
		lock += deps.length
			? `\n    dependencies:\n${deps.map((dependency) => `      ${dependency}:\n        specifier: workspace:*\n        version: link:../${dependency}\n`).join("")}`
			: " {}\n";
	}
	await writeFile(join(directory, "pnpm-lock.yaml"), lock);
	baseline = dryRun();
});

afterAll(async () => {
	if (directory) await rm(directory, { recursive: true, force: true });
});

async function withChangedSource(name: string, check: (result: Map<string, DryTask>) => void) {
	const path = join(directory, "packages", name, "source.ts");
	const original = await readFile(path);
	try {
		await writeFile(path, "export const value = 2;\n");
		check(dryRun());
	} finally {
		await writeFile(path, original);
	}
}

it("invalidates every cached consumer task after a transitive source-only package changes", async () => {
	await withChangedSource("pdf", (result) => {
		for (const name of ["app", "api"]) {
			for (const task of tasks) {
				const id = `${name}#${task}`;
				expect(result.get(id)?.hash, id).not.toBe(baseline.get(id)?.hash);
			}
		}
	});
});

it("keeps cache keys stable when sources are unchanged", () => {
	expect(dryRun()).toEqual(baseline);
});

it.each(["vitest.shared.mts", "vitest.setup.ts"])("invalidates consumer tests when %s changes", async (file) => {
	const path = join(directory, file);
	const original = await readFile(path);
	try {
		await writeFile(path, "export const changed = true;\n");
		const result = dryRun();
		for (const task of tasks.filter((task) => task.startsWith("test"))) {
			const id = `app#${task}`;
			expect(result.get(id)?.hash, id).not.toBe(baseline.get(id)?.hash);
		}
	} finally {
		await writeFile(path, original);
	}
});

it("hashes runtime secrets for tests without invalidating builds or typechecks", () => {
	const before = dryRun({ AUTH_SECRET: "cache-audit-before" });
	const after = dryRun({ AUTH_SECRET: "cache-audit-after" });
	for (const task of tasks) {
		const id = `app#${task}`;
		if (task.startsWith("test")) expect(after.get(id)?.hash, id).not.toBe(before.get(id)?.hash);
		else expect(after.get(id)?.hash, id).toBe(before.get(id)?.hash);
	}
});

it.each(["test:coverage", "test:ci", "test:agent"])("restores %s reports from cache", async (task) => {
	const output = task === "test:coverage" ? "coverage" : "reports";
	const path = join(directory, "packages", "app", output, `${task.replace(":", "-")}.txt`);
	const run = () =>
		execFileSync(process.execPath, [turbo, "run", task, "--filter=app", "--cache=local:rw"], {
			cwd: directory,
			encoding: "utf8",
			env: { ...process.env, TURBO_TELEMETRY_DISABLED: "1" },
		});
	run();
	await rm(path);
	expect(run()).toContain("cache hit");
	expect(await readFile(path, "utf8")).toBe("complete");
});
