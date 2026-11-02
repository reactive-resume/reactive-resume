import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vite-plus/test";
import { checkDocs } from "./check.mjs";

const roots = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "rr-docs-check-"));
	roots.push(root);
	for (const path of ["docs/guides", "docs/images", "apps/web/locales", "apps/web/src", "apps/mobile/src"]) {
		await mkdir(join(root, path), { recursive: true });
	}
	await writeFile(join(root, "apps/web/locales/en-US.po"), 'msgid "Save changes"\nmsgstr ""\n');
	await writeFile(join(root, "apps/mobile/src/label.tsx"), "<Text>App-only</Text>");
	await writeFile(join(root, "docs/docs.json"), '{"logo": "/images/logo.svg"}');
	await writeFile(join(root, "docs/images/logo.svg"), "<svg />");
	await writeFile(join(root, "docs/images/used.svg"), "<svg />");
	await writeFile(join(root, "docs/images/readme.svg"), "<svg />");
	await writeFile(join(root, "README.md"), "![Sponsor](docs/images/readme.svg)");
	return root;
}

test("accepts catalog and app labels, real images, relative and custom anchors, and ignores fenced examples", async () => {
	const root = await fixture();
	await writeFile(
		join(root, "docs/guides/start.mdx"),
		[
			"# Start",
			"**Save changes** and **App-only**",
			"![Used](/images/used.svg)",
			"## Repeat",
			"## Repeat",
			"[Again](start#repeat-1)",
			'<Accordion id="details">Details</Accordion>',
			"[Details](#details)",
			"[Outside](https://example.com/missing)",
			"```md",
			"[Example](/missing)",
			"```",
		].join("\n"),
	);
	expect(await checkDocs(root)).toEqual([]);
});

test("reports broken references, stale labels and orphan assets while the CLI remains warning-only", async () => {
	const root = await fixture();
	await writeFile(join(root, "docs/images/orphan.svg"), "<svg />");
	await writeFile(
		join(root, "docs/guides/start.mdx"),
		[
			"# Start",
			"```md",
			"ignored example",
			"```",
			"**Save Changes**",
			"[Missing](/guides/missing)",
			"[Heading](#missing)",
			"[Invalid](#%ZZ)",
			"![Missing](/images/missing.svg)",
			"![Used](/images/used.svg)",
		].join("\n"),
	);
	const findings = await checkDocs(root);
	expect(findings).toEqual(
		expect.arrayContaining([
			{ file: "docs/guides/start.mdx", line: 5, message: "Review bold wording against the UI: Save Changes" },
			expect.objectContaining({ message: "Missing page: /guides/missing" }),
			expect.objectContaining({ message: "Unknown heading: #missing" }),
			expect.objectContaining({ message: "Invalid heading encoding: #%ZZ" }),
			expect.objectContaining({ message: "Missing image: /images/missing.svg" }),
			expect.objectContaining({ file: "docs/images/orphan.svg" }),
		]),
	);
	expect(findings).toHaveLength(6);
	const result = spawnSync(process.execPath, [fileURLToPath(new URL("./check.mjs", import.meta.url))], {
		cwd: root,
		encoding: "utf8",
	});
	expect(result.status, result.stderr).toBe(0);
	expect(result.stdout).toContain("6 warnings. No files changed.");
	expect(result.stderr).toContain("Missing image: /images/missing.svg");
});
