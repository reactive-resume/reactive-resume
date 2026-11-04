import type { Application } from "../types";
// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createDefaultApplicationLanes } from "@reactive-resume/schema/applications/lanes";
import { ApplicationList } from "./list-view";

const mocks = vi.hoisted(() => ({
	breakpoint: "desktop",
	timeZone: "UTC",
	invalidate: vi.fn(),
	moveWithUndo: vi.fn(),
	logFollowUp: vi.fn(),
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
			bulkTrash: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
		},
		career: { savedItems: { queryOptions: () => ({ queryKey: ["offers"], queryFn: async () => [] }) } },
	},
}));
vi.mock("../use-application-actions", () => ({
	useInvalidateApplications: () => mocks.invalidate,
	useMoveWithUndo: () => mocks.moveWithUndo,
	useApplicationActions: () => ({ logFollowUp: { isPending: false, mutate: mocks.logFollowUp } }),
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({ useBreakpoint: () => mocks.breakpoint }));

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

function renderList(applications: Application[], breakpoint = "desktop", onOpen = vi.fn(), onTagSelect = vi.fn()) {
	mocks.breakpoint = breakpoint;
	i18n.load("en", {});
	i18n.activate("en");
	const client = new QueryClient();
	client.setQueryData(["lanes"], { lanes: createDefaultApplicationLanes(), revision: 1 });
	const tree = (rows: Application[]) => (
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<ApplicationList applications={rows} showClosed selectedId={null} onOpen={onOpen} onTagSelect={onTagSelect} />
			</I18nProvider>
		</QueryClientProvider>
	);
	const view = render(tree(applications));
	return { ...view, update: (rows: Application[]) => view.rerender(tree(rows)) };
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

it("passes a tag chip selection to onTagSelect without opening the row", () => {
	const onOpen = vi.fn();
	const onTagSelect = vi.fn();
	renderList([application({ tags: ["remote", "design"] })], "desktop", onOpen, onTagSelect);

	fireEvent.click(screen.getByRole("button", { name: "Filter by remote" }));

	expect(onTagSelect).toHaveBeenCalledExactlyOnceWith("remote");
	expect(onOpen).not.toHaveBeenCalled();
});

it("selects the visible rows from the header and shows an indeterminate state for a partial selection", () => {
	renderList(twoApplications());
	const all = screen.getByRole("checkbox", { name: "Select all visible applications" });
	const product = screen.getByRole("checkbox", { name: "Select Product Designer at Initech" });

	fireEvent.click(product);
	expect(all).toHaveAttribute("aria-checked", "mixed");

	fireEvent.click(all);
	expect(all).toHaveAttribute("aria-checked", "true");
	expect(product).toHaveAttribute("aria-checked", "true");
	expect(screen.getByText("2 selected")).toBeTruthy();

	fireEvent.click(all);
	expect(all).toHaveAttribute("aria-checked", "false");
	expect(product).toHaveAttribute("aria-checked", "false");
	expect(screen.queryByText("2 selected")).toBeNull();
});

it("leaves collapsed groups out of the header selection", () => {
	renderList([
		application({ id: "app-1", role: "Alpha" }),
		application({ id: "app-2", role: "Beta", status: "interview" }),
	]);

	fireEvent.click(screen.getByRole("button", { name: "Interview 1" }));
	fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible applications" }));
	fireEvent.click(screen.getByRole("button", { name: "Interview 1" }));

	expect(screen.getByRole("checkbox", { name: "Select Alpha at Globex" })).toHaveAttribute("aria-checked", "true");
	expect(screen.getByRole("checkbox", { name: "Select Beta at Globex" })).toHaveAttribute("aria-checked", "false");
});

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

it("triages only focused rows in displayed order, preserving identity across lane moves and hiding", async () => {
	mocks.moveWithUndo.mockClear();
	mocks.logFollowUp.mockClear();
	const user = userEvent.setup();
	const onOpen = vi.fn();
	const first = application({ id: "a", role: "Alpha", status: "applied" });
	const second = application({ id: "b", role: "Beta", status: "interview" });
	const rows = [first, second];
	const view = renderList(rows, "desktop", onOpen);
	const alpha = () => screen.getByRole("button", { name: /Alpha/ });
	const beta = () => screen.getByRole("button", { name: /Beta/ });
	await user.keyboard("x");
	expect(screen.queryByText("1 selected")).toBeNull();
	beta().focus();
	await user.keyboard("j");
	expect(alpha()).toHaveFocus();
	await user.keyboard("j");
	expect(alpha()).toHaveFocus();
	await user.keyboard("k");
	expect(beta()).toHaveFocus();
	await user.keyboard("x");
	expect(screen.getByRole("checkbox", { name: "Select Beta at Globex" })).toHaveAttribute("aria-checked", "true");
	await user.keyboard("2");
	expect(mocks.moveWithUndo).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ applications: [second], lane: expect.objectContaining({ systemKey: "applied" }) }),
	);
	view.update([first, { ...second, status: "applied" }]);
	expect(beta()).toHaveFocus();
	await user.keyboard("f");
	expect(mocks.logFollowUp).toHaveBeenCalledExactlyOnceWith({ id: "b" });
	await user.keyboard("{Enter}");
	expect(onOpen).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "b" }));
	view.update([first]);
	await user.keyboard("1");
	expect(mocks.moveWithUndo).toHaveBeenCalledTimes(1);
});

it("ignores repeated, composing and modified row commands and follows changed sorting/collapses", async () => {
	mocks.moveWithUndo.mockClear();
	mocks.logFollowUp.mockClear();
	const user = userEvent.setup();
	renderList([
		application({ id: "a", role: "Alpha" }),
		application({ id: "b", role: "Beta" }),
		application({ id: "c", role: "Gamma", status: "saved" }),
	]);
	await user.click(screen.getByRole("button", { name: "Role" }));
	const alpha = screen.getByRole("button", { name: /Alpha/ });
	alpha.focus();
	for (const extra of [
		{ repeat: true },
		{ isComposing: true },
		{ keyCode: 229 },
		{ ctrlKey: true },
		{ altKey: true },
		{ metaKey: true },
		{ shiftKey: true },
	]) {
		fireEvent.keyDown(alpha, { key: "4", code: "Digit4", ...extra });
		fireEvent.keyUp(alpha, { key: "4", code: "Digit4", ...extra });
	}
	expect(mocks.moveWithUndo).not.toHaveBeenCalled();
	await user.keyboard("j");
	expect(screen.getByRole("button", { name: /Beta/ })).toHaveFocus();
	await user.click(screen.getByRole("button", { name: "Saved 1" }));
	alpha.focus();
	await user.keyboard("jj");
	expect(screen.getByRole("button", { name: /Beta/ })).toHaveFocus();
	fireEvent.keyDown(screen.getByRole("button", { name: /Beta/ }), { key: "f", repeat: true });
	expect(mocks.logFollowUp).not.toHaveBeenCalled();
});
