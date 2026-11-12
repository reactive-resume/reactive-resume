import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { pageRenderer } from "@/render/page-renderer";
export { lumenPosting as atsSamplePosting, postingTerms as atsSampleTerms } from "./board-fixtures";

/** Uses the existing native PDF owner; no account, network write, or private resume required. */
export async function atsSampleFile() {
	const result = await pageRenderer.render({
		kind: "resume",
		id: "ats-public-sample",
		revision: 1,
		data: structuredClone(sampleResumeData),
		public: true,
	});
	return { uri: result.pdfFile, name: "sample-resume.pdf", mimeType: "application/pdf" };
}
