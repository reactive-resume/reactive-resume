import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { measureTransformedText } from "./export-scaled-layout.mjs";

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
