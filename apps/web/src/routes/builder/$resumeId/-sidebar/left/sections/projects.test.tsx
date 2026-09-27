// @vitest-environment happy-dom

import type { Resume } from "@/features/resume/builder/draft";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const items = vi.hoisted(() => [
	// Both period and website label present → "2024 • Site"
	{
		id: "p1",
		name: "Open CLI",
		period: "2024",
		hidden: false,
		description: "",
		website: { url: "https://example.com", label: "Site", inlineLink: false },
	},
	// Only period
	{
		id: "p2",
		name: "Plugin",
		period: "2023",
		hidden: false,
		description: "",
		website: { url: "", label: "", inlineLink: false },
	},
	// No period, no label
	{
		id: "p3",
		name: "Drafts",
		period: "",
		hidden: false,
		description: "",
		website: { url: "", label: "   ", inlineLink: false },
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
	subtitle?: string;
};

vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentBuilderResumeSelector: (selector: (resume: Resume) => unknown) =>
		selector({
			data: { sections: { projects: { title: "Projects", columns: 1, hidden: false, items } } },
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
			<span data-testid="item-subtitle">{subtitle ?? "<undefined>"}</span>
		</div>
	),
}));

const { ItemsSection } = await import("../shared/items-section");
const ProjectsSectionBuilder = () => <ItemsSection type="projects" />;

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("ProjectsSectionBuilder buildSubtitle", () => {
	it("joins period and website label with ' • ' when both are present", () => {
		render(
			<I18nProvider i18n={i18n}>
				<ProjectsSectionBuilder />
			</I18nProvider>,
		);

		const subtitles = screen.getAllByTestId("item-subtitle").map((el) => el.textContent);
		expect(subtitles[0]).toBe("2024 • Site");
	});

	it("uses just the period when no website label is set", () => {
		render(
			<I18nProvider i18n={i18n}>
				<ProjectsSectionBuilder />
			</I18nProvider>,
		);
		const subtitles = screen.getAllByTestId("item-subtitle").map((el) => el.textContent);
		expect(subtitles[1]).toBe("2023");
	});

	it("returns undefined when neither period nor a non-blank website label is provided", () => {
		render(
			<I18nProvider i18n={i18n}>
				<ProjectsSectionBuilder />
			</I18nProvider>,
		);
		const subtitles = screen.getAllByTestId("item-subtitle").map((el) => el.textContent);
		// Mock stub renders the literal string "<undefined>" when subtitle was undefined.
		expect(subtitles[2]).toBe("<undefined>");
	});

	it("renders the Add a new project affordance", () => {
		render(
			<I18nProvider i18n={i18n}>
				<ProjectsSectionBuilder />
			</I18nProvider>,
		);
		expect(screen.getByRole("button", { name: "Add a new project" })).toBeInTheDocument();
	});
});
