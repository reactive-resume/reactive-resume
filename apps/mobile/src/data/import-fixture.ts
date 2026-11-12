import type { ImportPreview } from "./import";
import { reviewImport } from "@reactive-resume/import/review";
import { fakeBackend } from "./fixtures";

/** D4 reviews a parsed file, a different document from the saved eight-skill resume. */
export async function storyboardImportPreview(): Promise<Extract<ImportPreview, { kind: "resume" }>> {
	const data = structuredClone((await fakeBackend.read("resume", { id: "resume-product" })).data);
	data.basics.headline = "Product designer";
	data.basics.location = "Lisbon";
	data.metadata.page.locale = "en-GB";
	const expand = <T extends { id: string }>(items: T[], count: number) =>
		Array.from({ length: count }, (_, i) => {
			const item = items[i % items.length];
			if (!item) throw new Error("Missing import fixture entry.");
			return { ...structuredClone(item), id: `import-${i}` };
		});
	data.sections.experience.items = expand(data.sections.experience.items, 4);
	data.sections.education.items = expand(data.sections.education.items, 2);
	data.sections.skills.items = expand(data.sections.skills.items, 12);
	data.sections.languages.items = ["English", "Portuguese", "Spanish"].map((name, i) => ({
		id: `language-${i}`,
		hidden: false,
		language: name,
		fluency: "",
		level: 0,
	}));
	return {
		kind: "resume",
		file: {
			uri: "fixture://alex-morgan-cv.pdf",
			name: "alex-morgan-cv.pdf",
			size: 182 * 1024,
			lastModified: 0,
			mimeType: "application/pdf",
		},
		scope: "storyboard",
		data,
		summary: { ...reviewImport(data), notImported: ["Text we couldn't place, to sort later"] },
		language: "en-GB",
		compared: true,
		partial: false,
		aiOperationIds: [],
	};
}
