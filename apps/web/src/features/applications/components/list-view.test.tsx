import type { Application } from "../types";
// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApplicationList } from "./list-view";

const mocks = vi.hoisted(() => ({ breakpoint: "desktop", invalidate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useRouteContext: () => ({ session: { user: { timezone: "UTC" } } }) }));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: {
			lanes: {
				get: {
					queryOptions: () => ({ queryKey: ["lanes"], queryFn: () => new Promise(() => {}) }),
					queryKey: () => ["lanes"],
				},
			},
			priorNoResponse: { queryOptions: () => ({ queryKey: ["prior"], queryFn: async () => [] }) },
			bulkUpdate: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			bulkDelete: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
		},
	},
}));
vi.mock("../use-application-actions", () => ({ useInvalidateApplications: () => mocks.invalidate }));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({ useBreakpoint: () => mocks.breakpoint }));

const LONG_NOTE =
	"Call Priya back about the take-home timeline, then email a summary of the referral conversation " +
	"and the salary band she mentioned on Tuesday";

const application = (over: Partial<Application> = {}): Application =>
	({
		id: "app-1",
		status: "applied",
		role: "Senior Frontend Engineer",
		company: "Globex",
		location: "San Francisco",
		appliedAt: new Date("2026-10-01T00:00:00.000Z"),
		updatedAt: new Date("2026-10-19T00:00:00.000Z"),
		activity: [],
		followUpAt: null,
		followUpNote: null,
		resumeId: null,
		coverLetterId: null,
		closedReason: null,
		tags: [],
		...over,
	}) as Application;

function renderList(applications: Application[], breakpoint = "desktop", onOpen = vi.fn()) {
	mocks.breakpoint = breakpoint;
	i18n.load("en", {});
	i18n.activate("en");
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<I18nProvider i18n={i18n}>
				<ApplicationList applications={applications} showClosed selectedId={null} onOpen={onOpen} />
			</I18nProvider>
		</QueryClientProvider>,
	);
}

const headers = (container: HTMLElement) => Array.from(container.querySelectorAll("thead th"));
const header = (container: HTMLElement, label: string) =>
	headers(container).find((th) => th.textContent === label) as HTMLElement;

it("fixes the table layout so a long follow-up note cannot starve Role", () => {
	const { container } = renderList([
		application({ followUpAt: new Date("2026-10-25T00:00:00.000Z"), followUpNote: LONG_NOTE }),
	]);

	expect(container.querySelector("table")?.className).toContain("table-fixed");
	expect(header(container, "Next step").className).toContain("w-1/4");
	expect(header(container, "Role").className).not.toMatch(/\bw-[\d/]/);

	// The note keeps its ellipsis affordance inside a flex item allowed to shrink.
	const note = screen.getByText(LONG_NOTE);
	expect(note.className).toContain("truncate");
	expect(note.className).toContain("min-w-0");
});

it.each([
	["mobile", 1],
	["tablet", 4],
	["desktop", 5],
	["wide", 6],
] as const)("spans only visible columns at the %s breakpoint", (breakpoint, columns) => {
	const { container } = renderList([application()], breakpoint);
	// Extra spanned columns steal Role's remaining width under fixed table layout.
	expect(container.querySelector("th[scope=colgroup]")?.getAttribute("colspan")).toBe(String(columns));
});

it("keeps automatic layout and single-cell rows on phones", () => {
	const { container } = renderList(
		[application({ followUpAt: new Date("2026-10-25T00:00:00.000Z"), followUpNote: LONG_NOTE })],
		"mobile",
	);

	expect(container.querySelector("table")?.className).not.toContain("table-fixed");
	expect(container.querySelector("thead")).toBeNull();
	expect(screen.getByText(`Globex · ${LONG_NOTE}`)).toBeTruthy();
});

const twoApplications = () => [
	application(),
	application({ id: "app-2", role: "Product Designer", company: "Initech", location: "Austin" }),
];

