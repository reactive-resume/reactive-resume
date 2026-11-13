// @vitest-environment happy-dom
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { Entries } from "./section-view";

const fixture = vi.hoisted(() => ({
	data: null as ResumeData | null,
	update: vi.fn(),
}));

vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentBuilderResumeSelector: (selector: (resume: { data: ResumeData }) => unknown) =>
		selector({ data: fixture.data as ResumeData }),
	useUpdateResumeData: () => fixture.update,
}));
vi.mock("./actions", () => ({ addEntryTo: vi.fn() }));
vi.mock("./entry-row", () => ({ EntryRow: () => null, moveEntry: vi.fn() }));
vi.mock("./fields", () => ({ TextField: () => null }));
vi.mock("./outline", () => ({
	useProposedCount: () => 0,
	useSectionTitle: () => "",
	useSortSensors: () => [],
}));
vi.mock("./summary-editor", () => ({ SummaryEditor: () => null }));
vi.mock("./view", () => ({ openOutline: vi.fn() }));
vi.mock("@/components/input/icon-picker", () => ({ IconPicker: () => null }));
vi.mock("@/features/resume/editor/chrome/panel", () => ({
	PanelBody: ({ children }: { children?: unknown }) => children,
	PanelHeader: () => null,
}));
vi.mock("@/hooks/use-confirm", () => ({ usePrompt: () => vi.fn() }));
vi.mock("@/libs/dnd", () => ({ dndContextProps: () => ({}) }));

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});

it("sorts publications by date, newest first", () => {
	fixture.data = structuredClone(sampleResumeData);
	fixture.update.mockImplementation((recipe: (data: ResumeData) => void) => recipe(fixture.data as ResumeData));

	render(
		<I18nProvider i18n={i18n}>
			<Entries section={{ id: "publications", kind: "builtin", type: "publications" }} locked={false} />
		</I18nProvider>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Sort by date" }));

	expect(fixture.update).toHaveBeenCalledOnce();
	expect(fixture.data.sections.publications.items.map((entry) => entry.title)).toEqual([
		"Building Modular Dialogue Systems",
		"Optimizing Unity Games for Mobile: A Practical Guide",
	]);
});

const renderSection = (type: "publications" | "projects", locked: boolean, count: number) => {
	fixture.data = structuredClone(sampleResumeData);
	fixture.data.sections[type].items = fixture.data.sections[type].items.slice(0, count);
	return render(
		<I18nProvider i18n={i18n}>
			<Entries section={{ id: type, kind: "builtin", type }} locked={locked} />
		</I18nProvider>,
	);
};

it.each([
	["a section without dated entries", "projects", false, 2],
	["a locked section", "publications", true, 2],
	["a section with one entry", "publications", false, 1],
] as const)("does not offer date sorting for %s", (_label, type, locked, count) => {
	renderSection(type, locked, count);

	expect(screen.queryByRole("button", { name: "Sort by date" })).toBeNull();
});
