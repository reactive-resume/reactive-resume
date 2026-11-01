// Execute actual web/native/domain owners against HTTP-read persisted summaries. Only translation is a boundary.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "../../..");
const serverRequire = createRequire(root + "/apps/server/package.json");
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const cache = new Map();
function load(file) {
	if (cache.has(file)) return cache.get(file);
	const module = { exports: {} };
	cache.set(file, module.exports);
	let source = process.env.RX112_SOURCE_TREE
		? execFileSync("rtk", ["proxy", "git", "show", process.env.RX112_SOURCE_TREE + ":" + path.relative(root, file)], {
				cwd: root,
				encoding: "utf8",
			})
		: fs.readFileSync(file, "utf8");
	if (process.env.RX112_MUTATION === "lane-clock" && file.endsWith("schema/src/applications/next-step.ts"))
		source = source.replace("entry.canonicalTransition !== false", "true");
	if (process.env.RX112_MUTATION === "rank" && file.endsWith("schema/src/applications/next-step.ts"))
		source = source.replace("return [0, step.at.getTime()]", "return [2, step.at.getTime()]");
	if (process.env.RX112_MUTATION === "tie" && file.endsWith("schema/src/applications/next-step.ts"))
		source = source.replace("aId.localeCompare(bId)", "bId.localeCompare(aId)");
	const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
	const req = createRequire(file);
	new Function("require", "module", "exports", code)(
		(name) => {
			if (name === "@lingui/core/macro")
				return {
					t: (parts, ...values) =>
						typeof parts === "string" ? parts : parts.reduce((s, p, i) => s + p + (values[i] ?? ""), ""),
					plural: (value, forms) => forms.other.replace("#", String(value)),
				};
			if (name.startsWith(".")) {
				const target = path.resolve(path.dirname(file), name);
				return load(path.extname(target) ? target : target + ".ts");
			}
			if (name.startsWith("@reactive-resume/")) return load(req.resolve(name));
			return req(name);
		},
		module,
		module.exports,
	);
	cache.set(file, module.exports);
	return module.exports;
}
const fixture = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const now = new Date(fixture.now);
const web = load(root + "/apps/web/src/features/applications/next-step.ts");
const mobile = load(root + "/apps/mobile/src/features/applications/next-step.ts");
const nativeList = load(root + "/apps/mobile/src/features/applications/list.ts");
const keys = (owner) => fixture.rows.map((row) => ({ id: row.id, key: owner.nextStepSortKey(row, now) }));
const nativeOrder = nativeList
	.groupApplications(fixture.rows, "next", "asc", now, fixture.lanes)
	.flatMap((group) => group.data.map((row) => row.id));
const webOrder = fixture.rows
	.toSorted((a, b) =>
		web.compareNextStepSortKeys
			? web.compareNextStepSortKeys(web.nextStepSortKey(a, now), web.nextStepSortKey(b, now), a.id, b.id)
			: (() => {
					const x = web.nextStepSortKey(a, now);
					const y = web.nextStepSortKey(b, now);
					return x[0] - y[0] || x[1] - y[1] || a.id.localeCompare(b.id);
				})(),
	)
	.map((row) => row.id);
console.log(
	JSON.stringify(
		{ webKeys: keys(web), nativeKeys: keys(mobile), webOrder, nativeOrder, expected: fixture.expected },
		null,
		2,
	),
);
assert.deepEqual(nativeOrder, fixture.expected, "native list owner must match dated-stage/rank/tie contract");
if (!fixture.grouped)
	assert.deepEqual(webOrder, fixture.expected, "web owner must match dated-stage/rank/tie contract");
assert.deepEqual(keys(web), keys(mobile), "identical persisted history must produce identical keys");
