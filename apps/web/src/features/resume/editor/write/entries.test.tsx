// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { EntryFields } from "./entries";

vi.mock("./rich-text-editor", () => ({
	RichTextEditor: ({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) => (
		<textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
	),
}));

it("keeps company-level content editable under More options when roles take the main form", () => {
	i18n.load("en", {});
	i18n.activate("en");
	const entry = structuredClone(sampleResumeData.sections.experience.items[0]);
	if (!entry) throw Error("Missing sample experience");
	entry.position = "Company-level position";
	entry.description = "Company-level description";
	entry.roles = [
		{
			id: "promotion",
			position: "Promoted position",
			period: "2025",
			dates: { start: "2025", end: null, present: true },
			description: "Role description",
		},
	];
	const write = vi.fn();
	render(
		<I18nProvider i18n={i18n}>
			<EntryFields type="experience" entry={entry} write={write} page={{ locale: "en-GB" }} locked={false} />
		</I18nProvider>,
	);
	expect(screen.getByDisplayValue("Promoted position")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "More options" }));
	const position = screen.getByDisplayValue("Company-level position");
	expect(position).toBeVisible();
	expect(screen.getByDisplayValue("Company-level description")).toBeVisible();
	fireEvent.change(position, { target: { value: "Updated company position" } });
	const mutation = write.mock.lastCall?.[1];
	expect(mutation).toBeTypeOf("function");
	mutation?.(entry);
	expect(entry.position).toBe("Updated company position");
	expect(entry.roles[0]?.description).toBe("Role description");
});
