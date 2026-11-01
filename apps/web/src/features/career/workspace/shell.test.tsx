// @vitest-environment happy-dom
import type { SavedItem } from "../hooks";
import type { Application } from "@/features/applications/types";
import type { CareerWorkspace } from "@reactive-resume/schema/career";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EMPTY_WORKSPACE } from "@reactive-resume/schema/career";
import { Workspace } from "./shell";

const api = vi.hoisted(() => ({
	saved: vi.fn(),
	workspace: vi.fn(),
	documents: vi.fn(),
	save: vi.fn(),
	navigate: vi.fn(),
	timeZone: "UTC",
}));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: string, queryFn = async (): Promise<unknown> => [], mutationFn = vi.fn()) => ({
		key: () => [name],
		queryKey: () => [name],
		queryOptions: () => ({ queryKey: [name], queryFn, staleTime: Infinity }),
		mutationOptions: () => ({ mutationFn }),
	});
	return {
		orpc: {
			applications: {
				update: endpoint("updateApplication"),
				getById: endpoint("application"),
				lanes: { get: endpoint("lanes", () => new Promise(() => {})) },
			},
			documents: { list: endpoint("documents", api.documents) },
			coverLetters: { create: endpoint("createLetter") },
			career: {
				answers: {
					list: endpoint("reviewedAnswers"),
					save: endpoint("saveAnswer"),
					reuse: endpoint("reuseAnswer"),
					delete: endpoint("deleteAnswer"),
				},
				stories: endpoint("stories"),
				workspace: endpoint("workspace", api.workspace),
				savedItems: endpoint("saved", api.saved),
				facts: endpoint("facts"),
				saveWorkspace: endpoint("save", undefined, api.save),
				submitApplication: endpoint("submit"),
				generate: endpoint("generate"),
			},
		},
	};
});
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => api.navigate,
	useRouteContext: () => ({ session: { user: { id: "shell-user", timezone: api.timeZone } } }),
	useRouter: () => ({ state: { location: { state: { __TSR_index: 0 } } } }),
	Link: ({ children }: { children: ReactNode }) => <a href="#test-link">{children}</a>,
}));
vi.mock("@reactive-resume/ui/hooks/use-breakpoint", () => ({ useBreakpoint: () => "desktop" }));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({ usableProviders: [], isLoading: false }),
}));
vi.mock("@/features/applications/use-application-actions", () => ({ useInvalidateApplications: () => vi.fn() }));
vi.mock("@/features/applications/components/application-notes", () => ({ ApplicationNotes: () => null }));
vi.mock("@/features/applications/components/interview-dialog", () => ({ InterviewDialog: () => null }));
vi.mock("./coach-sheet", () => ({ CoachSheet: () => null }));
vi.mock("./fit", () => ({ FitTab: () => null, AiNotice: () => null }));
vi.mock("./prepare", () => ({ PrepareTab: () => null }));
vi.mock("./practise", () => ({ PractiseTab: () => null }));
vi.mock("./debrief", () => ({ DebriefTab: () => null }));
vi.mock("./messages", () => ({ MessagesTab: () => null }));
vi.mock("./saved", () => ({ SavedTab: () => null }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

const application: Application = {
	id: "shell-application",
	company: "Harbor",
	role: "Engineer",
	status: "saved",
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
	activity: [],
	appliedAt: new Date("2026-10-08T12:00:00Z"),
	createdAt: new Date("2026-10-08T12:00:00Z"),
	updatedAt: new Date("2026-10-08T12:00:00Z"),
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
const current: CareerWorkspace = {
	...EMPTY_WORKSPACE,
	answers: [{ id: "answer", question: "Why this role?", answer: "Current answer", factIds: [] }],
	checklist: [0],
};
const archive = (data: SavedItem["data"]): SavedItem =>
	({
		id: "saved-version",
		applicationId: application.id,
		interviewId: null,
		title: "Sent answers",
		data,
		evidence: { factIds: [], storyIds: [] },
		userId: "shell-user",
		updatedAt: application.updatedAt,
		jobId: null,
		inputVersion: "version",
		application: { company: "Harbor", role: "Engineer" },
		outdated: false,
		createdAt: application.createdAt,
	}) as SavedItem;
const answers = () => archive({ kind: "answers", answers: [{ question: "Why this role?", answer: "Sent answer" }] });
const clients: QueryClient[] = [];
function mount(
	version?: string,
	options: { workspace?: boolean; resumeId?: string; application?: Partial<Application> } = {},
) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	clients.push(client);
	client.setQueryData(["application"], { ...application, resumeId: options.resumeId ?? null, ...options.application });
	if (options.workspace !== false) client.setQueryData(["workspace"], structuredClone(current));
	const view = render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<Workspace applicationId={application.id} tab="apply" search={version ? { version } : {}} />
			</I18nProvider>
		</QueryClientProvider>,
	);
	return { ...view, client };
}
beforeEach(() => {
	vi.resetAllMocks();
	api.timeZone = "UTC";
	api.saved.mockResolvedValue([]);
	api.workspace.mockResolvedValue(current);
	api.documents.mockResolvedValue([]);
	api.save.mockResolvedValue(current);
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});
afterEach(() => {
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
});

it("keeps a delayed or failed archive link out of the live editor and retries into read-only answers", async () => {
	let reject = (_error: Error) => {};
	api.saved.mockReturnValueOnce(
		new Promise((_resolve, fail) => {
			reject = fail;
		}),
	);
	mount("saved-version");
	expect(screen.getByText("Loading saved version…")).toHaveAttribute("role", "status");
	expect(screen.queryByRole("textbox", { name: "Why this role?" })).toBeNull();
	await act(async () => reject(new Error("Offline")));
	expect(await screen.findByRole("alert")).toHaveTextContent("This saved version couldn't be loaded");
	expect(screen.queryByRole("button", { name: "Mark as applied" })).toBeNull();
	api.saved.mockResolvedValue([answers()]);
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	expect(await screen.findByRole("heading", { name: "Why this role?" })).toBeTruthy();
	expect(screen.getByText("Sent answer", { exact: true })).toBeTruthy();
	expect(screen.queryByText("Current answer", { exact: true })).toBeNull();
	expect(screen.queryByRole("textbox")).toBeNull();
	expect(screen.queryByRole("button", { name: "Add a question from the form" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Mark as applied" })).toBeNull();
	expect(api.save).not.toHaveBeenCalled();
});

it.each([
	{ name: "deleted", items: [], message: "no longer available" },
	{
		name: "wrong tab",
		items: [
			archive({
				kind: "reply",
				title: "Reply",
				message: "Hello",
				asks: [],
				unconfirmed: [],
				reply: "Thanks",
				changes: [],
				offer: null,
				applied: null,
			}),
		],
		message: "different tab",
	},
])("does not expose the current editor for a $name saved version", async ({ items, message }) => {
	api.saved.mockResolvedValue(items);
	mount("saved-version");
	expect(await screen.findByRole("alert")).toHaveTextContent(message);
	expect(screen.queryByRole("textbox", { name: "Why this role?" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Mark as applied" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Back to current" }));
	expect(api.navigate).toHaveBeenCalledWith(expect.objectContaining({ search: { version: undefined }, replace: true }));
});

it("requires initial workspace data before exposing edits, with recovery after a failed load", async () => {
	let reject = (_error: Error) => {};
	api.workspace.mockReturnValueOnce(
		new Promise((_resolve, fail) => {
			reject = fail;
		}),
	);
	mount(undefined, { workspace: false });
	expect(screen.getByText("Loading workspace…")).toHaveAttribute("role", "status");
	expect(screen.queryByRole("button", { name: "Add a question from the form" })).toBeNull();
	await act(async () => reject(new Error("Offline")));
	expect(await screen.findByRole("alert")).toHaveTextContent("This workspace couldn't be loaded");
	expect(screen.queryByRole("button", { name: "Add a question from the form" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	expect(await screen.findByRole("textbox", { name: "Why this role?" })).toHaveValue("Current answer");
	expect(screen.getByText("1 of 4", { exact: true })).toBeTruthy();
	expect(api.save).not.toHaveBeenCalled();
});

it("retains a typed answer if a background workspace refresh fails", async () => {
	const view = mount();
	const field = await screen.findByRole("textbox", { name: "Why this role?" });
	fireEvent.change(field, { target: { value: "My unsaved draft" } });
	api.workspace.mockRejectedValue(new Error("Offline"));
	await act(async () => {
		await view.client.refetchQueries({ queryKey: ["workspace"] });
	});
	expect(screen.getByRole("textbox", { name: "Why this role?" })).toBe(field);
	expect(field).toHaveValue("My unsaved draft");
});

it("explains a missing linked document during loading and offers retry after failure", async () => {
	let reject = (_error: Error) => {};
	api.documents.mockReturnValueOnce(
		new Promise((_resolve, fail) => {
			reject = fail;
		}),
	);
	api.documents.mockRejectedValue(new Error("Offline"));
	mount(undefined, { resumeId: "linked-resume" });
	expect(screen.getByText("Loading linked documents…")).toHaveAttribute("role", "status");
	await act(async () => reject(new Error("Offline")));
	const details = within(screen.getByRole("complementary", { name: "Application details" }));
	expect(await details.findByRole("alert")).toHaveTextContent("Linked documents couldn't be loaded");
	const retry = await details.findByRole("button", { name: "Try again" });
	api.documents.mockResolvedValue([{ id: "linked-resume", type: "resume", name: "Harbor resume" }]);
	fireEvent.click(retry);
	await waitFor(() => expect(screen.getByRole("link", { name: /Harbor resume/ })).toBeTruthy());
});

it("keeps an unsaved posting scoped to its application", async () => {
	const { client } = mount();
	await screen.findByRole("textbox", { name: "Job description" });
	fireEvent.change(screen.getByRole("textbox", { name: "Job description" }), {
		target: { value: "Only for Harbor" },
	});
	await act(async () => {
		client.setQueryData(["application"], { ...application, id: "other-application", company: "Tidewater" });
	});
	expect(screen.getByRole("textbox", { name: "Job description" })).toHaveValue("");
	expect(screen.getByRole("button", { name: "Save posting" })).toBeDisabled();
});

it("keeps unavailable document edits out of the preparation panel and retries its document load", async () => {
	api.documents.mockRejectedValue(new Error("Offline"));
	mount(undefined, { resumeId: "linked-resume" });
	const preparation = within(await screen.findByRole("region", { name: "Application preparation" }));
	await preparation.findByRole("alert");
	api.documents.mockResolvedValue([]);
	fireEvent.click(preparation.getByRole("button", { name: "Try again" }));
	await preparation.findByText("Linked document unavailable. Choose another document or restore it from Trash.");
	expect(preparation.queryByRole("link", { name: "Edit resume" })).toBeNull();
});

it("gates contextual Compare offers during cold or failed saved-item reads and retries the same application", async () => {
	let fail = (_error: Error) => {};
	api.saved.mockReturnValueOnce(
		new Promise((_resolve, reject) => {
			fail = reject;
		}),
	);
	mount(undefined, { application: { status: "offer" } });
	expect(screen.queryByRole("link", { name: "Compare offers" })).toBeNull();
	expect((screen.getByRole("button", { name: "Compare offers" }) as HTMLButtonElement).disabled).toBe(true);
	await act(async () => fail(new Error("Synthetic saved-items failure")));
	expect(((await screen.findByRole("button", { name: "Compare offers" })) as HTMLButtonElement).disabled).toBe(true);
	expect(screen.queryByRole("link", { name: "Compare offers" })).toBeNull();
	const alert = screen
		.getAllByRole("alert")
		.find((node) => node.textContent?.includes("Your saved data hasn't changed"));
	expect(alert).toBeDefined();
	if (!alert) throw new Error("Missing saved-items error");
	api.saved.mockResolvedValue([]);
	fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
	expect(await screen.findByRole("link", { name: "Compare offers" })).toBeTruthy();
});
it("workspace projects the logical follow-up day on the account clock", async () => {
	api.timeZone = "Pacific/Honolulu";
	mount(undefined, {
		application: { followUpAt: new Date("2030-01-03T00:00:00Z"), followUpDateOnly: true, followUpNote: "Logical date" },
	});
	const section = screen.getByRole("heading", { name: "Next step" }).closest("section");
	expect(section?.textContent).toContain("Jan 3");
});
