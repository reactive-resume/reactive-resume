// Compares every web and mobile catalog with its version at a base ref and reports translation regressions.
// Usage: pnpm locales:diff [--base <ref>] (default origin/main). Exits 1 on lost translations or on placeholder/tag
// mismatches in new or changed translations; changed, new untranslated and removed entries are informational.
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { formatter } from "@lingui/format-po";

const EXAMPLES = 3;
const TAG = /<\/?\d+\s*\/?>/y;

/**
 * ICU arguments and numbered tags of a message, mapped to the innermost plural form they occur in (`<argument>:<key>`,
 * "" = outside any plural), plus each plural argument's forms. Honors ICU apostrophe quoting, so `'{name}'` is literal.
 */
function signature(text) {
	const tokens = new Map();
	const plurals = new Map();
	const selects = new Set();
	let i = 0;
	const add = (token, branch) => tokens.set(token, (tokens.get(token) ?? new Set()).add(branch));
	const skipSpace = () => {
		while (/\s/.test(text[i] ?? "")) i++;
	};
	const readUntil = (stops) => {
		const start = i;
		while (i < text.length && !stops.includes(text[i])) i++;
		return text.slice(start, i).trim();
	};
	const message = (branch, plural) => {
		while (i < text.length && text[i] !== "}") {
			const char = text[i];
			const next = text[i + 1];
			if (char === "{") argument(branch);
			else if (char === "<" && ((TAG.lastIndex = i), TAG.test(text))) {
				add(text.slice(i, TAG.lastIndex).replace(/\s/g, ""), branch);
				i = TAG.lastIndex;
			} else if (char === "'" && next === "'") i += 2;
			else if (char === "'" && (next === "{" || next === "}" || (plural && next === "#"))) {
				for (i += 2; i < text.length; i++) {
					if (text[i] !== "'") continue;
					if (text[i + 1] !== "'") break;
					i++;
				}
				i++;
			} else if (plural && char === "#") {
				// The plural count, so a form that drops it is caught (see `lacks`).
				add("#", branch);
				i++;
			} else i++;
		}
	};
	const argument = (branch) => {
		i++;
		const name = readUntil(",}");
		if (text[i] !== ",") {
			i++;
			add(`{${name}}`, branch);
			return;
		}
		i++;
		const type = readUntil(",}");
		add(`{${name}, ${type}}`, branch);
		if (type !== "plural" && type !== "selectordinal" && type !== "select") {
			for (let depth = 1; i < text.length && depth > 0; i++) {
				if (text[i] === "{") depth++;
				else if (text[i] === "}") depth--;
			}
			return;
		}
		i++;
		for (;;) {
			skipSpace();
			if (i >= text.length || text[i] === "}") break;
			const key = readUntil(" \t\n{}");
			skipSpace();
			if (text[i] !== "{") continue; // offset:n
			plurals.set(name, (plurals.get(name) ?? new Set()).add(key));
			if (type === "select") selects.add(name);
			i++;
			message(`${name}:${key}`, type !== "select");
			i++;
		}
		i++;
	};
	while (i < text.length) {
		message("", false);
		i++;
	}
	return { tokens, plurals, selects };
}

/** Whether the translation lacks `token` in `branch`, the plural form (or "" = every form) where the source uses it. */
function lacks(translation, token, branch) {
	const found = translation.tokens.get(token) ?? new Set();
	if (found.has("")) return false;
	// Outside any plural in the source: a translation may move it into a plural, but then into every form of it.
	if (branch === "")
		return ![...translation.plurals].some(([plural, keys]) => [...keys].every((key) => found.has(`${plural}:${key}`)));
	const separator = branch.lastIndexOf(":");
	const plural = branch.slice(0, separator);
	const key = branch.slice(separator + 1);
	// Only `other` must show the count; `zero`/`one`/`two` forms often spell it out ("one request").
	if (token === "#" && key !== "other") return false;
	const keys = translation.plurals.get(plural);
	// A renamed plural is reported on its own; don't also report every argument inside it.
	if (!keys) return found.size === 0;
	// Plural forms the language doesn't have are legitimately omitted, but ICU requires `other`. A select option is
	// the same in every language, so a missing one drops the token.
	if (!keys.has(key)) return key === "other" || translation.selects.has(plural);
	if (found.has(branch)) return false;
	// Languages whose `one` also covers 21, 31… move the singular text to an exact `=1` form.
	return !(key === "one" && found.has(`${plural}:=1`));
}

