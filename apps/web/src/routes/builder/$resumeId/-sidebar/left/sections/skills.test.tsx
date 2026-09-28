// @vitest-environment happy-dom

import type { Resume } from "@/features/resume/builder/draft";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const sectionItems = vi.hoisted(() => [
	{ id: "s1", name: "TypeScript", proficiency: "Expert", level: 5, keywords: [], description: "", hidden: false },
	{ id: "s2", name: "Go", proficiency: "Intermediate", level: 3, keywords: [], description: "", hidden: false },
]);

type SectionBaseProps = {
	children: React.ReactNode;
	className?: string;
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
			data: { sections: { skills: { title: "Skills", columns: 1, hidden: false, items: sectionItems } } },
		} as unknown as Resume),
	useUpdateResumeData: () => vi.fn(),
}));
vi.mock("../shared/section-base", () => ({
	SectionBase: ({ children, className }: SectionBaseProps) => (
		<div className={className} data-testid="section-base">
			{children}
		</div>
	),
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
const SkillsSectionBuilder = () => <ItemsSection type="skills" />;

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("SkillsSectionBuilder", () => {
	it("renders one SectionItem per skill, mapping name → title and proficiency → subtitle", () => {
		render(
			<I18nProvider i18n={i18n}>
				<SkillsSectionBuilder />
			</I18nProvider>,
		);

		expect(screen.getAllByTestId("item-title").map((el) => el.textContent)).toEqual(["TypeScript", "Go"]);
		expect(screen.getAllByTestId("item-subtitle").map((el) => el.textContent)).toEqual(["Expert", "Intermediate"]);
	});

	it("renders an Add a new skill affordance", () => {
		render(
			<I18nProvider i18n={i18n}>
				<SkillsSectionBuilder />
			</I18nProvider>,
		);
		expect(screen.getByRole("button", { name: "Add a new skill" })).toBeInTheDocument();
	});
});
