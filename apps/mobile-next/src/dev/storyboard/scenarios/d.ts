import type { Scenario } from "../harness";
import { overBackdrop } from "../backdrop";
import { useResumeStore, useLetterStore } from "@/data";
const resume = "/builder/resume-product";
const letter = "/letter/letter-0";
const openResume = async () => {
	await useResumeStore.getState().open("resume-product");
};
const openLetter = async () => {
	await useLetterStore.getState().open("letter-0");
};
export const scenarios: Record<string, Scenario> = {
	"B11-Share": { hrefs: ["/documents", `${resume}/share`], prepare: openResume },
	"B12-WebPage": { hrefs: ["/documents", `${resume}/share`, `${resume}/share/web-page`], prepare: openResume },
	"B13-Visitors": { hrefs: ["/documents", `${resume}/share`, `${resume}/share/activity`] },
	"B14-Download": { hrefs: ["/documents", ...overBackdrop("B14-Download", `${resume}/download`)], prepare: openResume },
	"B15-Versions": { hrefs: ["/documents", `${resume}/share`, `${resume}/versions`] },
	"B16-Assistant": { hrefs: ["/documents", resume, `${resume}/assistant`], prepare: openResume },
	"B17-Proposals": {
		hrefs: ["/documents", resume, `${resume}/assistant`, `${resume}/assistant/proposals`],
		prepare: openResume,
	},
	"B18-Preview": { hrefs: ["/documents", resume, `${resume}/preview`], prepare: openResume },
	"B19-More": {
		hrefs: ["/documents", ...overBackdrop("B19-More", `${resume}/menu`)],
		prepare: async () => {
			await openResume();
			const document = useResumeStore.getState().document;
			if (document) useResumeStore.setState({ locked: true, document: { ...document, isLocked: true } });
		},
	},
	"L1-Letter": { hrefs: ["/documents", letter], prepare: openLetter },
	"L2-LetterDesign": { hrefs: ["/documents", `${letter}/design`], prepare: openLetter },
};
