import { expect, it, vi } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { createResumePdfFile } from "./server";

// The real engine, recording the font bytes each layout pass is handed.
const passes = vi.hoisted(() => ({ fontBytes: [] as number[] }));
vi.mock("@formepdf/core", async (importOriginal) => {
	const forme = await importOriginal<typeof import("@formepdf/core")>();
	return {
		...forme,
		prepareFont: undefined,
		renderSerializedDocWithLayout: (document: Record<string, unknown>) => {
			passes.fontBytes.push(
				(document.fonts as { src: string | Uint8Array }[]).reduce((total, font) => total + font.src.length, 0),
			);
			return forme.renderSerializedDocWithLayout(document);
		},
	};
});

it(
	"cuts a CJK resume's fonts to its characters before the engine gets them (#3593)",
	{ timeout: 120_000 },
	async () => {
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

		const file = await createResumePdfFile({ data, filename: "cjk.pdf" });

		expect(file.type).toBe("application/pdf");
		expect(file.size).toBeGreaterThan(5_000);
		expect(passes.fontBytes.length).toBeGreaterThan(0);
		// Each whole Noto Sans SC face is over 10 MB.
		expect(Math.max(...passes.fontBytes)).toBeLessThan(2_000_000);
	},
);
