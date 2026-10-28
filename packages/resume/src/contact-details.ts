import type { ResumeData } from "@reactive-resume/schema/resume/data";

/**
 * Clears the contact details an author chose to hide from the public: the header's email, phone, location and custom
 * fields, and each reference's phone number. Everything public is drawn from data that went through here, so the web
 * page, its PDF, its structured data, its preview card and the API all leave them out.
 */
export function removeContactDetails(data: ResumeData): void {
	Object.assign(data.basics, { email: "", phone: "", location: "", customFields: [] });
	for (const item of data.sections.references.items) item.phone = "";
	for (const section of data.customSections) {
		if (section.type === "references") for (const item of section.items) item.phone = "";
	}
}
