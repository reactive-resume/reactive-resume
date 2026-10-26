import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";

const workflow = readFileSync(new URL("../.github/workflows/docker-build.yml", import.meta.url), "utf8");
const commit = "a".repeat(40);

it("publishes production only after stable deployment, and skips superseded main previews", () => {
	const script = workflow.match(
		/      - name: Select mobile update channel[\s\S]*?        run: \|\n([\s\S]*?)\n  mobile-update:/,
	)?.[1];
	if (!script) throw new Error("Mobile channel selection script is missing");
	const directory = mkdtempSync(join(tmpdir(), "mobile-channel-"));
	try {
		writeFileSync(join(directory, "git"), `#!/usr/bin/env bash\nprintf '%s\\trefs/heads/main\\n' "$MAIN_SHA"\n`, {
			mode: 0o755,
		});
		for (const [release, prerelease, deployed, nightly, main, expected] of [
			["true", "false", "success", "false", commit, "production"],
			["true", "false", "skipped", "false", commit, ""],
			["true", "false", "failure", "false", commit, ""],
			["true", "true", "skipped", "false", commit, "preview"],
			["false", "false", "skipped", "true", commit, "preview"],
			["false", "false", "skipped", "true", "b".repeat(40), ""],
			["false", "false", "skipped", "false", "b".repeat(40), "preview"],
		]) {
			const output = join(directory, "output");
			writeFileSync(output, "");
			const result = spawnSync("bash", ["-eu", "-c", script], {
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${directory}:${process.env.PATH}`,
					RELEASE: release,
					PRERELEASE: prerelease,
					DEPLOYED: deployed,
					NIGHTLY: nightly,
					COMMIT_SHA: commit,
					MAIN_SHA: main,
					GITHUB_OUTPUT: output,
				},
			});
			expect(result.status, result.stderr).toBe(0);
			expect(readFileSync(output, "utf8")).toBe(expected ? `channel=${expected}\n` : "");
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
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
	const script = workflow.match(
		/      - name: Wait for matching production backend[\s\S]*?        run: \|\n([\s\S]*?)(?=\n      - name:)/,
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
