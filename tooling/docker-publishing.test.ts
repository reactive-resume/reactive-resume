import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("keeps smoke dispatches out of release publishing and production deployment", () => {
	const workflow = readFileSync(new URL("../.github/workflows/docker-build.yml", import.meta.url), "utf8");
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
