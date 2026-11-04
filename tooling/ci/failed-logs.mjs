// Prints only the failure blocks of failed GitHub Actions jobs, even while the run is still in progress.
// Usage: pnpm ci:logs [run URL | run ID | job URL] [--full]. Without a target it reads every run for the newest commit
// on the current branch. --full also writes each cleaned log to a temp file and prints its path.
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, promisify, stripVTControlCharacters } from "node:util";

const MAX_LINES = 150;
const MAX_WIDTH = 400;
const run = promisify(execFile);

/** Strips ANSI codes and timestamps, then keeps Vitest, Playwright, TypeScript and `##[error]` blocks. */
function failureBlocks(log) {
	const lines = stripVTControlCharacters(log)
		.split(/\r?\n/)
		.map((line) => line.replace(/^\uFEFF?\d{4}-\d\d-\d\dT[\d:.]+Z ?/, ""));
	const blocks = [];
	const take = (start, end) => blocks.push({ start, end: Math.min(end, lines.length) });
	const until = (start, stop, max = 40) => {
		let end = start + 1;
		while (end < lines.length && end - start < max && !stop.test(lines[end])) end++;
		return end;
	};
	const playwrightTest = /^\s+\d+\) \[/;
	lines.forEach((line, i) => {
		if (/^\s*FAIL\s/.test(line)) take(i, until(i, /⎯{3,}|^\s*FAIL\s/));
		else if (playwrightTest.test(line))
			take(
				i,
				until(i, /^\s+\d+\) \[|^\s+\d+ (failed|flaky|passed|skipped|interrupted)|^\s+attachment #|Error Context:/),
			);
		else if (/error TS\d+:|^\s*✘/.test(line)) take(i, i + 1);
	});
	const detailed = blocks.map(({ start, end }) => lines.slice(start, end).join("\n")).join("\n");
	lines.forEach((line, i) => {
		if (!line.startsWith("##[error]")) return;
		if (detailed.includes(line.slice(9).trim().slice(0, 120))) return;
		take(Math.max(0, i - 5), until(i, /^\s*$|^##\[|^Post job cleanup/, 8));
	});

	blocks.sort((a, b) => a.start - b.start);
	const output = [];
	let last = -1;
	for (const { start, end } of blocks) {
		if (end <= last) continue;
		if (output.length) output.push("…");
		for (let i = Math.max(start, last); i < end; i++) {
			const line = lines[i].replace(/^##\[error\]/, "error: ");
			if (!/^##\[(group|endgroup)\]/.test(line)) output.push(line.slice(0, MAX_WIDTH));
		}
		last = end;
	}
	return { lines, output };
}

async function gh(...args) {
	return (await run("gh", args, { encoding: "utf8", maxBuffer: 1 << 28 })).stdout;
}

async function main() {
	const { values, positionals } = parseArgs({ options: { full: { type: "boolean" } }, allowPositionals: true });
	const target = positionals[0] ?? "";
	const url = target.match(/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(?:\/job\/(\d+))?/);
	const repo = url?.[1] ?? "{owner}/{repo}";
	const api = async (path) => JSON.parse(await gh("api", `repos/${repo}/${path}`));

	let jobs;
	let runs = [];
	if (url?.[3]) jobs = [await api(`actions/jobs/${url[3]}`)];
	else {
		if (url || /^\d+$/.test(target)) runs = [await api(`actions/runs/${url?.[2] ?? target}`)];
		else if (target) throw new Error(`Expected a run URL, run ID or job URL, got ${target}.`);
		else {
			const branch = (await run("git", ["branch", "--show-current"], { encoding: "utf8" })).stdout.trim();
			const { workflow_runs: recent } = await api(`actions/runs?branch=${encodeURIComponent(branch)}&per_page=30`);
			runs = recent.filter((item) => item.head_sha === recent[0]?.head_sha);
			if (!runs.length) throw new Error(`No workflow runs for branch ${branch}.`);
		}
		jobs = (await Promise.all(runs.map((item) => api(`actions/runs/${item.id}/jobs?per_page=100`))))
			.flatMap((page) => page.jobs)
			.filter((job) => job.conclusion === "failure");
	}

	for (const item of runs) {
		const state = item.status === "completed" ? item.conclusion : `${item.status}, showing jobs that already failed`;
		console.log(`${item.name} #${item.run_number} (${state}): ${item.html_url}`);
	}
	if (!jobs.length) console.log("No failed jobs.");

	const logs = await Promise.all(
		jobs.map((job) => gh("api", "--allow-escape-sequences", `repos/${repo}/actions/jobs/${job.id}/logs`)),
	);
	// mkdtemp creates a private (0700) directory; "wx" refuses to follow or overwrite an existing path.
	const directory = values.full ? await mkdtemp(join(tmpdir(), "ci-logs-")) : "";
	for (const [index, job] of jobs.entries()) {
		const steps = (job.steps ?? []).filter((step) => step.conclusion === "failure").map((step) => step.name);
		console.log(`\n■ ${job.name} (${job.conclusion ?? job.status}) · failed step: ${steps.join(", ") || "none"}`);
		console.log(`  ${job.html_url}`);
		const { lines, output } = failureBlocks(logs[index]);
		console.log(output.slice(0, MAX_LINES).join("\n") || "(no failure blocks found; use --full)");
		if (output.length > MAX_LINES) console.log(`… ${output.length - MAX_LINES} more lines; use --full`);
		if (values.full) {
			const path = join(directory, `job-${job.id}.log`);
			await writeFile(path, lines.join("\n"), { flag: "wx", mode: 0o600 });
			console.log(`full log: ${path}`);
		}
	}
}

await main().catch((error) => {
	console.error(error.stderr?.trim() || error.message);
	process.exitCode = 1;
});
