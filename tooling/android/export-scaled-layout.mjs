import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

/** Browser-side measurement: computed CSS metrics must follow the same transform as the rendered box. */
export function measureTransformedText({ element, frame, lines, original }) {
	let sx = 1;
	let sy = 1;
	let paper = false;
	for (let node = element; node && node !== frame; node = node.parentElement) {
		paper ||= node.matches(".paper, .pg, .mini");
		const transform = getComputedStyle(node).transform;
		if (transform !== "none") {
			const matrix = new DOMMatrixReadOnly(transform);
			sx *= Math.hypot(matrix.a, matrix.b);
			sy *= Math.hypot(matrix.c, matrix.d);
		}
	}
	if (!paper || Math.abs(sy - 1) < 0.00001) return null;
	if (Math.abs(sx - sy) > 0.0001) throw new Error("Paper uses a nonuniform transform");
	const style = getComputedStyle(element);
	const rect = element.getBoundingClientRect();
	const origin = frame.getBoundingClientRect();
	const px = (name) => Number.parseFloat(style[name]) || 0;
	const left = (px("paddingLeft") + px("borderLeftWidth")) * sx;
	const right = (px("paddingRight") + px("borderRightWidth")) * sx;
	const top = (px("paddingTop") + px("borderTopWidth")) * sy;
	const bottom = (px("paddingBottom") + px("borderBottomWidth")) * sy;
	// Existing boxes/range widths came from the original board renderer. Its web fonts are not in the bundle;
	// retain those direct measurements and correct only the derived transform-dependent fields.
	const box = original?.box ?? { x: rect.x - origin.x, y: rect.y - origin.y, w: rect.width, h: rect.height };
	const slot = { x: box.x + left, y: box.y + top, w: box.w - left - right, h: box.h - top - bottom };
	const range = document.createRange();
	range.selectNodeContents(element);
	const glyphs = range.getBoundingClientRect();
	const lineHeight = px("lineHeight") * sy;
	if (!(lineHeight > 0)) throw new Error("Paper text needs an explicit line height");
	const height = lineHeight * lines;
	return {
		scale: sx,
		slot,
		textBox: {
			x: original?.textBox.x ?? glyphs.x - origin.x,
			y: slot.y + (slot.h - height) / 2,
			w: original?.textBox.w ?? glyphs.width,
			h: height,
		},
		font: { size: px("fontSize") * sy, lineHeight, letterSpacing: px("letterSpacing") * sx },
	};
}

/** Direct text separated by a block child cannot share one contiguous line box. */
export function measureDirectTextRanges({ element, frame }) {
	const children = [...element.childNodes];
	const nodes = children.filter((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
	if (nodes.length < 2) return null;
	const between = children.slice(children.indexOf(nodes[0]) + 1, children.indexOf(nodes.at(-1)));
	if (
		!between.some((node) => node.nodeType === Node.ELEMENT_NODE && !getComputedStyle(node).display.startsWith("inline"))
	)
		return null;
	const origin = frame.getBoundingClientRect();
	const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
	if (!(lineHeight > 0)) throw new Error("Direct text needs an explicit line height");
	return nodes.map((node) => {
		const range = document.createRange();
		range.setStart(node, node.textContent.search(/\S/));
		range.setEnd(node, node.textContent.trimEnd().length);
		const rects = [...range.getClientRects()].filter((rect) => rect.width && rect.height);
		if (!rects.length) throw new Error("Direct text range has no rendered lines");
		const glyphs = range.getBoundingClientRect();
		const first = rects[0];
		const last = rects.at(-1);
		return {
			text: node.textContent.replaceAll("\u00a0", " ").replace(/\s+/g, " ").trim(),
			lines: rects.length,
			textBox: {
				x: glyphs.x - origin.x,
				y: first.y - origin.y - (lineHeight - first.height) / 2,
				w: glyphs.width,
				h: last.y - first.y + lineHeight,
			},
		};
	});
}

const normalize = (text) => text.replaceAll("\u00a0", " ").replace(/\s+/g, " ").trim();
const hash = (data) => createHash("sha256").update(data).digest("hex");
const roundBox = (box) =>
	Object.fromEntries(Object.entries(box).map(([key, value]) => [key, Math.round(value * 2) / 2]));

/** Explicit HTML line breaks are visible text separators, even though textContent omits them. */
export function textWithExplicitBreaks(element) {
	if (![...element.childNodes].some((node) => node.nodeName === "BR")) return null;
	return [...element.childNodes].map((node) => (node.nodeName === "BR" ? "\n" : node.textContent)).join("");
}

export async function standaloneHtml(bundle, id) {
	let html = await readFile(join(bundle, "design/source", `${id}.dc.html`), "utf8");
	const css = (await readFile(join(bundle, "design/source/rr-mobile.css"), "utf8")).replace(
		/@font-face\s*\{[^}]*font-family:\s*"(?:Figtree Variable|Instrument Serif|Geist Mono Variable)";[^}]*\}/g,
		"",
	);
	html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<link\b[^>]*>/g, "");
	html = html.replace(/<sc-for\b[^>]*>([\s\S]*?)<\/sc-for>/g, (_, body) =>
		[
			{ id: "light", label: "Light", icon: "sun" },
			{ id: "dark", label: "Dark", icon: "moon" },
		]
			.map((theme) => body.replace(/\{\{th\.(id|label|icon)\}\}/g, (_, key) => theme[key]))
			.join(""),
	);
	// The bundle omits its browser runtime/fonts. Use the exact static font assets supplied for the app.
	const fontDir = resolve(
		fileURLToPath(new URL("../../apps/android/core/designsystem/src/main/res/font/", import.meta.url)),
	);
	const fonts = [
		["Figtree Variable", "figtree_regular", 400],
		["Figtree Variable", "figtree_medium", 500],
		["Figtree Variable", "figtree_semibold", 600],
		["Figtree Variable", "figtree_bold", 700],
		["Instrument Serif", "instrument_serif_regular", 400],
		["Geist Mono Variable", "geist_mono_regular", 400],
	];
	let faces = "";
	for (const [family, name, weight] of fonts) {
		const bytes = await readFile(join(fontDir, `${name}.ttf`));
		faces += `@font-face{font-family:"${family}";src:url(data:font/ttf;base64,${bytes.toString("base64")});font-weight:${weight};font-style:normal}`;
	}
	return html.replace("</head>", `<style>${css}\n${faces}</style></head>`);
}