it.each(["desktop", "mobile"] as const)("opens the clicked row's application on %s", (breakpoint) => {
	const onOpen = vi.fn();
	renderList(twoApplications(), breakpoint, onOpen);

	fireEvent.click(screen.getByText("Product Designer").closest("tr") as HTMLElement);

	expect(onOpen).toHaveBeenCalledOnce();
	expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "app-2" }));
});

it.each(["desktop", "mobile"] as const)("opens once from the role button on %s", async (breakpoint) => {
	const onOpen = vi.fn();
	renderList(twoApplications(), breakpoint, onOpen);
	const user = userEvent.setup();
	const button = screen.getByRole("button", { name: /Product Designer/ });

	await user.click(button);
	expect(onOpen).toHaveBeenCalledOnce();
	onOpen.mockClear();
	await user.keyboard("{Enter}");
	expect(onOpen).toHaveBeenCalledOnce();
	onOpen.mockClear();
	await user.keyboard(" ");
	expect(onOpen).toHaveBeenCalledOnce();
	expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "app-2" }));
});

it("selects a row without opening it", () => {
	const onOpen = vi.fn();
	renderList(twoApplications(), "desktop", onOpen);

	const checkbox = screen.getByRole("checkbox", { name: "Select Product Designer at Initech" });
	fireEvent.click(checkbox);
	fireEvent.click(checkbox.closest("td") as HTMLElement);

	expect(onOpen).not.toHaveBeenCalled();
	expect(checkbox.getAttribute("aria-checked")).toBe("true");
});

it.each(["desktop", "mobile"] as const)(
	"does not stretch a click target over the page on %s, since Safari ignores position on table rows",
	(breakpoint) => {
		const { container } = renderList(twoApplications(), breakpoint);

		expect(container.querySelector("[class*='after:absolute']")).toBeNull();
	},
);
it("sorts by role with company as the tiebreak, and by soonest next step with none last", () => {
	const { container } = renderList([
		application({ id: "a", role: "Designer", company: "Zeta", location: null }),
		application({
			id: "b",
			role: "Designer",
			company: "Acme",
			location: null,
			followUpAt: new Date("2099-01-02T00:00:00.000Z"),
		}),
		application({
			id: "c",
			role: "Analyst",
			company: "Mid",
			location: null,
			followUpAt: new Date("2099-01-01T00:00:00.000Z"),
		}),
	]);
	const order = () =>
		Array.from(container.querySelectorAll("tbody td button span:last-child"), (span) => span.textContent);

	fireEvent.click(screen.getByRole("button", { name: "Role" }));
	expect(order()).toEqual(["Mid", "Acme", "Zeta"]);

	fireEvent.click(screen.getByRole("button", { name: "Next step" }));
	expect(order()).toEqual(["Mid", "Acme", "Zeta"]);
	fireEvent.click(screen.getByRole("button", { name: "Next step" }));
	expect(order()).toEqual(["Zeta", "Acme", "Mid"]);
});

it("orders a stage by its own stage dates, longest wait first, when every row was imported at once", () => {
	const importedAt = new Date("2026-10-19T00:00:00.000Z");
	const appliedDaysAgo = (id: string, company: string, days: number) =>
		application({
			id,
			company,
			location: null,
			updatedAt: importedAt,
			appliedAt: new Date(Date.now() - days * 86_400_000),
			activity: [{ id: `${id}-stage`, type: "stage", stage: "applied", at: new Date(Date.now() - days * 86_400_000) }],
		});
	const { container } = renderList([
		appliedDaysAgo("a", "Niantic", 9),
		appliedDaysAgo("b", "Bethesda", 35),
		appliedDaysAgo("c", "Sucker Punch", 21),
	]);
	const order = Array.from(container.querySelectorAll("tbody td button span:last-child"), (span) => span.textContent);

	expect(order).toEqual(["Bethesda", "Sucker Punch", "Niantic"]);
	expect(header(container, "Next step").getAttribute("aria-sort")).toBe("ascending");
});
