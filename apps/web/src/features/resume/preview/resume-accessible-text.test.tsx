// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { assert, beforeAll, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { ResumeAccessibleText } from "./resume-accessible-text";

vi.mock("@/features/resume/builder/draft", () => ({ useResumeData: () => undefined }));
beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

function renderAccessibleText(data: typeof sampleResumeData) {
	return render(
		<I18nProvider i18n={i18n}>
			<ResumeAccessibleText data={data} />
		</I18nProvider>,
	);
}
it("exposes entry and subordinate-role headings with safe nested rich-text lists", () => {
	// Characterization before this change: item labels had no heading elements and rich-text lists were flattened into one paragraph.
	const data = structuredClone(sampleResumeData);
	const item = data.sections.experience.items[0];
	assert.exists(item);
	data.sections.experience.items = [
		{
			...item,
			id: "hierarchy-item",
			company: "Acme Company",
			position: "",
			description:
				'<p>Summary <strong>emphasis</strong>.</p><ul><li>First bullet</li><li><em>Second bullet</em><ol><li>Nested bullet</li></ol></li></ul><p><a href="javascript:alert(1)">Unsafe link</a></p><script>alert(1)</script>',
			roles: [
				{
					id: "hierarchy-role",
					position: "Lead Role",
					period: "2020 - 2022",
					description: "<p>Role <strong>detail</strong>.</p>",
				},
			],
		},
		{
			...item,
			id: "blank-primary-item",
			company: "",
			position: "",
			description: "<p>Blank primary body.</p>",
			roles: [],
		},
	];
	data.sections.projects.items = [];

	renderAccessibleText(data);

	expect(screen.getByRole("heading", { level: 3, name: "Acme Company" })).toBeInTheDocument();
	expect(screen.getByRole("heading", { level: 4, name: "Lead Role" })).toBeInTheDocument();
	const experience = screen.getAllByRole("heading", { level: 2, name: "Experience" })[0]?.parentElement;
	expect(experience?.querySelectorAll("h3")).toHaveLength(1);
	expect(screen.getByText("First bullet").tagName).toBe("LI");
	expect(screen.getByText("Nested bullet").tagName).toBe("LI");
	expect(screen.getByText("emphasis").tagName).toBe("STRONG");
	expect(screen.getByText("Second bullet").tagName).toBe("EM");
	expect(screen.queryByRole("link", { name: "Unsafe link" })).not.toBeInTheDocument();
	expect(screen.queryByText("alert(1)")).not.toBeInTheDocument();
	expect(screen.getByText("Acme Company")).toHaveTextContent("Acme Company");
});
