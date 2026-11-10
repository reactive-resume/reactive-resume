import { analyzePdfResume, type RawExtraction } from "@reactive-resume/resume/ats-pdf";
import { now } from "./clock";
import { storyboardTexts } from "./fixtures";
/** Synthetic extraction for the undrawn result state; uses real checks over storyboard resume words. */
export function storyboardPdfCheck(name: string, posting: string) {
	const lines = storyboardTexts["B1-Overview"].slice(2, 27);
	const raw: RawExtraction = {
		version: 1,
		file: { name, sizeBytes: 0, magicBytesOk: true },
		pageCount: 1,
		truncated: false,
		pages: [
			{
				pageNumber: 1,
				width: 595,
				height: 842,
				rotation: 0,
				operators: null,
				items: lines.map((str, index) => ({
					str,
					transform: [11, 0, 0, 11, 40, 800 - index * 24],
					width: Math.min(500, str.length * 5),
					height: 11,
					fontRef: "fixture",
					hasEol: true,
				})),
			},
		],
		fonts: [
			{
				ref: "fixture",
				name: null,
				isType3: false,
				isInvalid: false,
				missingFile: false,
				isMonospace: null,
				isSerif: null,
				vertical: false,
			},
		],
		links: [],
		operatorsAvailable: false,
		metadata: {
			producer: null,
			creator: null,
			title: null,
			author: null,
			language: "en-US",
			pdfVersion: null,
			isEncrypted: false,
			isXfa: false,
			isCollection: false,
			isTagged: false,
			hasAcroForm: false,
		},
	};
	return { report: analyzePdfResume(raw, { now: now(), jobDescription: posting }), fullText: lines.join("\n") };
}
