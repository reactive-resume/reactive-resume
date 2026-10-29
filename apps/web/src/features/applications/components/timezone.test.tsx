// @vitest-environment happy-dom
import type { Application } from "../types";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createDefaultApplicationLanes } from "@reactive-resume/schema/applications/lanes";

const account = vi.hoisted(() => ({ timeZone: "UTC", saveInterview: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
	useRouteContext: () => ({ session: { user: { timezone: account.timeZone } } }),
}));
vi.mock("./interview-dialog", () => ({
	InterviewDialog: ({ day }: { day: string | null }) => <output data-testid="scheduled-day">{day}</output>,
}));
vi.mock("../use-application-actions", () => ({ useInvalidateApplications: () => vi.fn() }));
vi.mock("../use-application-lanes", () => ({
	useApplicationLanes: () => ({ lanes: createDefaultApplicationLanes() }),
}));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: {
			listSummary: { queryKey: () => ["applications"] },
			getById: { queryKey: () => ["application"] },
			addInterview: { mutationOptions: () => ({ mutationFn: account.saveInterview }) },
			updateInterview: { mutationOptions: () => ({ mutationFn: account.saveInterview }) },
			addNote: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			updateTimelineEntry: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			deleteTimelineEntry: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			update: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
		},
		career: { schedules: { queryOptions: () => ({ queryKey: ["schedules"], queryFn: () => [] }) } },
	},
}));

import { ApplicationCalendar } from "./calendar-view";
import { Activity } from "./detail/activity";
import { NextStepCard } from "./detail/next-step-card";

function application(at: string): Application {
	return {
		id: "application",
		company: "Northstar",
		role: "Engineer",
		status: "interview",
		closedReason: null,
		followUpAt: null,
		followUpNote: null,
		appliedAt: new Date("2026-10-01T12:00:00Z"),
		activity: [
			{
				id: "interview",
				type: "interview",
				at: new Date(at),
				kind: "technical",
				durationMinutes: 60,
				timezone: "UTC",
				location: "",
				notes: "",
				participants: [],
				audience: "other",
			},
			{ id: "stage", type: "stage", at: new Date("2026-10-01T12:00:00Z"), stage: "interview" },
			{ id: "note", type: "note", at: new Date("2026-10-01T12:00:00Z"), text: "Sent portfolio" },
		],
	} as Application;
}

function show(children: ReactNode) {
	const client = new QueryClient();
	return render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		</I18nProvider>,
	);
}

beforeEach(() => {
	i18n.load("en-GB", {});
	i18n.activate("en-GB");
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-30T08:00:00Z"));
});
afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

it.each([
	["UTC", "09:00"],
	["Europe/Berlin", "10:00"],
])("shows the %s clock in Next step, Activity and Calendar", (timeZone, time) => {
	account.timeZone = timeZone;
	const row = application("2026-10-30T09:00:00Z");
	const { container } = show(
		<>
			<NextStepCard application={row} onScheduleInterview={vi.fn()} />
			<Activity application={row} onOpenInterview={vi.fn()} />
			<ApplicationCalendar applications={[row]} allApplications={[row]} onOpen={vi.fn()} />
		</>,
	);
	expect(container.querySelector("#application-next-step")?.parentElement?.textContent).toContain(time);
	expect(container.querySelector("#application-activity")?.parentElement?.textContent).toContain(time);
	expect(container.querySelector('[data-day="2026-10-30"]')?.textContent).toContain(time);
	expect(container.querySelector("[data-upcoming-interview]")?.textContent).toContain(time);
});

it("keeps stage and note dates as UTC whole days even east of the date boundary", () => {
	account.timeZone = "Pacific/Kiritimati";
	show(<Activity application={application("2026-10-30T09:00:00Z")} onOpenInterview={vi.fn()} />);
	expect(screen.getAllByText("1 Oct")).toHaveLength(2);
});

it.each([
	["UTC", "October 2026", "2026-10-31"],
	["Europe/Berlin", "November 2026", "2026-11-01"],
])("uses %s for the current month, count, day and upcoming heading", (timeZone, month, day) => {
	account.timeZone = timeZone;
	vi.setSystemTime(new Date("2026-10-31T23:15:00Z"));
	const row = application("2026-10-31T23:30:00Z");
	const { container } = show(<ApplicationCalendar applications={[row]} allApplications={[row]} onOpen={vi.fn()} />);
	expect(screen.getByRole("heading", { name: month })).toBeDefined();
	expect(screen.getByText("1 interview")).toBeDefined();
	expect(screen.getByRole("heading", { name: "Today" })).toBeDefined();
	const cell = container.querySelector(`[data-day="${day}"]`);
	expect(cell?.textContent).toContain("Northstar");
	if (!cell) throw new Error("Missing account calendar day");
	fireEvent.click(within(cell as HTMLElement).getByRole("button", { name: /Schedule an interview on/ }));
	expect(screen.getByTestId("scheduled-day").textContent).toBe(day);
});

it("labels tomorrow using the next civil day across the spring DST jump", () => {
	account.timeZone = "Europe/Berlin";
	vi.setSystemTime(new Date("2026-03-28T23:15:00Z"));
	const row = application("2026-03-29T22:30:00Z");
	const { container } = show(<ApplicationCalendar applications={[row]} allApplications={[row]} onOpen={vi.fn()} />);
	expect(screen.getByRole("heading", { name: "Tomorrow" })).toBeDefined();
	expect(container.querySelector('[data-day="2026-03-30"]')?.textContent).toContain("00:30");
});

it("keeps an edited interview's exact instant during the repeated DST hour", async () => {
	account.timeZone = "UTC";
	account.saveInterview.mockResolvedValue(undefined);
	const { InterviewDialog } = await vi.importActual<typeof import("./interview-dialog")>("./interview-dialog");
	const row = application("2026-10-25T01:30:00Z");
	const interview = row.activity.find((entry) => entry.type === "interview");
	if (!interview) throw new Error("Missing interview");
	interview.timezone = "Europe/Berlin";
	show(<InterviewDialog open application={row} interview={interview} onOpenChange={vi.fn()} />);
	expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-10-25");
	expect((screen.getByLabelText("Time · Europe/Berlin") as HTMLInputElement).value).toBe("02:30");
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Save interview" }));
	});
	expect(account.saveInterview).toHaveBeenCalledWith(
		expect.objectContaining({
			at: "2026-10-25T01:30:00.000Z",
			timezone: "Europe/Berlin",
			entryId: "interview",
		}),
		expect.anything(),
	);
});
