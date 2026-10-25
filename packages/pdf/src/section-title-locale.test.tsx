import { describe, expect, it } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { getResumeSectionTitle } from "./section-title";

function fixture(locale: string) {
	const data = structuredClone(defaultResumeData);
	data.metadata.page.locale = locale;
	data.metadata.typography.body.fontFamily = "Helvetica";
	data.metadata.typography.heading.fontFamily = "Helvetica";
	data.metadata.layout.pages = [{ fullWidth: true, main: ["summary"], sidebar: [] }];
	data.picture.hidden = true;
	data.summary.content = "<p>Localized document content.</p>";
	return data;
}

describe("default PDF section title locale", () => {
	it("localizes default headings", () => {
		const data = fixture("es-ES");
		expect(getResumeSectionTitle(data, "summary", "")).toBe("Resumen");
		expect(getResumeSectionTitle(data, "experience", "")).toBe("Experiencia");
		expect(getResumeSectionTitle(data, "education", "")).toBe("Formación académica");
	});
	it("preserves explicit titles", () => {
		const data = fixture("es-ES");
		data.summary.title = "My custom title";
		expect(getResumeSectionTitle(data, "summary", "")).toBe("My custom title");
	});
	it("resolves custom sections by their type and preserves unknown-section fallbacks", () => {
		const data = fixture("es-ES");
		data.customSections = [{ ...data.sections.experience, id: "custom-experience", type: "experience" }];
		expect(getResumeSectionTitle(data, "custom-experience", "")).toBe("Experiencia");
		data.customSections = [{ ...data.sections.experience, id: "custom-summary", type: "summary", items: [] }];
		expect(getResumeSectionTitle(data, "custom-summary", "")).toBe("Resumen");
		expect(getResumeSectionTitle(data, "unknown", "Legacy label")).toBe("Legacy label");
	});
});
