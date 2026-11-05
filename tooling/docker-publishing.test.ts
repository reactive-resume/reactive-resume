import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";

it("keeps smoke dispatches out of release publishing and production deployment", () => {
	const workflow = readFileSync(new URL("../.github/workflows/docker-publish.yml", import.meta.url), "utf8");
	const mode = workflow.match(/ {8}run: \|\n([\s\S]*?)\n {2}build:/)?.[1];
	if (!mode) throw new Error("Publishing mode script is missing");
	const directory = mkdtempSync(join(tmpdir(), "docker-publishing-"));

	try {
		for (const [event, ref, release, expected] of [
			["push", "refs/heads/main", "", "nightly"],
			["push", "refs/tags/v6.0.0", "", "release"],
			["workflow_dispatch", "refs/heads/main", "", "canary"],
			["workflow_dispatch", "refs/heads/main", "false", "canary"],
			["workflow_dispatch", "refs/heads/main", "true", "release"],
		]) {
			const output = join(directory, `${event}-${release || "default"}-${expected}`);
			execFileSync("bash", ["-eu", "-c", mode], {
				env: { ...process.env, EVENT_NAME: event, GIT_REF: ref, RELEASE: release, GITHUB_OUTPUT: output },
			});
			const values = Object.fromEntries(
				readFileSync(output, "utf8")
					.trim()
					.split("\n")
					.map((line) => line.split("=")),
			);
			expect(values).toEqual({
				nightly: String(expected === "nightly"),
				release: String(expected === "release"),
				canary: String(expected === "canary"),
			});
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

it("validates release tags against the built version and distinguishes prereleases", () => {
	const workflow = readFileSync(new URL("../.github/workflows/docker-publish.yml", import.meta.url), "utf8");
	const script = workflow.match(
		/      - name: Resolve source commit and version[\s\S]*?        run: \|\n([\s\S]*?)(?=\n      - name:)/,
	)?.[1];
	if (!script) throw new Error("Publishing version script is missing");
	const directory = mkdtempSync(join(tmpdir(), "docker-version-"));
	const commit = "a".repeat(40);

	try {
		writeFileSync(join(directory, "git"), `#!/usr/bin/env bash\necho ${commit}\n`, { mode: 0o755 });
		for (const [event, ref, version, prerelease, status] of [
			["push", "refs/tags/v6.0.0", "6.0.0", "false", 0],
			["push", "refs/tags/v6.0.0-rc.1", "6.0.0-rc.1", "true", 0],
			["push", "refs/tags/v6.0.1", "6.0.0", "false", 1],
			["push", "refs/tags/v6.0", "6.0.0", "false", 1],
			["workflow_dispatch", "refs/heads/main", "6.0.0", "false", 0],
			["workflow_dispatch", "refs/heads/main", "6.0.0-rc.1", "true", 0],
			["workflow_dispatch", "refs/heads/fix", "6.0.0", "false", 0],
			["workflow_dispatch", "refs/tags/v6.0.0", "6.0.0", "false", 0],
			["workflow_dispatch", "refs/tags/v6.0.0-rc.1", "6.0.0-rc.1", "true", 0],
			["workflow_dispatch", "refs/tags/v6.0.1", "6.0.0", "false", 1],
		] as const) {
			const output = join(directory, "output");
			writeFileSync(output, "");
			writeFileSync(join(directory, "package.json"), JSON.stringify({ version }));
			const result = spawnSync("bash", ["-eu", "-c", script], {
				cwd: directory,
				encoding: "utf8",
				env: {
					...process.env,
					PATH: `${directory}:${process.env.PATH}`,
					EVENT_NAME: event,
					GIT_REF: ref,
					GITHUB_OUTPUT: output,
				},
			});
			expect(result.status, result.stderr).toBe(status);
			expect(readFileSync(output, "utf8")).toBe(
				status === 0 ? `version=${version}\nsha=${commit}\nprerelease=${prerelease}\n` : "",
			);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

const commit = "a".repeat(40);
const healthy = { service: "reactive-resume", status: "healthy", version: "6.0.0", revision: commit };

it.each([
	["matching release", [healthy], 0, 3],
	["previous commit with same version", [{ ...healthy, revision: "b".repeat(40) }], 1, 60],
	[
		"rolling deployment and transient failures reset consecutive matches",
		[
			healthy,
			healthy,
			{ ...healthy, version: "5.0.0" },
			healthy,
			healthy,
			"HTTP_ERROR",
			healthy,
			healthy,
			"not JSON",
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
		18,
	],
] as const)("waits for published release before cache purge: %s", (_name, responses, status, probes) => {
	const workflow = readFileSync(new URL("../.github/workflows/docker-publish.yml", import.meta.url), "utf8");
	const script = workflow.match(
		/      - name: Deploy production app[\s\S]*?      - name: Wait for healthy production version[\s\S]*?        run: \|\n([\s\S]*?)(?=\n      - name: Purge production Cloudflare cache)/,
	)?.[1];
	if (!script) throw new Error("Production readiness check must run between deployment and cache purge");
	const directory = mkdtempSync(join(tmpdir(), "docker-readiness-"));
	try {
		writeFileSync(
			join(directory, "responses"),
			responses.map((response) => (typeof response === "string" ? response : JSON.stringify(response))).join("\n") +
				"\n",
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
if [[ "$line" == HTTP_ERROR ]]; then exit 22; fi
printf '%s\\n' "$line"
`,
			{ mode: 0o755 },
		);
		const result = spawnSync("bash", ["-eu", "-c", script], {
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${directory}:${process.env.PATH}`,
				FIXTURE: directory,
				COMMIT_SHA: commit,
				VERSION: healthy.version,
			},
		});
		expect(result.status, result.stderr).toBe(status);
		expect(Number(readFileSync(join(directory, "count"), "utf8"))).toBe(probes);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

it.each([
	["complete GHCR index", "", false, false, 0, 1],
	["missing GHCR source", "ghcr.io/example/app", false, false, 1, 0],
	["incomplete GHCR index", "", true, false, 1, 0],
	["registry changes copied digest", "", false, true, 1, 1],
])("promotes complete SHA indexes: %s", (_name, missing, incomplete, changed, status, copies) => {
	const directory = mkdtempSync(join(tmpdir(), "docker-promotion-"));
	const ghcr = "ghcr.io/example/app";
	const commit = "a".repeat(40);
	const digest = `sha256:${"b".repeat(64)}`;
	const log = join(directory, "copies");
	const output = join(directory, "output");
	const index = (architectures: string[]) =>
		JSON.stringify({ manifests: architectures.map((architecture) => ({ platform: { os: "linux", architecture } })) });

	try {
		writeFileSync(log, "");
		writeFileSync(output, "");
		writeFileSync(join(directory, "complete.json"), index(["amd64", "arm64"]));
		writeFileSync(join(directory, "incomplete.json"), index(["amd64"]));
		writeFileSync(join(directory, "sleep"), "#!/usr/bin/env bash\nexit 0\n", { mode: 0o755 });
		// Registry fixture accepts only index inspection and digest-addressed copies.
		// Any build, pull/tag/push, or annotation mutation exits unsuccessfully.
		writeFileSync(
			join(directory, "docker"),
			`#!/usr/bin/env bash
set -euo pipefail
[[ "$1 $2" == "buildx imagetools" ]] || exit 2
case "$3" in
  inspect)
    [[ -z "$MISSING" || "$4" != "$MISSING:sha-$COMMIT_SHA" ]] || exit 1
    if [[ "$5" == "--raw" ]]; then
      if [[ "$INCOMPLETE" == true ]]; then
        cat "$FIXTURE/incomplete.json"
      else
        cat "$FIXTURE/complete.json"
      fi
    elif [[ "$CHANGED" == true && "$4" != *:sha-* ]]; then
      printf '"sha256:%064d"\\n' 0
    else
      printf '"%s"\\n' "$DIGEST"
    fi
    ;;
  create)
    shift 3
    tags=()
    while [[ "$1" == --tag ]]; do tags+=("$2"); shift 2; done
    [[ $# == 1 && "$1" == *@"$DIGEST" ]] || exit 2
    printf '%s\\n' "$*" "${"$"}{tags[@]}" >> "$COPY_LOG"
    ;;
  *) exit 2 ;;
esac
`,
			{ mode: 0o755 },
		);
		const result = spawnSync("bash", [new URL("./docker/promote.sh", import.meta.url).pathname], {
			encoding: "utf8",
			env: {
				...process.env,
				PATH: `${directory}:${process.env.PATH}`,
				COMMIT_SHA: commit,
				GHCR_IMAGE: ghcr,
				GITHUB_OUTPUT: output,
				DOCKER_METADATA_OUTPUT_JSON: JSON.stringify({
					tags: [`${ghcr}:latest`, `${ghcr}:v6.0.0`],
				}),
				MISSING: missing,
				INCOMPLETE: String(incomplete),
				CHANGED: String(changed),
				FIXTURE: directory,
				DIGEST: digest,
				COPY_LOG: log,
			},
		});
		expect(result.status, result.stderr).toBe(status);
		const copied = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
		if (copies === 0) {
			expect(copied).toEqual([]);
			expect(readFileSync(output, "utf8")).toBe("");
		} else if (changed) {
			expect(copied).toHaveLength(3);
			expect(result.stdout).toContain("Digest changed while promoting");
			expect(readFileSync(output, "utf8")).toBe("");
		} else {
			expect(copied).toEqual([`${ghcr}@${digest}`, `${ghcr}:latest`, `${ghcr}:v6.0.0`]);
			expect(readFileSync(output, "utf8")).toBe(`ghcr_digest=${digest}\n`);
		}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
