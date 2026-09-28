// @vitest-environment happy-dom

import type { Resume } from "@/features/resume/builder/draft";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const sectionItems = vi.hoisted(() => [
	{
		id: "p1",
		hidden: false,
		network: "GitHub",
		username: "jane",
		icon: "github",
		iconColor: "",
		website: { url: "", label: "", inlineLink: false },
	},
	{
		id: "p2",
		hidden: false,
		network: "LinkedIn",
		username: "jane-doe",
		icon: "linkedin",
		iconColor: "",
		website: { url: "", label: "", inlineLink: false },
	},
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
			data: {
				sections: { profiles: { title: "Profiles", columns: 1, hidden: false, items: sectionItems } },
			},
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
const ProfilesSectionBuilder = () => <ItemsSection type="profiles" />;

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});

describe("ProfilesSectionBuilder", () => {
	it("renders one SectionItem per profile with network as title and username as subtitle", () => {
		render(
			<I18nProvider i18n={i18n}>
				<ProfilesSectionBuilder />
			</I18nProvider>,
		);

		const titles = screen.getAllByTestId("item-title").map((el) => el.textContent);
		expect(titles).toEqual(["GitHub", "LinkedIn"]);

		const subtitles = screen.getAllByTestId("item-subtitle").map((el) => el.textContent);
		expect(subtitles).toEqual(["jane", "jane-doe"]);
	});

	it("renders the 'Add a new profile' affordance", () => {
		render(
			<I18nProvider i18n={i18n}>
				<ProfilesSectionBuilder />
			</I18nProvider>,
		);
		expect(screen.getByRole("button", { name: "Add a new profile" })).toBeInTheDocument();
	});

	it("uses non-dashed border when items are present", () => {
		render(
			<I18nProvider i18n={i18n}>
				<ProfilesSectionBuilder />
			</I18nProvider>,
		);
		const wrapper = screen.getByTestId("section-base");
		expect(wrapper.className).toContain("border");
		expect(wrapper.className).not.toContain("border-dashed");
	});
});
