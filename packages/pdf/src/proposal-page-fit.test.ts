import type { PageMap } from "./page-map";
import type { Proposal } from "@reactive-resume/resume/proposals";
import { describe, expect, it } from "vite-plus/test";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { measureProposalPageFit } from "./page-map";

describe("proposal page fit", () => {
	it("measures the accepted private copy, including an undone edit, without touching the resume", async () => {
		const data = structuredClone(sampleResumeData);
		data.metadata.layout.pages = data.metadata.layout.pages.slice(0, 1);
		data.metadata.typography.body.fontSize = 10;
		data.metadata.typography.body.lineHeight = 1;
		data.summary.content = "<p>Original</p>";
		const original = structuredClone(data);
		const proposal: Proposal = {
			id: "edit",
			target: { sectionId: "summary", field: "content" },
			location: "Summary",
			before: "<p>Original</p>",
			after: "<p>Revised</p>",
			why: "Relevant wording",
			status: "accepted",
			source: "assistant",
		};
		const seen: string[] = [];
		const result = await measureProposalPageFit(data, [proposal], async (candidate) => {
			seen.push(candidate.summary.content);
			const bottom = candidate.summary.content.includes("Revised") ? 230 : 150;
			return {
				pages: [
					{ width: 595, height: 842 },
					{ width: 595, height: 842, contentBounds: { top: 10, bottom } },
				],
				nodes: [0, 1].map((page) => ({
					kind: "section",
					sectionId: "summary",
					key: "page-1/region-main/section-summary",
					page,
					x: 0,
					y: 10,
					width: 400,
					height: bottom - 10,
				})),
			};
		});
		expect(seen).toEqual(["<p>Original</p>", "<p>Revised</p>"]);
		expect(result).toEqual({ before: 2, after: 2, lines: 8 });
		expect(data).toEqual(original);
		expect(proposal.status).toBe("accepted");
	});

	it("reports page counts without inventing lines when semantic bounds are unavailable", async () => {
		const data = structuredClone(sampleResumeData);
		data.metadata.layout.pages = data.metadata.layout.pages.slice(0, 1);
		let call = 0;
		const render = async (): Promise<PageMap> => ({
			pages: Array.from({ length: ++call }, () => ({ width: 595, height: 842 })),
			nodes: [],
		});
		expect(await measureProposalPageFit(data, [], render)).toEqual({ before: 1, after: 2, lines: null });
	});

	it("propagates a failed render instead of treating missing measurement as zero", async () => {
		await expect(
			measureProposalPageFit(sampleResumeData, [], async () => {
				throw new Error("Font unavailable");
			}),
		).rejects.toThrow("Font unavailable");
	});
});
