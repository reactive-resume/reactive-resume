// Keeps agent docs truthful: every repo path they name exists, the always-loaded guides stay under their size
// budgets, every AGENTS.md has a CLAUDE.md symlink, no gitignored file is force-added, and ticket notes stay out of
// .agents/docs. Run with `pnpm check:agent-docs`.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { basename, dirname, join, normalize } from "node:path";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

// Codex stops reading project instructions at 32 KiB in total; the root guide and an area guide load together.
const BUDGETS = { "AGENTS.md": 16_000, nested: 12_000 };
// Historical records may name files that have since moved or gone.
const HISTORICAL = [".agents/docs/decisions/", ".agents/docs/research/"];
const TICKET_ID = /(^|[^a-z])rx-?\d+/i;

const tracked = git("ls-files", "-z").split("\0").filter(Boolean);
const topLevel = new Set(tracked.map((path) => path.split("/")[0]));
const problems = [];

const guides = tracked.filter((path) => basename(path) === "AGENTS.md");
const docs = [
	...guides,
	"CODING_STANDARDS.md",
	...tracked.filter((path) => path.startsWith(".agents/docs/") && path.endsWith(".md")),
	...tracked.filter((path) => /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(path)),
].filter((path) => existsSync(join(root, path)) && !HISTORICAL.some((prefix) => path.startsWith(prefix)));

function isIgnored(path) {
	try {
		git("check-ignore", "-q", "--no-index", path);
		return true;
	} catch {
		return false;
	}
}

function candidatePaths(markdown) {
	const spans = [...markdown.matchAll(/```[^\n]*\n([\s\S]*?)```|`([^`\n]+)`/g)].map((match) => ({
		text: match[1] ?? match[2],
		command: match[1] !== undefined,
	}));
	return spans.flatMap(({ text, command }) =>
		text
			.split(/[\s"'(),=]+/)
			.map((token) =>
				token
					.replace(/[.,:;]+$/, "")
					.replace(/#.*$/, "")
					.replace(/:\d+(-\d+)?$/, ""),
			)
			.filter((token) => !/[*<>{}|…]|\.\.\./.test(token) && !token.startsWith("-"))
			.filter((token) => {
				const first = token.split("/")[0];
				if (topLevel.has(first)) return token.includes("/") || /\.[a-z]+$/i.test(token);
				// Inline file paths under a top-level folder that is gone, or relative to the doc's folder. Command blocks
				// are skipped here: `pnpm --filter <pkg> exec …` arguments are relative to the package. URLs and package
				// names never match.
				return !command && token.includes("/") && /^[\w-]+$/.test(first) && /\.[a-z0-9]+$/i.test(token);
			}),
	);
}

function relativeLinks(markdown, doc) {
	return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)]
		.map((match) => match[1].replace(/#.*$/, ""))
		.filter((target) => target && !/^[a-z]+:/i.test(target) && !target.startsWith("/") && !/\.\.\.|…/.test(target))
		.map((target) => normalize(join(dirname(doc), decodeURIComponent(target))));
}

for (const doc of docs) {
	const markdown = readFileSync(join(root, doc), "utf8");
	const missing = new Set();
	for (const path of [...candidatePaths(markdown), ...relativeLinks(markdown, doc)]) {
		const found = existsSync(join(root, path)) || existsSync(join(root, dirname(doc), path));
		if (!found && !isIgnored(path)) missing.add(path);
	}
	for (const path of missing) problems.push(`${doc}: names \`${path}\`, which doesn't exist`);
}

for (const guide of guides) {
	const size = Buffer.byteLength(readFileSync(join(root, guide)));
	const budget = guide === "AGENTS.md" ? BUDGETS["AGENTS.md"] : BUDGETS.nested;
	if (size > budget)
		problems.push(`${guide}: ${size} bytes, over its ${budget}-byte budget; move detail into a linked doc`);

	const claude = join(dirname(guide), "CLAUDE.md");
	const link = join(root, claude);
	const ok = existsSync(link) && lstatSync(link).isSymbolicLink() && readlinkSync(link) === "AGENTS.md";
	if (!ok) problems.push(`${claude}: must be a symlink to AGENTS.md so Claude Code loads ${guide}`);
}

for (const path of git("ls-files", "-ci", "--exclude-standard", "-z").split("\0").filter(Boolean)) {
	problems.push(`${path}: tracked although .gitignore ignores it; untrack it or allow-list it in .gitignore`);
}

for (const path of tracked.filter((path) => path.startsWith(".agents/docs/"))) {
	if (TICKET_ID.test(basename(path))) {
		problems.push(`${path}: ticket ID in an agent doc name; ticket notes belong on the Linear issue`);
	}
}

if (problems.length > 0) {
	console.error(`Agent docs check failed (${problems.length}):\n${problems.map((line) => `- ${line}`).join("\n")}`);
	process.exit(1);
}
console.log(`Agent docs OK: ${docs.length} docs, ${guides.length} AGENTS.md guides.`);
