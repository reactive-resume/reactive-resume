// @vitest-environment happy-dom
import type { Application } from "../types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@reactive-resume/ui/components/toast";
import { prepareRequest } from "@reactive-resume/utils/deferred-request";
import { pendingCommits } from "@/features/career/pending-commits";
import { invalidateAccountScope, setAccountScope } from "@/libs/auth/account-scope";

const api = vi.hoisted(() => ({ add: vi.fn(), update: vi.fn(), remove: vi.fn(), read: vi.fn(), prepare: vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({
	client: { applications: { deleteTimelineEntry: api.remove } },
	prepareRpc: api.prepare,
	orpc: {
		applications: {
			key: () => ["applications"],
			addInterview: { mutationOptions: (options: object) => ({ mutationFn: api.add, ...options }) },
			updateInterview: { mutationOptions: (options: object) => ({ mutationFn: api.update, ...options }) },
			deleteTimelineEntry: { mutationOptions: (options: object) => ({ mutationFn: api.remove, ...options }) },
			getById: { queryKey: () => ["application"] },
		},
		career: { schedules: { queryOptions: () => ({ queryKey: ["schedules"], queryFn: async () => [] }) } },
	},
}));
vi.mock("../queries", () => ({ applicationsListQueryKey: () => ["applications"] }));
vi.mock("@tanstack/react-router", () => ({
	useRouteContext: () => ({ session: { user: { id: "interview-test", timezone: "Europe/Berlin" } } }),
}));

import { InterviewDialog } from "./interview-dialog";

const interview: InterviewTimelineEntry = {
	id: "original-round",
	type: "interview",
	at: new Date("2027-03-27T10:00:00Z"),
	kind: "technical",
	durationMinutes: 60,
	location: "Office",
	notes: "Original preparation notes",
	participants: [],
	audience: "hiring-manager",
	timezone: "Europe/Berlin",
};
const application: Application = {
	id: "application",
	company: "Example Co",
	role: "Engineer",
	status: "interview",
	closedReason: null,
	coverLetterId: null,
	sentResumeVersionId: null,
	sentCoverLetterVersionId: null,
	sentCheckScore: null,
	requirements: [],
	location: null,
	salary: null,
	source: null,
	sourceUrl: null,
	notes: null,
	tags: [],
	contacts: [],
	activity: [interview],
	appliedAt: new Date(),
	createdAt: new Date(),
	updatedAt: new Date(),
	resumeId: null,
	jobDescription: null,
	postingSource: null,
	matchScore: null,
	aiMetadata: null,
	resumeFileUrl: null,
	resumeFileName: null,
	coverLetterUrl: null,
	coverLetterName: null,
	followUpAt: null,
	followUpNote: null,
};
const clients: QueryClient[] = [];
function Harness({ editing }: { editing: boolean }) {
	const [open, setOpen] = useState(true);
	const { data: loaded } = useQuery<Application>({
		queryKey: ["application"],
		queryFn: async () => (await api.read())[0],
	});
	return (
		<>
			<output aria-label="Saved round identity">
				{loaded?.activity.map((entry) => entry.id).join(",") ?? "Loading"}
			</output>
			<InterviewDialog
				open={open}
				onOpenChange={setOpen}
				application={application}
				interview={editing ? interview : null}
			/>
		</>
	);
}
function mount(editing: boolean) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	clients.push(client);
	return render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<Toaster>
					<Harness editing={editing} />
				</Toaster>
			</I18nProvider>
		</QueryClientProvider>,
	);
}
beforeEach(() => {
	vi.clearAllMocks();
	setAccountScope("interview-test");
	api.prepare.mockImplementation((procedure: (input: unknown) => Promise<unknown>, input: unknown) =>
		prepareRequest(async (defer) => {
			let saved: unknown;
			await defer(async () => {
				saved = await procedure(input);
				return new Response();
			});
			return saved;
		}),
	);
	api.read.mockResolvedValue([application]);
	api.add.mockResolvedValue(application);
	api.update.mockResolvedValue(application);
	api.remove.mockResolvedValue(application);
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});
afterEach(() => {
	invalidateAccountScope();
	for (const flush of pendingCommits) flush();
	pendingCommits.clear();
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
});

it.each([false, true])(
	"rejects nonexistent Berlin DST time before sending an interview mutation (editing: %s)",
	async (editing) => {
		mount(editing);
		fireEvent.change(await screen.findByLabelText("Date"), { target: { value: "2027-03-28" } });
		const time = screen.getByLabelText("Time · Europe/Berlin");
		fireEvent.change(time, { target: { value: "02:30" } });
		expect((await screen.findByRole("alert")).textContent).toContain(
			"This time does not exist in the selected timezone",
		);
		expect(time.getAttribute("aria-invalid")).toBe("true");
		const save = screen.getByRole("button", { name: "Save interview" }) as HTMLButtonElement;
		expect(save.disabled).toBe(true);
		fireEvent.click(save);
		expect(api.add).not.toHaveBeenCalled();
		expect(api.update).not.toHaveBeenCalled();
	},
);

it("Delete then Undo restores the existing round without deleting or recreating its identity", async () => {
	mount(true);
	await waitFor(() => expect(api.read).toHaveBeenCalled());
	fireEvent.click(await screen.findByRole("button", { name: /^Delete$/ }));
	const undo = await screen.findByRole("button", { name: "Undo" });
	expect(api.remove).not.toHaveBeenCalled();
	fireEvent.click(undo);
	await waitFor(() => expect(screen.getByLabelText("Saved round identity").textContent).toBe("original-round"));
	await waitFor(() => expect(api.read.mock.calls.length).toBeGreaterThan(1));
	expect(api.remove).not.toHaveBeenCalled();
	expect(api.add).not.toHaveBeenCalled();
	expect(api.update).not.toHaveBeenCalled();
});

it("offers Update your calendar only after a successful reschedule", async () => {
	mount(true);
	fireEvent.change(await screen.findByLabelText("Time · Europe/Berlin"), { target: { value: "13:00" } });
	fireEvent.click(screen.getByRole("button", { name: "Save interview" }));
	expect(await screen.findByRole("button", { name: "Update your calendar" })).toBeVisible();
	expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ entryId: "original-round" }), expect.anything());
});

it("late deletion preparation cannot close a departed interview editor", async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	clients.push(client);
	client.setQueryData(["applications"], [application]);
	let release!: (request: Awaited<ReturnType<typeof prepareRequest>>) => void;
	const held = new Promise<Awaited<ReturnType<typeof prepareRequest>>>((resolve) => {
		release = resolve;
	});
	api.prepare.mockReturnValueOnce(held);
	const changed = vi.fn();
	const view = render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<Toaster>
					<InterviewDialog open onOpenChange={changed} application={application} interview={interview} />
				</Toaster>
			</I18nProvider>
		</QueryClientProvider>,
	);
	fireEvent.click(await screen.findByRole("button", { name: /^Delete$/ }));
	await waitFor(() => expect(api.prepare).toHaveBeenCalled());
	view.unmount();
	release(await prepareRequest((defer) => defer(() => Promise.resolve(new Response()))));
	await held;
	await waitFor(() => expect(client.getQueryData<Application[]>(["applications"])?.[0]?.activity).toEqual([]));
	expect(changed).not.toHaveBeenCalled();
	expect(api.remove).not.toHaveBeenCalled();
});
