import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { fontList, getFont, getPdfFallbackFontFamilies } from "@reactive-resume/fonts";
import { isValidFontFile } from "@reactive-resume/fonts/files";
import { fontMirrorPath } from "@reactive-resume/fonts/sources";
import { localeSchema } from "@reactive-resume/utils/locale";

type MirrorFile = { source: string; path: string };
type MirrorPlan = { families: string[]; files: MirrorFile[] };

/** Use the renderer's fallback selection, including punctuation, symbols and mixed-language text. */
export function planMirror(families: string[], locales: string[], all = false): MirrorPlan {
	const requested = all ? fontList.filter((font) => font.type === "web").map((font) => font.family) : families;
	if (!requested.length) throw new Error("Choose --all or at least one --family.");
	const selected = new Set<string>();
	for (const family of requested) {
		const font = getFont(family);
		if (!font) throw new Error(`Unknown font family: ${family}`);
		selected.add(font.family);
	}
	const fallbacks = new Set<string>();
	for (const family of selected)
		for (const locale of locales.length ? locales : ["en-US"])
			for (const fallback of getPdfFallbackFontFamilies(family, {
				locale: localeSchema.parse(locale),
				scripts: ["arrows", "symbols", "emoji"],
			}))
				fallbacks.add(fallback);
	for (const family of fallbacks) selected.add(family);
	const sources = new Set<string>();
	for (const family of selected) {
		const font = getFont(family);
		if (font?.type !== "web") continue;
		sources.add(font.preview);
		for (const source of Object.values(font.files)) sources.add(source);
	}
	return {
		families: [...selected].sort(),
		files: [...sources].sort().map((source) => ({ source, path: fontMirrorPath(source) })),
	};
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function downloadOnce(source: string, maxBytes: number): Promise<Uint8Array | null> {
	const response = await fetch(source, { signal: AbortSignal.timeout(120_000), redirect: "error" });
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`HTTP ${response.status}: ${source}`);
	const chunks: Uint8Array[] = [];
	let size = 0;
	if (!response.body) throw new Error(`Empty response: ${source}`);
	const reader = response.body.getReader();
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > maxBytes) throw new Error(`Response exceeds ${maxBytes} bytes: ${source}`);
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
	}
	return Buffer.concat(chunks);
}

async function download(source: string, maxBytes: number): Promise<Uint8Array | null> {
	for (let attempt = 0; ; attempt++) {
		try {
			return await downloadOnce(source, maxBytes);
		} catch (error) {
			if (attempt >= 2) throw new Error(`Could not fetch ${source}`, { cause: error });
			await delay(250 * 2 ** attempt);
		}
	}
}

async function atomicWrite(path: string, bytes: Uint8Array | string) {
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, bytes);
	await rename(temporary, path);
}

/** Copy original notices; never synthesize a license for a font whose notice couldn't be found. */
async function license(family: string, directory?: string): Promise<Uint8Array> {
	if (directory) {
		try {
			return await readFile(join(directory, `${family}.txt`));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	if (family.startsWith("Latin Modern ")) {
		const notices = await Promise.all(
			["LICENSE.md", "licenses/GUST-FONT-LICENSE.txt", "licenses/lppl.txt"].map((path) =>
				download(`https://cdn.jsdelivr.net/gh/sugina-dev/latin-modern-web@1.0.1/${path}`, 200_000),
			),
		);
		if (notices.some((notice) => !notice?.length)) throw new Error(`Missing original license notice for ${family}.`);
		return Buffer.concat(notices.flatMap((notice) => (notice ? [notice, Buffer.from("\n\n")] : [])));
	}
	const slug = family.toLowerCase().replace(/[^a-z0-9]/g, "");
	const candidates = family.startsWith("Computer Modern ")
		? ["https://cdn.jsdelivr.net/gh/bitmaks/cm-web-fonts@latest/LICENSE.txt"]
		: [
				`https://raw.githubusercontent.com/google/fonts/main/ofl/${slug}/OFL.txt`,
				`https://raw.githubusercontent.com/google/fonts/main/apache/${slug}/LICENSE.txt`,
				`https://raw.githubusercontent.com/google/fonts/main/ufl/${slug}/UFL.txt`,
			];
	for (const source of candidates) {
		const bytes = await download(source, 200_000);
		if (bytes?.length) return bytes;
	}
	throw new Error(
		`License not found for ${family}. Supply its original notice as --licenses '<directory>/${family}.txt' (pass the directory only).`,
	);
}

export async function prepareMirror(plan: MirrorPlan, output: string, licenses?: string) {
	// A completed manifest is the publication marker. Build into an unpublished directory, then switch the mirror.
	const files: (MirrorFile & { sha256: string; bytes: number })[] = [];
	for (const family of plan.families) {
		if (getFont(family)?.type !== "web") continue;
		await atomicWrite(join(output, "licenses", `${family}.txt`), await license(family, licenses));
	}
	let next = 0;
	const errors: unknown[] = [];
	await Promise.all(
		Array.from({ length: 4 }, async () => {
			for (;;) {
				if (errors.length) return;
				const entry = plan.files[next++];
				if (!entry) return;
				try {
					const bytes = await download(entry.source, 32 * 1024 * 1024);
					if (!bytes || bytes.length < 12) throw new Error(`Missing font: ${entry.source}`);
					if (!isValidFontFile(bytes)) throw new Error(`Invalid font data: ${entry.source}`);
					await atomicWrite(join(output, entry.path), bytes);
					files.push({ ...entry, sha256: sha256(bytes), bytes: bytes.length });
				} catch (error) {
					errors.push(new Error(`Could not download font ${entry.source}`, { cause: error }));
				}
			}
		}),
	);
	if (errors.length) throw new AggregateError(errors, `${errors.length} font downloads failed; mirror is incomplete.`);
	const manifest = { families: plan.families, files: files.sort((a, b) => a.path.localeCompare(b.path)) };
	await atomicWrite(join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	return manifest;
}

async function main() {
	const { values } = parseArgs({
		options: {
			all: { type: "boolean" },
			family: { type: "string", multiple: true },
			locale: { type: "string", multiple: true },
			out: { type: "string" },
			licenses: { type: "string" },
			plan: { type: "boolean" },
			help: { type: "boolean" },
		},
	});
	if (values.help) {
		console.log(
			"fonts:mirror --all | --family <name> [--family <name>] [--locale <locale>] --out <new directory> [--licenses <directory>] [--plan]",
		);
		return;
	}
	const plan = planMirror(values.family ?? [], values.locale ?? [], values.all);
	if (values.plan) {
		console.log(JSON.stringify(plan, null, 2));
		return;
	}
	if (!values.out) throw new Error("Pass --out <new directory>, or --plan to inspect the files first.");
	const root = fileURLToPath(new URL("../../", import.meta.url));
	const output = resolve(root, values.out);
	await mkdir(dirname(output), { recursive: true });
	await mkdir(output, { recursive: false });
	console.log(`Preparing ${plan.files.length} font files and ${plan.families.length} family notices...`);
	const manifest = await prepareMirror(plan, output, values.licenses ? resolve(root, values.licenses) : undefined);
	console.log(`Prepared ${manifest.files.length} font files and original licenses in ${output}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
	main().catch((error: unknown) => {
		console.error(error);
		process.exitCode = 1;
	});
