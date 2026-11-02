import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { formatter } from "@lingui/format-po";

async function files(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	return (
		await Promise.all(
			entries.map((entry) => {
				const path = resolve(directory, entry.name);
				return entry.isDirectory() ? files(path) : [path];
			}),
		)
	).flat();
}

const normalize = (text) => text.replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const slug = (text) =>
	text
		.toLowerCase()
		.replace(/<[^>]*>/g, "")
		.replace(/[^\p{L}\p{N}_\s-]/gu, "")
		.replace(/\s/g, "-");

/** Potential drift for human review; source text alone cannot prove UI behavior or screenshot accuracy. */
// shortcut: checks literal Markdown/MDX; use its AST if guides add generated headings or links.
export async function checkDocs(root) {
	const docs = resolve(root, "docs");
	const paths = await files(docs);
	const pages = new Map(
		await Promise.all(
			paths
				.filter((path) => path.endsWith(".mdx"))
				.map(async (path) => {
					const text = (await readFile(path, "utf8")).replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, (block) =>
						block.replace(/[^\n]/g, ""),
					);
					const anchors = new Set();
					const counts = new Map();
					for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
						const id = slug(match[1]);
						const count = counts.get(id) ?? 0;
						anchors.add(count ? `${id}-${count}` : id);
						counts.set(id, count + 1);
					}
					for (const match of text.matchAll(/\bid=["']([^"']+)["']/g)) anchors.add(match[1]);
					return [path, { text, anchors }];
				}),
		),
	);
	const filename = resolve(root, "apps/web/locales/en-US.po");
	const catalog = await formatter().parse(await readFile(filename, "utf8"), {
		locale: "en-US",
		sourceLocale: "en-US",
		filename,
	});
	const messages = new Set(
		Object.values(catalog)
			.filter((message) => !message.obsolete)
			.map((message) => normalize(message.message)),
	);
	const sourcePaths = (
		await Promise.all(["apps/web/src", "apps/mobile/src"].map((path) => files(resolve(root, path))))
	).flat();
	const source = normalize(
		(
			await Promise.all(
				sourcePaths
					.filter((path) => /\.[cm]?[jt]sx?$/.test(path) && !/\.(test|spec)\./.test(path))
					.map((path) => readFile(path, "utf8")),
			)
		).join("\n"),
	);
	const images = new Set(
		paths.filter(
			(path) => path.startsWith(resolve(docs, "images") + sep) && /\.(png|jpe?g|webp|svg|gif|avif)$/i.test(path),
		),
	);
	const usedImages = new Set();
	const findings = [];
	const warn = (path, text, index, message) =>
		findings.push({ file: relative(root, path), line: text.slice(0, index).split("\n").length, message });
	for (const [path, { text }] of pages) {
		const references = [
			...text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)|\b(?:src|href)=\s*\{?\s*["']([^"']+)["']/g),
		];
		for (const match of references) {
			const target = match[1] ?? match[2];
			if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) continue;
			const [addressWithQuery, anchor] = target.split("#");
			const address = addressWithQuery.split("?")[0];
			const destination = address
				? address.startsWith("/")
					? resolve(docs, "." + address)
					: resolve(dirname(path), address)
				: path;
			if (address?.startsWith("/images/")) {
				usedImages.add(destination);
				if (!images.has(destination)) warn(path, text, match.index, `Missing image: ${target}`);
				continue;
			}
			if (extname(address ?? "") && !/\.mdx?$/.test(address)) continue;
			const page =
				pages.get(destination) ?? pages.get(destination + ".mdx") ?? pages.get(resolve(destination, "index.mdx"));
			if (!page) warn(path, text, match.index, `Missing page: ${target}`);
			else if (anchor) {
				try {
					if (!page.anchors.has(decodeURIComponent(anchor)))
						warn(path, text, match.index, `Unknown heading: ${target}`);
				} catch {
					warn(path, text, match.index, `Invalid heading encoding: ${target}`);
				}
			}
		}
		if (!["guides", "getting-started"].includes(relative(docs, path).split(sep)[0])) continue;
		for (const match of text.matchAll(/\*\*([^*\n]+)\*\*/g)) {
			for (const part of match[1].split("→")) {
				const label = normalize(part).replace(/^["“]|["”.]$/g, "");
				if (label.length > 80 || !/^\p{Lu}/u.test(label) || messages.has(label) || source.includes(label)) continue;
				warn(path, text, match.index, `Review bold wording against the UI: ${label}`);
			}
		}
	}
	for (const path of [...paths.filter((path) => /\.(mdx?|json|[jt]sx?|css)$/.test(path)), resolve(root, "README.md")]) {
		const text = await readFile(path, "utf8");
		for (const match of text.matchAll(/(?:docs)?\/images\/[^\s"'`)>?#]+/g))
			usedImages.add(resolve(docs, "." + match[0].replace(/^docs/, "")));
	}
	for (const image of images)
		if (!usedImages.has(image))
			findings.push({
				file: relative(root, image),
				line: 1,
				message: "Image has no documentation reference; verify before removing it.",
			});
	return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const findings = await checkDocs(process.cwd());
	for (const { file, line, message } of findings) console.warn(`${file}:${line}: ${message}`);
	console.log(`Documentation review: ${findings.length} warnings. No files changed.`);
}
