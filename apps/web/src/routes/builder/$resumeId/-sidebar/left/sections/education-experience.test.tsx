// @vitest-environment happy-dom

import type { Resume } from "@/features/resume/builder/draft";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const educationItems = vi.hoisted(() => [
	{
		id: "e1",
		school: "MIT",
		degree: "BS",
		area: "CS",
		grade: "",
		location: "",
		period: "2010-2014",
		description: "",
		hidden: false,
		website: { url: "", label: "", inlineLink: false },
	},
]);
const experienceItems = vi.hoisted(() => [
	// Experience with position set
	{
		id: "x1",
		company: "Acme",
		position: "Senior Engineer",
		location: "",
		period: "2020-2024",
		description: "",
		hidden: false,
		website: { url: "", label: "", inlineLink: false },
		roles: [],
	},
	// Experience with empty position and multiple roles → falls back to "N roles"
	{
		id: "x2",
		company: "BetaCo",
		position: "",
		location: "",
		period: "2015-2020",
		description: "",
		hidden: false,
		website: { url: "", label: "", inlineLink: false },
		roles: [
			{ position: "Engineer", period: "" },
			{ position: "Lead", period: "" },
		],
	},
	// Experience with empty position and one role → "1 role"
	{
		id: "x3",
		company: "Gamma",
		position: "",
		location: "",
		period: "2014",
		description: "",
		hidden: false,
		website: { url: "", label: "", inlineLink: false },
		roles: [{ position: "Intern", period: "" }],
	},
]);

type SectionBaseProps = {
	children: React.ReactNode;
};

type SectionAddItemButtonProps = {
	children: React.ReactNode;
};

type SectionItemProps = {
	title: string;
	subtitle: string;
};

vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentBuilderResumeSelector: (selector: (resume: Resume) => unknown) =>
		selector({
			data: {
				sections: {
					education: { title: "Education", columns: 1, hidden: false, items: educationItems },
					experience: { title: "Experience", columns: 1, hidden: false, items: experienceItems },
				},
			},
		} as unknown as Resume),
	useUpdateResumeData: () => vi.fn(),
}));
vi.mock("../shared/section-base", () => ({
	SectionBase: ({ children }: SectionBaseProps) => <div>{children}</div>,
}));
vi.mock("../shared/section-item", () => ({
	SectionAddItemButton: ({ children }: SectionAddItemButtonProps) => <button type="button">{children}</button>,
	SectionItem: ({ title, subtitle }: SectionItemProps) => (
		<div>
			<span data-testid="item-title">{title}</span>
			<span data-testid="item-subtitle">{subtitle}</span>
		</div>
	),
}));

const { ItemsSection } = await import("../shared/items-section");
const EducationSectionBuilder = () => <ItemsSection type="education" />;
const ExperienceSectionBuilder = () => <ItemsSection type="experience" />;

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});

const wrap = (ui: React.ReactNode) => <I18nProvider i18n={i18n}>{ui}</I18nProvider>;

describe("EducationSectionBuilder", () => {
	it("maps school → title and degree → subtitle", () => {
		render(wrap(<EducationSectionBuilder />));
		expect(screen.getByTestId("item-title").textContent).toBe("MIT");
		expect(screen.getByTestId("item-subtitle").textContent).toBe("BS");
	});

	it("renders the Add a new education affordance", () => {
		render(wrap(<EducationSectionBuilder />));
		expect(screen.getByRole("button", { name: "Add a new education" })).toBeInTheDocument();
	});
});

describe("ExperienceSectionBuilder", () => {
	it("uses position as subtitle when present", () => {
		render(wrap(<ExperienceSectionBuilder />));
		const subtitles = screen.getAllByTestId("item-subtitle").map((el) => el.textContent);
		expect(subtitles[0]).toBe("Senior Engineer");
	});

	it("falls back to 'N roles' when position is empty and multiple roles exist", () => {
		render(wrap(<ExperienceSectionBuilder />));
		const subtitles = screen.getAllByTestId("item-subtitle").map((el) => el.textContent);
		expect(subtitles[1]).toBe("2 roles");
	});

	it("uses '1 role' (singular) for a single role entry", () => {
		render(wrap(<ExperienceSectionBuilder />));
		const subtitles = screen.getAllByTestId("item-subtitle").map((el) => el.textContent);
		expect(subtitles[2]).toBe("1 role");
	});

	it("renders the Add a new experience affordance", () => {
		render(wrap(<ExperienceSectionBuilder />));
		expect(screen.getByRole("button", { name: "Add a new experience" })).toBeInTheDocument();
	});
});
