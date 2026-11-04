import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, it } from "vite-plus/test";

const workflow = readFileSync(new URL("../.github/workflows/docker-publish.yml", import.meta.url), "utf8");
const otaWorkflow = readFileSync(new URL("../.github/workflows/mobile-ota-update.yml", import.meta.url), "utf8");
const commit = "a".repeat(40);

it.each([
	["stable release", "true", "false", "success", true],
	["nightly or canary", "false", "false", "skipped", false],
	["prerelease", "true", "true", "skipped", false],
	["missing deployment", "true", "false", "skipped", false],
	["failed deployment", "true", "false", "failure", false],
] as const)(
	"allows production OTA only after stable deployment: %s",
	(_name, release, prerelease, deployed, expected) => {
		const expression = workflow.match(/mobile_ota: \$\{\{ (.+) \}\}/)?.[1];
		if (!expression) throw new Error("Mobile OTA eligibility output is missing");
		expect(
			runInNewContext(expression, {
				needs: { plan: { outputs: { release } } },
				steps: { version: { outputs: { prerelease } }, deploy: { outcome: deployed } },
			}),
		).toBe(expected);
	},
);

it.each([
	["success", "true", false, true],
	["success", "false", false, false],
	["failure", "true", false, false],
	["success", "true", true, false],
] as const)("gates OTA on Docker result=%s, eligible=%s, cancelled=%s", (result, mobile_ota, cancelled, expected) => {
	const expression = workflow.match(/  mobile-ota-update:\n[\s\S]*?    if: \$\{\{ (.+) \}\}/)?.[1];
	if (!expression) throw new Error("Mobile OTA caller condition is missing");
	expect(
		runInNewContext(expression, {
			cancelled: () => cancelled,
			needs: { publish: { result, outputs: { mobile_ota } } },
		}),
	).toBe(expected);
});

const healthy = { service: "reactive-resume", status: "healthy", revision: commit };
const previous = { ...healthy, revision: "b".repeat(40) };

it.each([
	["matching healthy backend", [healthy], 0, 3],
	["previous commit", [previous], 1, 60],
	[
		"rolling deployment resets stability for every rejected probe",
		[
			healthy,
			healthy,
			previous,
			healthy,
			healthy,
			{ ...healthy, status: "unhealthy" },
			healthy,
			healthy,
			{ ...healthy, service: "other" },
			healthy,
			healthy,
			healthy,
		],
		0,
		12,
	],
] as const)("requires three consecutive matching production probes: %s", (_name, responses, status, probes) => {
	const script = otaWorkflow.match(
		/      - name: Wait for healthy backend at source commit[\s\S]*?        run: \|\n([\s\S]*?)(?=\n      - name:)/,
	)?.[1];
	if (!script) throw new Error("Production backend check is missing");
	const directory = mkdtempSync(join(tmpdir(), "mobile-backend-"));
	try {
		writeFileSync(
			join(directory, "responses"),
			responses.map((response) => JSON.stringify(response)).join("\n") + "\n",
		);
		writeFileSync(join(directory, "count"), "0");
		writeFileSync(join(directory, "sleep"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
		writeFileSync(
			join(directory, "curl"),
			`#!/usr/bin/env bash
set -eu
count=$(cat "$FIXTURE/count")
count=$((count + 1))
echo "$count" > "$FIXTURE/count"
line=$(sed -n "${"$"}{count}p" "$FIXTURE/responses")
if [[ -z "$line" ]]; then line=$(tail -n 1 "$FIXTURE/responses"); fi
printf '%s\\n' "$line"
`,
			{ mode: 0o755 },
		);
		const result = spawnSync("bash", ["-eu", "-c", script], {
			encoding: "utf8",
			env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FIXTURE: directory, COMMIT_SHA: commit },
		});
		expect(result.status, result.stderr).toBe(status);
		expect(Number(readFileSync(join(directory, "count"), "utf8"))).toBe(probes);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
