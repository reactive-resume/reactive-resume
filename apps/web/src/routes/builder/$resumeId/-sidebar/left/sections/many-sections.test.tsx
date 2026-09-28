// @vitest-environment happy-dom

//
// Bulk-cover the small reorderable section components — they all share the same
// shape: render a SectionItem per data row with title/subtitle mapped to specific
// fields, plus an "Add a new X" button. Test them together to amortize the mock setup.

import type { Resume } from "@/features/resume/builder/draft";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const sections = vi.hoisted(() => ({
	awards: [
		{
			id: "a1",
			title: "Hackathon Winner",
			awarder: "Acme",
			date: "2024",
			hidden: false,
			description: "",
			website: { url: "", label: "", inlineLink: false },
		},
	],
	certifications: [
		{
			id: "c1",
			title: "AWS Solutions Architect",
			issuer: "AWS",
			date: "2024",
			hidden: false,
			description: "",
			website: { url: "", label: "", inlineLink: false },
		},
	],
	interests: [{ id: "i1", name: "Cooking", keywords: [], hidden: false, icon: "", iconColor: "" }],
	languages: [{ id: "l1", language: "English", fluency: "Native", level: 5, hidden: false }],
	publications: [
		{
			id: "p1",
			title: "On Type Systems",
			publisher: "ACM",
			date: "2024",
			hidden: false,
			description: "",
			website: { url: "", label: "", inlineLink: false },
		},
	],
	references: [
		{
			id: "r1",
			name: "Bob Smith",
			position: "Manager",
			phone: "",
			hidden: false,
			description: "",
			website: { url: "", label: "", inlineLink: false },
		},
	],
	volunteer: [
		{
			id: "v1",
			organization: "Code for Good",
			position: "Mentor",
			location: "Berlin",
			period: "2022",
			hidden: false,
			description: "",
			website: { url: "", label: "", inlineLink: false },
			summary: "",
		},
	],
}));

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
				sections: {
					awards: { title: "Awards", columns: 1, hidden: false, items: sections.awards },
					certifications: { title: "Certifications", columns: 1, hidden: false, items: sections.certifications },
					interests: { title: "Interests", columns: 1, hidden: false, items: sections.interests },
					languages: { title: "Languages", columns: 1, hidden: false, items: sections.languages },
					publications: { title: "Publications", columns: 1, hidden: false, items: sections.publications },
					references: { title: "References", columns: 1, hidden: false, items: sections.references },
					volunteer: { title: "Volunteer", columns: 1, hidden: false, items: sections.volunteer },
				},
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
	SectionAddItemButton: ({ children }: SectionAddItemButtonProps) => (
		<button type="button" data-testid="add-button">
			{children}
		</button>
	),
	SectionItem: ({ title, subtitle }: SectionItemProps) => (
		<div>
			<span data-testid="item-title">{title}</span>
			<span data-testid="item-subtitle">{subtitle}</span>
		</div>
	),
}));

const { ItemsSection } = await import("../shared/items-section");
const AwardsSectionBuilder = () => <ItemsSection type="awards" />;
const CertificationsSectionBuilder = () => <ItemsSection type="certifications" />;
const InterestsSectionBuilder = () => <ItemsSection type="interests" />;
const LanguagesSectionBuilder = () => <ItemsSection type="languages" />;
const PublicationsSectionBuilder = () => <ItemsSection type="publications" />;
const ReferencesSectionBuilder = () => <ItemsSection type="references" />;
const VolunteerSectionBuilder = () => <ItemsSection type="volunteer" />;

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
});

const wrap = (ui: React.ReactNode) => <I18nProvider i18n={i18n}>{ui}</I18nProvider>;

describe("left sidebar section builders — title/subtitle mapping", () => {
	const cases = [
		{
			name: "awards",
			Component: AwardsSectionBuilder,
			title: "Hackathon Winner",
			subtitle: "Acme",
			addCopy: "Add a new award",
		},
		{
			name: "certifications",
			Component: CertificationsSectionBuilder,
			title: "AWS Solutions Architect",
			subtitle: "AWS • 2024",
			addCopy: "Add a new certification",
		},
		{
			name: "interests",
			Component: InterestsSectionBuilder,
			title: "Cooking",
			subtitle: "",
			addCopy: "Add a new interest",
		},
		{
			name: "languages",
			Component: LanguagesSectionBuilder,
			title: "English",
			subtitle: "Native",
			addCopy: "Add a new language",
		},
		{
			name: "publications",
			Component: PublicationsSectionBuilder,
			title: "On Type Systems",
			subtitle: "ACM",
			addCopy: "Add a new publication",
		},
		{
			name: "references",
			Component: ReferencesSectionBuilder,
			title: "Bob Smith",
			subtitle: "",
			addCopy: "Add a new reference",
		},
		{
			name: "volunteer",
			Component: VolunteerSectionBuilder,
			title: "Code for Good",
			subtitle: "Berlin",
			addCopy: "Add a new volunteer experience",
		},
	] as const;

	for (const { name, Component, title, subtitle, addCopy } of cases) {
		it(`${name}: maps fields and renders the add button`, () => {
			const { unmount } = render(wrap(<Component />));
			expect(screen.getByTestId("item-title").textContent).toBe(title);
			expect(screen.getByTestId("item-subtitle").textContent ?? "").toBe(subtitle);
			expect(screen.getByRole("button", { name: addCopy })).toBeInTheDocument();
			unmount();
		});
	}
});
