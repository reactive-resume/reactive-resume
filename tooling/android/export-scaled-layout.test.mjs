import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import {
	exportScaledLayouts,
	measureDirectTextRanges,
	measureTransformedText,
	standaloneHtml,
	textWithExplicitBreaks,
} from "./export-scaled-layout.mjs";

test("standalone source loads supplied fonts instead of omitted variable faces", async () => {
	const bundle = await mkdtemp(join(tmpdir(), "android-font-proof-"));
	const browser = await chromium.launch({ headless: true });
	try {
		await mkdir(join(bundle, "design/source"), { recursive: true });
		await writeFile(
			join(bundle, "design/source/Proof.dc.html"),
			"<html><head></head><body><span>Two of your open roles meet your must-haves:</span></body></html>",
		);
		await writeFile(
			join(bundle, "design/source/rr-mobile.css"),
			'@font-face{font-family:"Figtree Variable";src:url(omitted.woff2);font-weight:300 900}span{font:400 15px/24px "Figtree Variable"}',
		);
		const page = await browser.newPage();
		await page.setContent(await standaloneHtml(bundle, "Proof"));
		await page.evaluate(() => document.fonts.ready);
		const bytes = await readFile(
			new URL("../../apps/android/core/designsystem/src/main/res/font/figtree_regular.ttf", import.meta.url),
		);
		const proof = await page.evaluate(
			async (source) => {
				const text = document.querySelector("span").textContent;
				const [face] = await document.fonts.load('400 15px "Figtree Variable"', text);
				const canvas = document.createElement("canvas").getContext("2d");
				canvas.font = '400 15px "Figtree Variable"';
				const actual = canvas.measureText(text).width;
				const independent = new FontFace("IndependentProof", source);
				await independent.load();
				document.fonts.add(independent);
				canvas.font = "400 15px IndependentProof";
				return { status: face.status, actual, expected: canvas.measureText(text).width };
			},
			`url(data:font/ttf;base64,${bytes.toString("base64")})`,
		);
		assert.equal(proof.status, "loaded");
		assert.equal(proof.actual, proof.expected);
	} finally {
		await browser.close();
		await rm(bundle, { recursive: true, force: true });
	}
});

test("scaled paper text uses transformed line boxes and transformed padding", async () => {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.setContent(
			'<div id="frame"><div class="paper" style="transform:scale(.5);transform-origin:top left"><div id="text" style="font:20px/30px sans-serif;padding:12px;border:2px solid">First<br>Second</div></div></div>',
		);
		const measured = await page.evaluate(measureTransformedText, {
			element: await page.$("#text"),
			frame: await page.$("#frame"),
			lines: 2,
		});
		assert.equal(measured.font.size, 10);
		assert.equal(measured.font.lineHeight, 15);
		assert.equal(measured.textBox.h, 30);
		assert.equal(measured.slot.y, 7);
		assert.equal(measured.textBox.y, 7);
		const original = {
			box: { x: 42, y: 80, w: 150, h: 44 },
			textBox: { x: 49, y: 70, w: 32, h: 60 },
			font: { size: 20, lineHeight: 30, letterSpacing: 0 },
		};
		const repaired = await page.evaluate(measureTransformedText, {
			element: await page.$("#text"),
			frame: await page.$("#frame"),
			lines: 2,
			original,
		});
		assert.equal(repaired.textBox.x, 49);
		assert.equal(repaired.textBox.w, 32);
		assert.equal(repaired.textBox.y, 87);
		assert.equal(repaired.textBox.h, 30);
		const repeated = await page.evaluate(measureTransformedText, {
			element: await page.$("#text"),
			frame: await page.$("#frame"),
			lines: 2,
			original: { ...original, ...repaired },
		});
		assert.deepEqual(repeated, repaired);
	} finally {
		await browser.close();
	}
});

