import type { Application } from "../types";
import type { ComponentProps } from "react";
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
	trashWithUndo: vi.fn(),
	logFollowUp: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
	useRouteContext: () => ({ session: { user: { timezone: mocks.timeZone } } }),
	Link: ({
		to,
		params,
		children,
		...props
	}: ComponentProps<"a"> & { to: string; params: { applicationId: string } }) => (
		<a href={to.replace("$applicationId", params.applicationId).replace("/{-$tab}", "")} {...props}>
			{children}
		</a>
	),
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
	useTrashWithUndo: () => mocks.trashWithUndo,
	useApplicationActions: () => ({
		logFollowUp: { isPending: false, mutate: mocks.logFollowUp },
		moveTo: vi.fn(),
		close: vi.fn(),
		remove: { mutate: vi.fn() },
	}),
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
		createdAt: new Date("2026-10-01T00:00:00.000Z"),
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

function renderList(applications: Application[], breakpoint = "desktop", onTagSelect = vi.fn(), showClosed = true) {
	mocks.breakpoint = breakpoint;
	i18n.load("en", {});
	i18n.activate("en");
	const client = new QueryClient();
	client.setQueryData(["lanes"], { lanes: createDefaultApplicationLanes(), revision: 1 });
	const tree = (rows: Application[]) => (
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<ApplicationList applications={rows} showClosed={showClosed} onTagSelect={onTagSelect} />
			</I18nProvider>
		</QueryClientProvider>
	);
	const view = render(tree(applications));
	return { ...view, update: (rows: Application[]) => view.rerender(tree(rows)) };
}

const header = (container: HTMLElement, label: string) =>
	Array.from(container.querySelectorAll("thead th")).find((th) => th.textContent === label) as HTMLElement;
/** Records every link the user follows, wherever it is in the page, instead of navigating. */
function observeOpens() {
	const opened: (string | null)[] = [];
	const record = (event: MouseEvent) => {
		const link = (event.target as Element).closest("a");
		if (!link) return;
		event.preventDefault();
		opened.push(link.getAttribute("href"));
	};
	document.addEventListener("click", record);
	return { opened, stop: () => document.removeEventListener("click", record) };
}
/** Companies, in the order the rows are drawn. */
const order = (container: HTMLElement) =>
	Array.from(container.querySelectorAll("[data-application-open]"), (link) => link.textContent);

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
						kind: "technical",
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
		expect(order(container)).toEqual(["Interview", "Follow-up"]);
		act(() => vi.advanceTimersByTime(60_000));
		expect(order(container)).toEqual(["Follow-up", "Interview"]);
		unmount();
	} finally {
		vi.useRealTimers();
	}
});

const twoApplications = () => [
	application(),
	application({ id: "app-2", role: "Product Designer", company: "Initech", location: "Austin" }),
];

it.each(["desktop", "mobile"] as const)(
	"opens each row's own application once per click or Enter on %s",
	async (breakpoint) => {
		const user = userEvent.setup();
		renderList(twoApplications(), breakpoint);
		const initech = screen.getByRole("link", { name: "Initech" });
		const globex = screen.getByRole("link", { name: "Globex" });
		expect(initech).toHaveAttribute("href", "/dashboard/applications/app-2");
		expect(globex).toHaveAttribute("href", "/dashboard/applications/app-1");

		const { opened, stop } = observeOpens();
		try {
			await user.click(initech);
			expect(opened).toEqual(["/dashboard/applications/app-2"]);
			globex.focus();
			await user.keyboard("{Enter}");
			expect(opened).toEqual(["/dashboard/applications/app-2", "/dashboard/applications/app-1"]);
		} finally {
			stop();
		}
	},
);

it("runs one flat table by next step whatever the stage, with closed applications under their own heading", () => {
	const rows = [
		application({ id: "a", company: "Saved Co", status: "saved" }),
		application({ id: "b", company: "Closed Co", status: "closed", closedReason: "not-selected" }),
		application({
			id: "c",
			company: "Dated Co",
			status: "interview",
			followUpAt: new Date("2099-01-01T00:00:00.000Z"),
		}),
	];
	const { container, unmount } = renderList(rows);
	// The dated step first, then the wait; the closed one last, after its heading.
	expect(order(container)).toEqual(["Dated Co", "Saved Co", "Closed Co"]);
	expect(screen.getByRole("rowheader", { name: "Closed 1" })).toBeTruthy();
	expect(screen.getAllByText("Not selected")).toHaveLength(1);
	unmount();

	const hidden = renderList(rows, "desktop", vi.fn(), false);
	expect(order(hidden.container)).toEqual(["Dated Co", "Saved Co"]);
	expect(screen.queryByRole("rowheader", { name: "Closed 1" })).toBeNull();
});

it("writes what was sent in words and marks only owed steps as Needs you", () => {
	const sent = new Date(Date.now() - 20 * 86_400_000);
	renderList([
		application({
			id: "owed",
			company: "Owed Co",
			resumeId: "resume",
			coverLetterId: "letter",
			appliedAt: sent,
			activity: [{ id: "s", type: "stage", stage: "applied", at: sent }] as Application["activity"],
		}),
		application({ id: "saved", company: "Saved Co", status: "saved" }),
	]);

	expect(screen.getByText(/^Resume, letter · /)).toBeTruthy();
	expect(screen.getByText("Not sent")).toBeTruthy();
	expect(screen.getByText("Send a follow-up")).toBeTruthy();
	expect(screen.getAllByText("Needs you")).toHaveLength(1);
});

