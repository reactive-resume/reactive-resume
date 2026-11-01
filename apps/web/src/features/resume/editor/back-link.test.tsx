// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";

const context = vi.hoisted(() => ({
	params: {} as { resumeId?: string; coverLetterId?: string },
	search: {} as { applicationId?: string },
	letter: null as { id: string; sourceApplicationId: string | null } | null,
	resume: null as { id: string; applicationId?: string | null } | null,
	applications: [
		{ id: "job-a", company: "Lumen", resumeId: "shared", coverLetterId: "letter-a" },
		{ id: "job-b", company: "Orbit", resumeId: "shared", coverLetterId: "letter-b" },
	],
}));
vi.mock("@tanstack/react-router", () => ({
	useParams: () => context.params,
	useSearch: () => context.search,
	Link: ({
		to,
		search = {},
		children,
		...props
	}: {
		to: string;
		search?: { applicationId?: string };
		children?: ReactNode;
	}) => (
		<a {...props} href={to + (search.applicationId ? `?applicationId=${search.applicationId}` : "")}>
			{children}
		</a>
	),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: context.applications }) }));
vi.mock("@/features/applications/queries", () => ({ applicationsListQueryOptions: () => ({}) }));
vi.mock("@/features/letters/store", () => ({
	useLetterEditorStore: (select: (state: { letter: typeof context.letter }) => unknown) =>
		select({ letter: context.letter }),
}));
vi.mock("@/features/resume/builder/draft", () => ({
	useResumeStore: (select: (state: { resume: typeof context.resume }) => unknown) => select({ resume: context.resume }),
}));
const { BackLink } = await import("./chrome");
afterEach(cleanup);
it.each([
	{
		params: { resumeId: "shared" },
		search: { applicationId: "job-b" },
		company: "Orbit",
		href: "/dashboard/applications?applicationId=job-b",
	},
	{
		params: { coverLetterId: "letter-a" },
		search: {},
		company: "Lumen",
		href: "/dashboard/applications?applicationId=job-a",
	},
	{ params: { resumeId: "unlinked" }, search: {}, company: null, href: "/dashboard" },
])("returns document to its selected application or Documents: $href", ({ params, search, company, href }) => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	context.params = params;
	context.search = search;
	// Stale draft stores from another editor must not steal navigation.
	context.letter = { id: "stale-letter", sourceApplicationId: "job-a" };
	context.resume = { id: "stale-resume", applicationId: "job-a" };
	render(<BackLink />);
	expect(screen.getByRole("link", { name: company ? `Back to ${company}` : "Back to documents" })).toHaveAttribute(
		"href",
		href,
	);
});