test("explicit br exports visible text separators without changing measured geometry", async () => {
	const browser = await chromium.launch({ headless: true });
	try {
		const page = await browser.newPage();
		await page.setContent(
			'<p id="signature" style="font:16px/26px sans-serif">Best,<br>Alex</p><p id="ordinary">Plain text</p>',
		);
		assert.equal(await page.$eval("#signature", textWithExplicitBreaks), "Best,\nAlex");
		assert.equal(await page.$eval("#ordinary", textWithExplicitBreaks), null);
	} finally {
		await browser.close();
	}
});

test("direct text before and after a nested list exports separate real ranges once", async () => {
	const bundle = await mkdtemp(join(tmpdir(), "android-direct-text-"));
	const browser = await chromium.launch({ headless: true });
	try {
		const html =
			'<html><head></head><body><div class="scr" data-theme="light"><div class="reply">Before list<ol><li>Nested list item</li></ol>After list with enough words to wrap onto another line in this narrow frame.</div></div></body></html>';
		const css = ".scr{width:200px}.reply{font:15px/24px sans-serif}ol{margin:8px 0;padding-left:20px}";
		const page = await browser.newPage();
		await page.setContent(html.replace("</head>", `<style>${css}</style></head>`));
		const ranges = await page.evaluate(measureDirectTextRanges, {
			element: await page.$(".reply"),
			frame: await page.$(".scr"),
		});
		assert.equal(ranges.length, 2);
		assert.equal(ranges[0].text, "Before list");
		assert.equal(ranges[0].textBox.h, 24);
		assert.ok(ranges[1].lines > 1);
		assert.equal(ranges[1].textBox.h, ranges[1].lines * 24);
		assert.ok(ranges[1].textBox.y > ranges[0].textBox.y + ranges[0].textBox.h);
		const box = { x: 0, y: 0, w: 200, h: 200 };
		const nested = {
			n: 3,
			depth: 3,
			tag: "li",
			text: "Nested list item",
			box,
			textBox: box,
			font: { size: 15, lineHeight: 24 },
			lines: 1,
		};
		const original = {
			id: "Test",
			elements: [
				{
					n: 1,
					depth: 1,
					tag: "div",
					class: "reply",
					text: ranges.map((range) => range.text).join(""),
					box,
					slot: box,
					textBox: { ...box, h: ranges.reduce((height, range) => height + range.textBox.h, 0) },
					font: { size: 15, lineHeight: 24 },
					lines: ranges.reduce((lines, range) => lines + range.lines, 0),
				},
				nested,
			],
		};
		for (const dir of ["screens", "design/source", "design/layout"])
			await mkdir(join(bundle, dir), { recursive: true });
		await writeFile(join(bundle, "screens/manifest.json"), JSON.stringify([{ id: "Test", light: "Test-light.png" }]));
		await writeFile(join(bundle, "design/source/Test.dc.html"), html);
		await writeFile(join(bundle, "design/source/rr-mobile.css"), css);
		await writeFile(join(bundle, "design/layout/Test.json"), JSON.stringify(original));
		const changes = await exportScaledLayouts(bundle, join(bundle, "output"));
		assert.equal(changes.length, 1);
		assert.equal(changes[0].fields.length, 0);
		assert.equal(changes[0].replacements.length, 1);
		const generated = await readFile(join(bundle, "output/Test.json"), "utf8");
		const layout = JSON.parse(generated);
		assert.equal(layout.elements.length, 3);
		assert.deepEqual(layout.elements.at(-1), nested);
		assert.deepEqual(
			layout.elements.slice(0, 2).map((element) => element.text),
			ranges.map((range) => range.text),
		);
		assert.equal(layout.elements.filter((element) => element.text === nested.text).length, 1);
		await writeFile(join(bundle, "design/layout/Test.json"), generated);
		assert.deepEqual(await exportScaledLayouts(bundle, join(bundle, "repeat")), []);
		assert.equal(await readFile(join(bundle, "design/layout/Test.json"), "utf8"), generated);
	} finally {
		await browser.close();
		await rm(bundle, { recursive: true, force: true });
	}
});