export async function exportScaledLayouts(bundle, output) {
	await mkdir(output, { recursive: true });
	const manifest = JSON.parse(await readFile(join(bundle, "screens/manifest.json"), "utf8"));
	const browser = await chromium.launch({ headless: true });
	const changes = [];
	try {
		const page = await browser.newPage({ viewport: { width: 2240, height: 1800 }, deviceScaleFactor: 2 });
		for (const screen of manifest.filter((entry) => entry.light)) {
			const source = await readFile(join(bundle, "design/layout", `${screen.id}.json`), "utf8");
			const layout = JSON.parse(source);
			await page.setContent(await standaloneHtml(bundle, screen.id));
			await page.evaluate(() => document.fonts.ready);
			const frame = await page.$('.scr[data-theme="light"]');
			if (!frame) {
				if (layout.elements.some((element) => element.component === "Page"))
					throw new Error(`Missing light frame: ${screen.id}`);
				continue;
			}
			const candidates = await frame.$$("*");
			const metadata = await frame.evaluate((root) => {
				const origin = root.getBoundingClientRect();
				return [...root.querySelectorAll("*")].map((node) => {
					const rect = node.getBoundingClientRect();
					return {
						tag: node.tagName.toLowerCase(),
						text: node.innerText ?? node.textContent,
						directText: [...node.childNodes]
							.filter((child) => child.nodeType === Node.TEXT_NODE)
							.map((child) => child.textContent)
							.join(""),
						inPaper: !!node.closest(".paper, .pg, .mini"),
						x: rect.x - origin.x,
						y: rect.y - origin.y,
					};
				});
			});
			const used = new Set();
			const fields = [];
			const replacements = [];
			let nextNumber = Math.max(...layout.elements.map((element) => element.n)) + 1;
			for (const element of layout.elements.filter((entry) => entry.text && entry.font)) {
				const directIndex = metadata.findIndex(
					(candidate) => candidate.tag === element.tag && normalize(candidate.directText) === normalize(element.text),
				);
				if (directIndex >= 0) {
					const brokenText = await candidates[directIndex].evaluate(textWithExplicitBreaks);
					if (brokenText != null && brokenText !== element.text) {
						const after = { ...element, text: brokenText };
						replacements.push({ n: element.n, before: element, after: [after] });
						layout.elements.splice(layout.elements.indexOf(element), 1, after);
						continue;
					}
					const ranges = await page.evaluate(measureDirectTextRanges, { element: candidates[directIndex], frame });
					if (ranges) {
						const after = ranges.map((range, index) => ({
							...element,
							...range,
							n: index ? nextNumber++ : element.n,
							textBox: roundBox(range.textBox),
						}));
						replacements.push({ n: element.n, before: element, after });
						layout.elements.splice(layout.elements.indexOf(element), 1, ...after);
						continue;
					}
				}
				const matches = [];
				for (let index = 0; index < candidates.length; index++) {
					if (used.has(index)) continue;
					const candidate = metadata[index];
					if (!candidate.inPaper) continue;
					if (candidate.tag !== element.tag || normalize(candidate.text) !== normalize(element.text)) continue;
					const distance = Math.abs(candidate.x - element.box.x) + Math.abs(candidate.y - element.box.y);
					matches.push({ index, distance });
				}
				matches.sort((a, b) => a.distance - b.distance);
				if (!matches.length) continue;
				const match = matches[0];
				const measured = await page.evaluate(measureTransformedText, {
					element: candidates[match.index],
					frame,
					lines: element.lines || 1,
					original: element,
				});
				used.add(match.index);
				if (!measured) continue;
				const before = { slot: element.slot, textBox: element.textBox, font: element.font };
				element.slot = roundBox(measured.slot);
				element.textBox = roundBox(measured.textBox);
				element.font = { ...element.font, ...measured.font };
				const after = { slot: element.slot, textBox: element.textBox, font: element.font };
				if (JSON.stringify(before) !== JSON.stringify(after))
					fields.push({ n: element.n, text: element.text, scale: measured.scale, before, after });
			}
			if (fields.length || replacements.length) {
				const generated = `${JSON.stringify(layout, null, 1)}\n`;
				await writeFile(join(output, `${screen.id}.json`), generated);
				changes.push({
					id: screen.id,
					originalSha256: hash(source),
					generatedSha256: hash(generated),
					fields,
					...(replacements.length ? { replacements } : {}),
				});
			}
		}
	} finally {
		await browser.close();
	}
	await writeFile(join(output, "CHANGES.json"), `${JSON.stringify(changes, null, 2)}\n`);
	return changes;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [, , bundle, output] = process.argv;
	if (!bundle || !output)
		throw new Error("Usage: node tooling/android/export-scaled-layout.mjs <bundle> <output-directory>");
	const changes = await exportScaledLayouts(resolve(bundle), resolve(output));
	console.log(
		`${changes.length} affected screens; original inputs untouched; candidates and CHANGES.json in ${output}`,
	);
}