it("selects a row without opening it", () => {
	renderList(twoApplications());
	const { opened, stop } = observeOpens();
	try {
		const checkbox = screen.getByRole("checkbox", { name: "Select Product Designer at Initech" });
		fireEvent.click(checkbox);
		expect(checkbox.getAttribute("aria-checked")).toBe("true");
		// The cell around the checkbox is part of its hit area, not the row's link.
		const cell = checkbox.closest("td, th");
		if (!cell) throw new Error("Missing selection cell");
		fireEvent.click(cell);
		expect(opened).toEqual([]);
	} finally {
		stop();
	}
});

it("passes a tag chip selection to onTagSelect without opening the row", () => {
	const onTagSelect = vi.fn();
	renderList([application({ tags: ["remote", "design"] })], "desktop", onTagSelect);
	const { opened, stop } = observeOpens();
	try {
		fireEvent.click(screen.getByRole("button", { name: "Filter by remote" }));
		expect(onTagSelect).toHaveBeenCalledExactlyOnceWith("remote");
		expect(opened).toEqual([]);
	} finally {
		stop();
	}
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

it("sorts by company with role as the tiebreak, and by soonest next step with none last", () => {
	const { container } = renderList([
		application({ id: "a", company: "Mid", role: "Zebra keeper", location: null }),
		application({
			id: "b",
			company: "Mid",
			role: "Analyst",
			location: null,
			followUpAt: new Date("2099-01-02T00:00:00.000Z"),
		}),
		application({
			id: "c",
			company: "Acme",
			role: "Designer",
			location: null,
			followUpAt: new Date("2099-01-01T00:00:00.000Z"),
		}),
	]);
	const ids = () =>
		Array.from(container.querySelectorAll("tbody [data-application-id]"), (row) =>
			row.getAttribute("data-application-id"),
		);

	fireEvent.click(screen.getByRole("button", { name: "Application" }));
	expect(ids()).toEqual(["c", "b", "a"]);
	expect(header(container, "Application").getAttribute("aria-sort")).toBe("ascending");

	fireEvent.click(screen.getByRole("button", { name: "Next step" }));
	expect(ids()).toEqual(["c", "b", "a"]);
	fireEvent.click(screen.getByRole("button", { name: "Next step" }));
	expect(ids()).toEqual(["a", "b", "c"]);
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

it("moves the checked rows to Trash at once, without asking, and clears the selection", () => {
	mocks.trashWithUndo.mockClear();
	renderList(twoApplications());
	fireEvent.click(screen.getByRole("checkbox", { name: "Select all visible applications" }));

	fireEvent.click(screen.getByRole("button", { name: "Move to Trash" }));

	expect(mocks.trashWithUndo).toHaveBeenCalledExactlyOnceWith([{ id: "app-1" }, { id: "app-2" }]);
	expect(screen.queryByRole("alertdialog")).toBeNull();
	expect(screen.queryByText("2 selected")).toBeNull();
});

it("orders by each row's own stage date, longest wait first, when every row was imported at once", () => {
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

	expect(order(container)).toEqual(["Bethesda", "Sucker Punch", "Niantic"]);
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
		expect(order(container)).toEqual(["Exact", "Legacy"]);
	} finally {
		mocks.timeZone = "UTC";
	}
});

it("triages only focused rows in displayed order, preserving focus across stage moves and hiding", async () => {
	mocks.moveWithUndo.mockClear();
	mocks.logFollowUp.mockClear();
	const user = userEvent.setup();
	// Beta's dated step puts it first.
	const first = application({ id: "a", company: "Alpha", status: "applied" });
	const second = application({
		id: "b",
		company: "Beta",
		status: "interview",
		followUpAt: new Date("2099-01-01T00:00:00.000Z"),
	});
	const view = renderList([first, second]);
	const alpha = () => screen.getByRole("link", { name: "Alpha" });
	const beta = () => screen.getByRole("link", { name: "Beta" });
	const opens = observeOpens();
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
	expect(screen.getByRole("checkbox", { name: "Select Senior Frontend Engineer at Beta" })).toHaveAttribute(
		"aria-checked",
		"true",
	);
	await user.keyboard("2");
	expect(mocks.moveWithUndo).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ applications: [second], lane: expect.objectContaining({ systemKey: "applied" }) }),
	);
	view.update([first, { ...second, status: "applied" }]);
	expect(beta()).toHaveFocus();
	await user.keyboard("f");
	expect(mocks.logFollowUp).toHaveBeenCalledExactlyOnceWith({ id: "b" });
	await user.keyboard("{Enter}");
	opens.stop();
	// Enter after the reorder and stage change opens Beta, the focused row, and only it.
	expect(opens.opened).toEqual(["/dashboard/applications/b"]);
	view.update([first]);
	await user.keyboard("1");
	expect(mocks.moveWithUndo).toHaveBeenCalledTimes(1);
});

it("ignores repeated, composing and modified row commands and follows changed sorting", async () => {
	mocks.moveWithUndo.mockClear();
	mocks.logFollowUp.mockClear();
	const user = userEvent.setup();
	renderList([
		application({ id: "a", company: "Alpha" }),
		application({ id: "b", company: "Beta" }),
		application({ id: "c", company: "Gamma", status: "saved" }),
	]);
	await user.click(screen.getByRole("button", { name: "Application" }));
	const alpha = screen.getByRole("link", { name: "Alpha" });
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
	expect(screen.getByRole("link", { name: "Beta" })).toHaveFocus();
	await user.click(screen.getByRole("button", { name: "Application" }));
	alpha.focus();
	await user.keyboard("k");
	expect(screen.getByRole("link", { name: "Beta" })).toHaveFocus();
	fireEvent.keyDown(screen.getByRole("link", { name: "Beta" }), { key: "f", repeat: true });
	expect(mocks.logFollowUp).not.toHaveBeenCalled();
});
