import type { Application } from "../types";
// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApplicationList } from "./list-view";

const mocks = vi.hoisted(() => ({
	breakpoint: "desktop",
	timeZone: "UTC",
	invalidate: vi.fn(),
	moveWithUndo: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	useRouteContext: () => ({ session: { user: { timezone: mocks.timeZone } } }),
}));
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
		career: { savedItems: { queryOptions: () => ({ queryKey: ["offers"], queryFn: async () => [] }) } },
	},
}));
vi.mock("../use-application-actions", () => ({
	useInvalidateApplications: () => mocks.invalidate,
	useMoveWithUndo: () => mocks.moveWithUndo,
}));
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

it("reorders Next step when an interview ends without any application update", () => {
	vi.useFakeTimers();
	const now = new Date("2030-01-03T12:00:00Z");
	vi.setSystemTime(now);
	try {
		const { container, unmount } = renderList([
			application({
				id: "interview",
				company: "Interview",
				location: null,
				activity: [
					{
						id: "interview",
						type: "interview",
						at: new Date(now.getTime() - 270_000),
						durationMinutes: 5,
					} as Application["activity"][number],
				],
			}),
			application({
				id: "followup",
				company: "Follow-up",
				location: null,
				followUpAt: new Date(now.getTime() + 300_000),
				followUpDateOnly: false,
			}),
		]);
		const order = () =>
			Array.from(container.querySelectorAll("tbody td button span:last-child"), (span) => span.textContent);
		expect(order()).toEqual(["Interview", "Follow-up"]);
		act(() => vi.advanceTimersByTime(60_000));
		expect(order()).toEqual(["Follow-up", "Interview"]);
		unmount();
	} finally {
		vi.useRealTimers();
	}
});

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
	// The company is isolated in its own direction; the next step after it is interface text.
	const meta = screen.getByText("Globex", { selector: "bdi" }).parentElement;
	expect(meta?.textContent).toBe(`Globex · ${LONG_NOTE}`);
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

it("moves and closes the checked rows with Undo instead of writing at once (J2-18)", async () => {
	mocks.moveWithUndo.mockClear();
	renderList(twoApplications());
	fireEvent.click(screen.getByRole("checkbox", { name: "Select Product Designer at Initech" }));

	await userEvent.click(screen.getByRole("button", { name: "Move to…" }));
	await userEvent.click(await screen.findByRole("menuitem", { name: "Interview" }));
	expect(mocks.moveWithUndo).toHaveBeenLastCalledWith(
		expect.objectContaining({
			applications: [{ id: "app-2" }],
			lane: expect.objectContaining({ category: "interview" }),
			description: "1 application moved to Interview",
		}),
	);

	fireEvent.click(screen.getByRole("checkbox", { name: "Select Product Designer at Initech" }));
	await userEvent.click(screen.getByRole("button", { name: "Close…" }));
	await userEvent.click(await screen.findByRole("menuitem", { name: "Accepted another offer" }));
	expect(mocks.moveWithUndo).toHaveBeenLastCalledWith(
		expect.objectContaining({
			applications: [{ id: "app-2" }],
			lane: expect.objectContaining({ category: "closed" }),
			closedReason: "accepted-other",
		}),
	);
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

it("sorts legacy date-only follow-ups by their account-clock delivery time", () => {
	mocks.timeZone = "Pacific/Honolulu";
	try {
		const { container } = renderList([
			application({
				id: "legacy",
				location: null,
				company: "Legacy",
				followUpAt: new Date("2030-01-03T00:00:00Z"),
				followUpDateOnly: true,
			}),
			application({
				id: "exact",
				location: null,
				company: "Exact",
				followUpAt: new Date("2030-01-03T12:00:00Z"),
				followUpDateOnly: false,
			}),
		]);
		expect(header(container, "Next step").getAttribute("aria-sort")).toBe("ascending");
		expect(
			Array.from(container.querySelectorAll("tbody td button span:last-child"), (span) => span.textContent),
		).toEqual(["Exact", "Legacy"]);
	} finally {
		mocks.timeZone = "UTC";
	}
});
