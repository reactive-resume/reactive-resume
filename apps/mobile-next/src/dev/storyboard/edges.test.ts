import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { storyboardRoutes } from "./routes";

const root = path.resolve(__dirname, "../../..");
const bundle = "/Users/amruth/Projects/reactive-resume/.agents/handoff/mobile-final/design/layout";
const walk = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const file = path.join(dir, entry.name);
		return entry.isDirectory() ? walk(file) : [file];
	});
const routeFiles = walk(path.join(root, "app")).filter((f) => f.endsWith(".tsx") && !path.basename(f).startsWith("_"));
const pathname = (file: string) =>
	"/" +
	path
		.relative(path.join(root, "app"), file)
		.replace(/\.tsx$/, "")
		.split("/")
		.filter((s) => !s.startsWith("("))
		.join("/")
		.replace(/(^|\/)index$/, "");
const resolve = (base: string) =>
	[base + ".tsx", base + ".ts", path.join(base, "index.tsx"), path.join(base, "index.ts")].find(existsSync);

// Search only the source route and its local imports, never unrelated feature files.
function sources(file: string, visited = new Set<string>()): string[] {
	if (visited.has(file)) return [];
	visited.add(file);
	const source = readFileSync(file, "utf8");
	const result = [source];
	for (const match of source.matchAll(/(?:import|export)\s+(?!type\b)[^;]*?from\s*["']([^"']+)["']/g)) {
		const name = match[1];
		if (!name) continue;
		const imported = name.startsWith("@/")
			? resolve(path.join(root, "src", name.slice(2)))
			: name.startsWith(".")
				? resolve(path.resolve(path.dirname(file), name))
				: undefined;
		if (imported) result.push(...sources(imported, visited));
	}
	return result;
}

function destinations(source: string): string[] {
	// Literal/template pathnames only. Computed hrefs, router.back and navigator-owned docks need device proof.
	const searchable = source.replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "");
	const literals =
		/router\.(?:push|replace)\(\s*(?:\{\s*pathname:\s*)?(["'`])([^"'`]+)\1|<Link\b[^>]*?href=\{?(["'`])([^"'`]+)\3/g;
	return [...searchable.matchAll(literals)].map(
		(m) => (m[2] ?? m[4] ?? "").replace(/\$\{[^}]+\}/g, "[dynamic]").split("?")[0] ?? "",
	);
}
const matches = (pattern: string, href: string) => {
	const expected = pattern.split("/");
	const actual = href.split("/");
	return (
		expected.length === actual.length && expected.every((s, i) => (s.startsWith("[") ? !!actual[i] : s === actual[i]))
	);
};

const contract = existsSync(bundle) ? test : test.skip;
contract(
	"every layout navigation edge has a route and navigation in its source imports (bundle absent: test skipped)",
	() => {
		const failures: string[] = [];
		const proved: string[] = [];
		for (const file of readdirSync(bundle)
			.filter((f) => f.endsWith(".json"))
			.sort()) {
			const layout = JSON.parse(readFileSync(path.join(bundle, file), "utf8")) as {
				id: string;
				elements: { n: number; navigatesTo?: string }[];
			};
			const sourceRoute = storyboardRoutes[layout.id];
			const sourceFile = routeFiles.find((f) => pathname(f) === sourceRoute);
			const hrefs = sourceFile ? sources(sourceFile).flatMap(destinations) : [];
			for (const edge of (layout.elements ?? []).filter((e) => e.navigatesTo)) {
				const target = edge.navigatesTo ? storyboardRoutes[edge.navigatesTo] : undefined;
				const label = `${layout.id} #${edge.n} → ${edge.navigatesTo}`;
				if (!target) failures.push(`${label}: missing route mapping`);
				else if (!routeFiles.some((f) => pathname(f) === target))
					failures.push(`${label}: route file absent (${target})`);
				else if (!hrefs.some((href) => matches(target, href)))
					failures.push(
						`${label}: cannot prove router.push/replace/Link to ${target} (back, dock, dynamic href or missing navigation)`,
					);
				else proved.push(label);
			}
		}
		console.info(`Storyboard edges: ${proved.length} statically proved, ${failures.length} unproved.`);
		console.info(`Proved storyboard navigation edges:\n${proved.map((label) => `- ${label}`).join("\n")}`);
		if (failures.length)
			throw new Error(`Unproved storyboard navigation edges:\n${failures.map((f) => `- ${f}`).join("\n")}`);
	},
);
