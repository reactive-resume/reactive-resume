import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vite-plus/test";
import * as forme from "@formepdf/core";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { createFontPreparer, createFontSubsetter } from "./font-subset";
import { lostCharacters, renderResume } from "./render";

const wasm = readFileSync(createRequire(import.meta.url).resolve("harfbuzzjs/dist/harfbuzz-subset.wasm"));

describe("fonts cut to the document's characters (#3593)", () => {
	it("keeps a CJK resume's fonts under 2 MB and still draws every character", { timeout: 120_000 }, async () => {
		const data = structuredClone(defaultResumeData);
		data.picture.hidden = true;
		data.basics.name = "孙浩男";
		data.metadata.page.locale = "zh-CN";
		data.metadata.typography.body.fontFamily = "Noto Sans SC";
		data.metadata.typography.heading.fontFamily = "Noto Sans SC";
		data.metadata.typography.body.fontWeights = ["400", "700"];
		data.metadata.typography.heading.fontWeights = ["400", "700"];
		data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
		data.summary.hidden = false;
		data.summary.title = "个人简介";
		data.summary.content =
			"<p>负责后端研发，<strong>熟悉缓存架构</strong>与<em>消息队列</em>。</p><ul><li>高并发库存扣减</li></ul>";

		let fontBytes = 0;
		const engine = {
			renderSerializedDocWithLayout: (document: Record<string, unknown>) => {
				fontBytes = (document.fonts as { src: string }[]).reduce((total, font) => total + font.src.length, 0);
				return forme.renderSerializedDocWithLayout(document);
			},
			prepareFont: createFontPreparer(await createFontSubsetter(wasm)),
		};
		const result = await renderResume(engine, { data });

		// Bold and italic CJK, list markers and the name all keep their glyphs.
		expect(result.missingFonts).toEqual([]);
		expect(lostCharacters(result.warnings)).toBeNull();
		// Each whole Noto Sans SC face is over 10 MB.
		expect(fontBytes).toBeLessThan(2_000_000);
	});

	it("keeps the capitals an uppercase heading draws", { timeout: 120_000 }, async () => {
		const data = structuredClone(defaultResumeData);
		data.picture.hidden = true;
		data.basics.name = "jane doe";
		data.metadata.template = "meowth";
		data.metadata.typography.body.fontFamily = "Noto Sans";
		data.metadata.typography.heading.fontFamily = "Noto Sans";
		data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
		data.summary.hidden = false;
		// Lower case only: "Ó", "П", "Ы" and "Т" are in no string of the document.
		data.summary.title = "formación опыт";
		data.summary.content = "<p>plain text</p>";

		const engine = {
			renderSerializedDocWithLayout: forme.renderSerializedDocWithLayout,
			prepareFont: createFontPreparer(await createFontSubsetter(wasm)),
		};
		const result = await renderResume(engine, { data });

		expect(result.missingFonts).toEqual([]);
		expect(lostCharacters(result.warnings)).toBeNull();
	});
});