/** Arguments or tags the translation drops (outside plural forms it legitimately omits) or invents. */
export function mismatch(source, translation) {
	const expected = signature(source);
	const actual = signature(translation);
	const missing = [...expected.tokens]
		.filter(([token, branches]) => [...branches].some((branch) => lacks(actual, token, branch)))
		.map(([token]) => token);
	// A translation may show the count where the source spells it out, so an added `#` is never an error.
	const extra = [...actual.tokens.keys()].filter((token) => token !== "#" && !expected.tokens.has(token));
	// Without `other`, formatting any count outside the listed forms throws.
	const noOther = [...actual.plurals]
		.filter(([plural, keys]) => expected.plurals.has(plural) && !keys.has("other"))
		.map(([plural]) => plural);
	return [
		...missing.map((token) => `missing ${token}`),
		...extra.map((token) => `extra ${token}`),
		...noOther.map((name) => `missing other form in {${name}, ${actual.selects.has(name) ? "select" : "plural"}}`),
	].join(", ");
}

const clip = (text) => JSON.stringify(text.length > 70 ? `${text.slice(0, 69)}…` : text);

async function parse(source, path, locale) {
	if (source === undefined) return {};
	const catalog = await formatter().parse(source, { locale, sourceLocale: "en-US", filename: path });
	return Object.fromEntries(Object.entries(catalog).filter(([, entry]) => !entry.obsolete));
}

/** `head` is undefined when the catalog was deleted: every translation it had counts as lost. */
export function compare(base, head) {
	const result = { lost: [], placeholder: [], changed: [], untranslated: 0, removed: 0 };
	if (head === undefined) {
		for (const entry of Object.values(base))
			if (entry.translation)
				result.lost.push(`${clip(entry.message)} was ${clip(entry.translation)} (catalog deleted)`);
		result.removed = Object.keys(base).length;
		return result;
	}
	for (const [id, entry] of Object.entries(head)) {
		const before = base[id]?.translation ?? "";
		const after = entry.translation ?? "";
		if (before && !after) result.lost.push(`${clip(entry.message)} was ${clip(before)}`);
		if (!after) {
			if (!base[id]) result.untranslated++;
			continue;
		}
		if (base[id] && before === after) continue;
		if (before) result.changed.push(`${clip(entry.message)}: ${clip(before)} → ${clip(after)}`);
		const problem = mismatch(entry.message ?? id, after);
		if (problem) result.placeholder.push(`${clip(entry.message)} → ${clip(after)} (${problem})`);
	}
	result.removed = Object.keys(base).filter((id) => !head[id]).length;
	return result;
}

async function main() {
	const { values } = parseArgs({ options: { base: { type: "string", default: "origin/main" } } });
	const root = fileURLToPath(new URL("../../", import.meta.url));
	const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
	let base;
	try {
		// Like `git diff base...`: a branch behind its base must not report the base's newer translations as lost.
		base = git("merge-base", values.base, "HEAD").trim();
	} catch {
		console.error(`No merge base with ${values.base}. Fetch it (full history) or pass --base <ref>.`);
		process.exit(2);
	}

	const totals = { catalogs: 0, lost: 0, placeholder: 0, changed: 0, untranslated: 0, removed: 0 };
	for (const directory of ["apps/web/locales", "apps/mobile/locales"]) {
		// Catalogs in the checkout or at the base, so a deleted catalog is compared too.
		// The pathspec form lists nothing (instead of failing) when the folder didn't exist at the base.
		const atBase = git("ls-tree", "--name-only", base, "--", `${directory}/`)
			.split("\n")
			.map((path) => path.slice(directory.length + 1));
		const present = await readdir(join(root, directory)).catch(() => []);
		const files = [...new Set([...present, ...atBase])].filter((name) => name.endsWith(".po")).sort();
		for (const file of files) {
			const path = `${directory}/${file}`;
			const locale = file.slice(0, -3);
			let baseSource;
			try {
				baseSource = git("show", `${base}:${path}`);
			} catch {
				// New catalog: every entry counts as new.
			}
			const headSource = present.includes(file) ? await readFile(join(root, path), "utf8") : undefined;
			const result = compare(
				await parse(baseSource, path, locale),
				headSource === undefined ? undefined : await parse(headSource, path, locale),
			);
			totals.catalogs++;
			for (const key of ["untranslated", "removed"]) totals[key] += result[key];
			for (const key of ["lost", "placeholder", "changed"]) totals[key] += result[key].length;
			if (!result.lost.length && !result.placeholder.length && !result.changed.length) continue;

			console.log(
				`${path}: ${result.lost.length} lost, ${result.placeholder.length} placeholder mismatches, ${result.changed.length} changed, ${result.untranslated} new untranslated, ${result.removed} removed`,
			);
			for (const key of ["lost", "placeholder", "changed"]) {
				for (const example of result[key].slice(0, EXAMPLES)) console.log(`  ${key}: ${example}`);
				if (result[key].length > EXAMPLES) console.log(`  ${key}: …${result[key].length - EXAMPLES} more`);
			}
		}
	}

	const errors = totals.lost + totals.placeholder;
	console.log(
		`${totals.catalogs} catalogs vs ${values.base} (merge base ${base.slice(0, 9)}): ${totals.lost} lost translations, ${totals.placeholder} placeholder mismatches (errors); ${totals.changed} changed, ${totals.untranslated} new untranslated, ${totals.removed} removed (info).`,
	);
	if (errors) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
