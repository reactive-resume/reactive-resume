import type { SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
// @vitest-environment happy-dom
import type { Application } from "@/features/applications/types";
import type { CareerWorkspace } from "@reactive-resume/schema/career";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { offerTermsSchema, EMPTY_WORKSPACE } from "@reactive-resume/schema/career";
import { isolate } from "@reactive-resume/utils/string";
import { useDebouncedSave } from "../hooks";
import { pendingCommits } from "../pending-commits";
import { ApplicationPacketPanel } from "./application-packet";
import { ApplyTab } from "./apply";
import { DebriefTab } from "./debrief";
import { MessagesTab } from "./messages";
import { PractiseTab, StoryPractice } from "./practise";
import { SavedTab } from "./saved";
import { invalidateAccountScope, setAccountScope } from "@/libs/auth/account-scope";

const api = vi.hoisted(() => ({
	data: {} as Record<string, unknown>,
	reviewPacket: vi.fn(),
	updateOffer: vi.fn(),
	exportPacket: vi.fn(),
	save: vi.fn(),
	note: vi.fn(),
	ai: true,
	submit: vi.fn(),
	generate: vi.fn(),
	apply: vi.fn(),
	logReply: vi.fn(),
	invalidate: vi.fn(),
	speak: vi.fn(),
	userId: "workspace-user",
	stories: [] as unknown[],
	knowledgeError: false,
	retryKnowledge: vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: string, mutation = vi.fn()) => ({
		key: () => [name],
		queryKey: () => [name],
		queryOptions: () => ({ queryKey: [name], queryFn: async () => api.data[name], staleTime: Infinity }),
		mutationKey: () => [name],
		mutationOptions: () => ({ mutationFn: mutation }),
	});
	return {
		orpc: {
			documents: { list: endpoint("documents"), linkApplication: endpoint("linkApplication") },
			applications: {
				getById: endpoint("application"),
				listSummary: endpoint("applications"),
				list: endpoint("applications"),
				update: endpoint("updateApplication"),
				addNote: endpoint("addNote", api.note),
				logReply: endpoint("logReply", api.logReply),
				lanes: { get: endpoint("lanes") },
			},
			coverLetters: { create: endpoint("createLetter") },
			career: {
				answers: {
					list: endpoint("reviewedAnswers"),
					save: endpoint("saveAnswer"),
					reuse: endpoint("reuseAnswer"),
					delete: endpoint("deleteAnswer"),
				},
				stories: endpoint("stories"),
				workspace: endpoint("workspace"),
				savedItems: endpoint("savedItems"),
				profile: endpoint("profile"),
				createOffer: endpoint("createOffer"),
				updateOffer: endpoint("updateOffer"),
				schedules: endpoint("schedules"),
				facts: endpoint("facts"),
				saveWorkspace: endpoint("saveWorkspace", api.save),
				submitApplication: endpoint("submit", api.submit),
				applyReply: endpoint("applyReply", api.apply),
				undoReply: endpoint("undoReply"),
				generate: endpoint("generate", api.generate),
				deleteSavedItem: endpoint("delete"),
				saveFact: endpoint("saveFact"),
			},
		},
		client: {
			career: { updateOffer: api.updateOffer, generate: api.generate, voice: { speak: api.speak } },
			applications: { logReply: api.logReply, packet: { review: api.reviewPacket, export: api.exportPacket } },
		},
	};
});
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useRouter: () => ({ state: { location: { pathname: "/messages" } } }),
	useSearch: () => ({}),
	useRouteContext: () => ({ session: { user: { id: api.userId, timezone: "UTC" } } }),
	Link: ({ children }: { children: ReactNode }) => <a href="#test-link">{children}</a>,
}));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({
		usableProviders: api.ai ? [{ id: "voice-provider", provider: "openai", label: "Test AI" }] : [],
		isLoading: false,
	}),
}));
vi.mock("@/features/applications/use-application-actions", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/features/applications/use-application-actions")>()),
	useInvalidateApplications: () => api.invalidate,
}));
vi.mock("../coach-thread", () => ({
	useCoachKnowledge: () => ({
		stories: api.stories,
		allStories: api.stories,
		loaded: !api.knowledgeError,
		isError: api.knowledgeError,
		retry: api.retryKnowledge,
	}),
}));
vi.mock("../shared", async (importOriginal) => ({
	...(await importOriginal<typeof import("../shared")>()),
	CollapseRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	Swap: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() } }));
// The library's own review flow is proven in answer-library.test.tsx; here it only hands back a reviewed answer.
vi.mock("./answer-library", () => ({
	AnswerLibrary: ({
		current,
		onUse,
	}: {
		current?: { id: string };
		onUse: (value: { question: string; answer: string; factIds: string[] }) => void;
	}) => (
		<button
			type="button"
			onClick={() => onUse({ question: "Describe your project", answer: "Reviewed answer", factIds: [] })}
		>
			Use a saved answer for {current?.id ?? "a new question"}
		</button>
	),
}));

const application: Application = {
	id: "workspace-application",
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
	replyVersion: "review-token",
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
const props: WorkspaceTabProps = {
	application,
	version: undefined,
	interview: undefined,
	speak: false,
	now: new Date("2026-10-08T12:00:00Z"),
	go: vi.fn(),
};
const item = (id: string, data: SavedItem["data"]): SavedItem =>
	({
		id,
		applicationId: application.id,
		interviewId: null,
		title: id,
		data,
		evidence: { factIds: [], storyIds: [] },
		userId: "workspace-user",
		replyVersion: "review-token",
		updatedAt: new Date("2026-10-08T12:00:00Z"),
		jobId: null,
		inputVersion: "input-version",
		application: { company: "Harbor", role: "Engineer" },
		outdated: false,
		createdAt: new Date("2026-10-08T12:00:00Z"),
	}) as SavedItem;
const reply = () =>
	item("Recruiter reply", {
		kind: "reply",
		title: "Reply to recruiter",
		message: "When are you free?",
		asks: [],
		unconfirmed: [],
		reply: "Original reply",
		changes: [],
		offer: null,
		applied: null,
	});
const debrief = () =>
	item("Saved debrief", {
		kind: "debrief",
		round: "Earlier round",
		question: "Describe your contribution",
		answer: "I measured the change.",
		landed: "mixed",
		title: "Review your evidence",
		verdicts: [{ tag: "supported", text: "Supported by fact-123" }],
		nextRound: "SQL depth matters",
		priority: "Google Cloud example",
		remember: "Team values SQL depth",
		plan: [{ day: "fri", minutes: 15, task: "Practise explaining the result" }],
	});
function deferred<T>() {
	let resolve: (value: T) => void = () => {};
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}
const clients: QueryClient[] = [];
function mount(children: ReactNode) {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
	clients.push(queryClient);
	for (const [key, value] of Object.entries(api.data)) queryClient.setQueryData([key], value);
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={queryClient}>
			<I18nProvider i18n={i18n}>{children}</I18nProvider>
		</QueryClientProvider>
	);
	return { ...render(children, { wrapper }), queryClient };
}
beforeEach(() => {
	vi.clearAllMocks();
	api.ai = true;
	api.data = {
		stories: [],
		lanes: [],
		workspace: structuredClone(EMPTY_WORKSPACE),
		savedItems: [],
		facts: [],
		documents: [],
		reviewedAnswers: [],
	};
	api.userId = "workspace-user";
	api.stories = [];
	api.knowledgeError = false;
	api.save.mockResolvedValue(EMPTY_WORKSPACE);
	api.submit.mockResolvedValue(undefined);
	api.logReply.mockReset().mockResolvedValue(undefined);
	setAccountScope("workspace-user");
	sessionStorage.clear();
	localStorage.clear();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});
afterEach(() => {
	pendingCommits.clear();
	cleanup();
	clients.splice(0).forEach((client) => client.clear());
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("submits the visible draft immediately and pauses autosave until submission finishes", async () => {
	vi.useFakeTimers();
	const answer = { id: "answer", question: "Why this role?", answer: "Old answer", factIds: [] };
	api.data.workspace = { ...EMPTY_WORKSPACE, answers: [answer] };
	const submission = deferred<void>();
	api.submit.mockReturnValue(submission.promise);
	mount(<ApplyTab {...props} />);
	fireEvent.change(screen.getByRole("textbox", { name: "Why this role?" }), {
		target: { value: "Latest answer typed before clicking" },
	});
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Mark as applied" }));
	});
	expect(api.submit.mock.calls[0]?.[0]).toEqual({
		applicationId: application.id,
		answers: [{ ...answer, answer: "Latest answer typed before clicking" }],
		expectedAnswers: [answer],
		expectedDocuments: { resumeId: null, coverLetterId: null },
	});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(3000);
	});
	expect(api.save).not.toHaveBeenCalled();
	await act(async () => {
		submission.resolve();
	});
});

it("blocks submission until an over-limit draft is shortened", async () => {
	const answer = { id: "answer", question: "Why this role?", answer: "x".repeat(6001), factIds: [] };
	api.data.workspace = { ...EMPTY_WORKSPACE, answers: [answer] };
	mount(<ApplyTab {...props} />);
	expect(screen.getByRole("button", { name: "Mark as applied" })).toBeDisabled();
	expect(screen.getByRole("alert")).toHaveTextContent("Shorten questions");
	fireEvent.change(screen.getByRole("textbox", { name: "Why this role?" }), { target: { value: "Short enough" } });
	expect(screen.getByRole("button", { name: "Mark as applied" })).toBeEnabled();
	fireEvent.click(screen.getByRole("button", { name: "Mark as applied" }));
	await waitFor(() => expect(api.submit.mock.calls[0]?.[0]).toMatchObject({ answers: [{ answer: "Short enough" }] }));
});

it("waits for an existing answer save before submitting its current form state", async () => {
	const answer = { id: "answer", question: "Why this role?", answer: "Old answer", factIds: [] };
	api.data.workspace = { ...EMPTY_WORKSPACE, answers: [answer] };
	const saving = deferred<CareerWorkspace>();
	api.save.mockReturnValueOnce(saving.promise);
	mount(<ApplyTab {...props} />);
	const field = screen.getByRole("textbox", { name: "Why this role?" });
	fireEvent.change(field, { target: { value: "Blurred draft" } });
	fireEvent.blur(field);
	await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
	fireEvent.change(field, { target: { value: "Newest form state" } });
	fireEvent.click(screen.getByRole("button", { name: "Mark as applied" }));
	expect(api.submit).not.toHaveBeenCalled();
	await act(async () => saving.resolve({ ...EMPTY_WORKSPACE, answers: [{ ...answer, answer: "Blurred draft" }] }));
	await waitFor(() =>
		expect(api.submit.mock.calls[0]?.[0]).toMatchObject({
			answers: [{ answer: "Newest form state" }],
			expectedAnswers: [{ answer: "Blurred draft" }],
		}),
	);
});

it("does not automatically retry rejected text after rollback, but allows explicit retry", async () => {
	vi.useFakeTimers();
	const save = vi.fn();
	function Editor({ saved }: { saved: string }) {
		const flush = useDebouncedSave("Draft", saved, save);
		return <button onClick={() => flush(true)}>Retry</button>;
	}
	const view = mount(<Editor saved="Original" />);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(2000);
	});
	expect(save).toHaveBeenCalledTimes(1);
	view.rerender(<Editor saved="Draft" />);
	view.rerender(<Editor saved="Original" />);
	await act(async () => {
		await vi.advanceTimersByTimeAsync(10000);
	});
	expect(save).toHaveBeenCalledTimes(1);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(save).toHaveBeenCalledTimes(2);
});

it("retains edited replies across navigation while saved versions keep the generated original", () => {
	const savedReply = reply();
	api.data.savedItems = [savedReply];
	const first = mount(<MessagesTab {...props} />);
	fireEvent.change(screen.getByRole("textbox", { name: "Suggested reply · edit before sending" }), {
		target: { value: "My reply draft\n\nSecond paragraph" },
	});
	first.unmount();
	const next = mount(<MessagesTab {...props} />);
	expect(screen.getByRole("textbox", { name: "Suggested reply · edit before sending" })).toHaveValue(
		"My reply draft\n\nSecond paragraph",
	);
	next.rerender(<MessagesTab {...props} version={savedReply} />);
	expect(screen.getByRole("textbox", { name: "Suggested reply · edit before sending" })).toHaveValue("Original reply");
});

it("highlights localized reply placeholders without blocking Copy, and logs only the explicit action", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	api.data.savedItems = [reply()];
	mount(<MessagesTab {...props} application={{ ...application, status: "applied" }} />);
	const editor = screen.getByRole("textbox", { name: "Suggested reply · edit before sending" });
	fireEvent.change(editor, { target: { value: "Available [Datum und Uhrzeit 1] or [slot 2]." } });
	expect(screen.getByRole("status")).toHaveTextContent("Replace the marked placeholder before sending.");
	expect(screen.getByText("[Datum und Uhrzeit 1]", { selector: "mark" })).toBeInTheDocument();
	expect(screen.getByText("[slot 2]", { selector: "mark" })).toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Copy reply" }));
	await waitFor(() => expect(writeText).toHaveBeenCalledWith("Available [Datum und Uhrzeit 1] or [slot 2]."));
	expect(api.logReply).not.toHaveBeenCalled();
	fireEvent.change(editor, { target: { value: "Available Tuesday at 14:00." } });
	expect(screen.queryByText("Replace the marked placeholder before sending.")).not.toBeInTheDocument();
	fireEvent.click(screen.getByRole("button", { name: "Copy and log as replied" }));
	await waitFor(() => expect(api.logReply).toHaveBeenCalledTimes(1));
	expect(writeText).toHaveBeenLastCalledWith("Available Tuesday at 14:00.");
	expect(api.logReply.mock.calls[0]?.[0]).toEqual({
		id: application.id,
		expectedVersion: "review-token",
	});
	await waitFor(() => expect(api.invalidate).toHaveBeenCalledWith(application.id));
});

it("keeps Copy available and disables explicit logging on an older server", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	api.data.savedItems = [reply()];
	const { replyVersion: _replyVersion, ...older } = application;
	mount(<MessagesTab {...props} application={{ ...older, status: "applied" }} />);
	expect(screen.getByRole("button", { name: "Copy and log as replied" })).toBeDisabled();
	expect(screen.getByText(/Update the server to enable reply logging/)).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Copy reply" }));
	await waitFor(() => expect(writeText).toHaveBeenCalledWith("Original reply"));
	expect(api.logReply).not.toHaveBeenCalled();
});

it("disables empty-draft logging while preserving ordinary Copy", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	api.data.savedItems = [reply()];
	mount(<MessagesTab {...props} application={{ ...application, status: "applied" }} />);
	const editor = screen.getByRole("textbox", { name: "Suggested reply · edit before sending" });
	for (const text of ["", " \n\t"]) {
		fireEvent.change(editor, { target: { value: text } });
		const log = screen.getByRole("button", { name: "Copy and log as replied" });
		expect(log).toBeDisabled();
		fireEvent.click(log);
		expect(api.logReply).not.toHaveBeenCalled();
	}
	expect(writeText).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Copy reply" }));
	await waitFor(() => expect(writeText).toHaveBeenCalledWith(" \n\t"));
	expect(api.logReply).not.toHaveBeenCalled();
});

it("explains a known reply-log refusal without inventing a conflict reason", async () => {
	const { ORPCError } = await import("@orpc/client");
	const { toast } = await import("@reactive-resume/ui/components/toast");
	vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
	api.logReply.mockRejectedValueOnce(new ORPCError("BAD_REQUEST"));
	api.data.savedItems = [reply()];
	mount(<MessagesTab {...props} application={{ ...application, status: "applied" }} />);
	fireEvent.click(screen.getByRole("button", { name: "Copy and log as replied" }));
	await waitFor(() =>
		expect(toast.add).toHaveBeenCalledWith({
			type: "error",
			description: "Reply copied. Nothing was logged. Review the application before logging again.",
		}),
	);
	expect(api.invalidate).toHaveBeenCalledWith(application.id);
});

it("explains a known reply-log conflict and refreshes the application", async () => {
	const { ORPCError } = await import("@orpc/client");
	const { toast } = await import("@reactive-resume/ui/components/toast");
	vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
	api.logReply.mockRejectedValueOnce(new ORPCError("CONFLICT"));
	api.data.savedItems = [reply()];
	mount(<MessagesTab {...props} application={{ ...application, status: "applied" }} />);
	fireEvent.click(screen.getByRole("button", { name: "Copy and log as replied" }));
	await waitFor(() =>
		expect(toast.add).toHaveBeenCalledWith({
			type: "error",
			description: "Reply copied. Nothing was logged because the application changed. Review it again before logging.",
		}),
	);
	expect(api.invalidate).toHaveBeenCalledWith(application.id);
});

it("warns and refreshes the application when logging is uncertain after copying succeeds", async () => {
	const writeText = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	api.logReply.mockRejectedValueOnce(new Error("Lost response"));
	api.data.savedItems = [reply()];
	mount(<MessagesTab {...props} application={{ ...application, status: "applied" }} />);
	fireEvent.click(screen.getByRole("button", { name: "Copy and log as replied" }));
	const { toast } = await import("@reactive-resume/ui/components/toast");
	await waitFor(() =>
		expect(toast.add).toHaveBeenCalledWith({
			type: "error",
			description: "Reply copied. Logging wasn't confirmed. Check the timeline before trying again.",
		}),
	);
	expect(writeText).toHaveBeenCalledWith("Original reply");
	expect(api.logReply).toHaveBeenCalledTimes(1);
	expect(api.invalidate).toHaveBeenCalledWith(application.id);
});

it("does not log after failed clipboard access, duplicate presses or an account switch during copying", async () => {
	const writeText = vi.fn().mockRejectedValueOnce(new Error("Denied"));
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	api.data.savedItems = [reply()];
	mount(<MessagesTab {...props} application={{ ...application, status: "applied" }} />);
	const button = screen.getByRole("button", { name: "Copy and log as replied" });
	fireEvent.click(button);
	await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
	expect(api.logReply).not.toHaveBeenCalled();
	const pending = deferred<void>();
	writeText.mockReturnValueOnce(pending.promise);
	fireEvent.click(button);
	fireEvent.click(button);
	expect(writeText).toHaveBeenCalledTimes(2);
	invalidateAccountScope();
	await act(async () => pending.resolve());
	expect(api.logReply).not.toHaveBeenCalled();
});

it("retains the practice answer after leaving, without exposing it to another signed-in account", () => {
	const first = mount(<PractiseTab {...props} />);
	fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
		target: { value: "My unrehearsed explanation" },
	});
	first.unmount();
	const next = mount(<PractiseTab {...props} />);
	expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveValue("My unrehearsed explanation");
	api.userId = "another-user";
	next.rerender(<PractiseTab {...props} />);
	expect(screen.getByRole("textbox", { name: "Your answer" })).toHaveValue("");
});

it("sends the selected story with feedback and offers recovery if Knowledge cannot load", async () => {
	api.stories = [{ id: "story-1", data: { title: "Payments migration" } }];
	api.generate.mockResolvedValueOnce({ item: null });
	const view = mount(<PractiseTab {...props} story="story-1" />);
	expect(screen.getByRole("heading", { name: /Tell me about “Payments migration”/ })).toBeTruthy();
	fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
		target: { value: "I led the payments migration and reduced failed payments." },
	});
	fireEvent.click(screen.getByRole("button", { name: "Get feedback" }));
	await waitFor(() =>
		expect(api.generate.mock.calls[0]?.[0]).toEqual({
			applicationId: application.id,
			locale: "en-US",
			task: {
				task: "practice",
				interviewId: null,
				storyId: "story-1",
				question: "Tell me about “Payments migration”. What was your part, what did you do, and what changed?",
				origin: "simulated",
				mode: "typed",
				answer: "I led the payments migration and reduced failed payments.",
			},
		}),
	);
	api.knowledgeError = true;
	view.rerender(<PractiseTab {...props} story="story-1" />);
	expect(screen.getByRole("alert")).toHaveTextContent("Your story couldn't be loaded");
	expect(screen.queryByRole("button", { name: "Get feedback" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	expect(api.retryKnowledge).toHaveBeenCalledOnce();
	api.knowledgeError = false;
	api.stories = [];
	view.rerender(<PractiseTab {...props} story="story-1" />);
	expect(screen.getByRole("alert")).toHaveTextContent("This story is unavailable or uses facts that are switched off.");
	expect(screen.queryByRole("button", { name: "Get feedback" })).toBeNull();
	expect(api.generate).toHaveBeenCalledOnce();
});

it("opens a saved practice attempt read-only without offering another feedback submission", () => {
	api.stories = [{ id: "story-1", data: { title: "Payments migration" } }];
	const attempt = item("Saved attempt", {
		kind: "practice",
		question: "Tell me about a migration you led.",
		origin: "simulated",
		mode: "typed",
		answer: "I led the payments migration and reduced failed payments.",
		title: "Your contribution is clear",
		works: "You explain your role.",
		strengthen: "Explain how you measured the change.",
		opening: "I led a payments migration.",
		note: "Contribution clear",
	});
	mount(<PractiseTab {...props} version={attempt} story="story-1" />);
	expect(screen.getByRole("heading", { name: "Tell me about a migration you led." })).toBeTruthy();
	expect(screen.getByText("I led the payments migration and reduced failed payments.")).toBeTruthy();
	expect(screen.queryByRole("textbox", { name: "Your answer" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Get feedback" })).toBeNull();
	expect(api.generate).not.toHaveBeenCalled();
});

it("keeps one editable Debrief form after returning from a read-only saved review", () => {
	const review = debrief();
	review.evidence.factIds = ["fact-123"];
	api.data.savedItems = [review];
	const view = mount(<DebriefTab {...props} version={review} />);
	expect(screen.getByText("Earlier round")).toBeTruthy();
	const archivedTask = screen.getByRole("checkbox", { name: /Practise explaining the result/ });
	expect(archivedTask).toHaveAttribute("aria-disabled", "true");
	fireEvent.click(archivedTask);
	expect(api.save).not.toHaveBeenCalled();
	expect(screen.queryByRole("button", { name: "Remember" })).toBeNull();
	expect(screen.queryByText(/fact-123/)).toBeNull();
	expect(screen.getByText("SQL depth matters")).toBeTruthy();
	expect(screen.getByText("Google Cloud example")).toBeTruthy();
	view.rerender(<DebriefTab {...props} />);
	expect(screen.getAllByRole("textbox", { name: "What did they ask?" })).toHaveLength(1);
	expect(screen.getByRole("textbox", { name: "What did they ask?" })).not.toHaveAttribute("readonly");
	expect(screen.getAllByRole("button", { name: "Review again" })).toHaveLength(1);
});

it("falls back to All when deleting the final item in a selected Saved category", async () => {
	api.data.savedItems = [
		reply(),
		item("Sent answers", { kind: "answers", answers: [{ question: "Why?", answer: "Because" }] }),
	];
	mount(<SavedTab {...props} />);
	fireEvent.click(screen.getByRole("button", { name: "Reply" }));
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	expect(await screen.findByRole("button", { name: "Sent answers" })).toBeTruthy();
	expect(screen.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
});

it("does not play a delayed spoken question after leaving Practise", async () => {
	const speech = deferred<{ audio: string; mediaType: string }>();
	api.speak.mockReturnValue(speech.promise);
	const createAudio = vi.fn();
	vi.stubGlobal("Audio", createAudio);
	const view = mount(<PractiseTab {...props} />);
	fireEvent.click(screen.getByRole("button", { name: "Hear it" }));
	await waitFor(() => expect(api.speak).toHaveBeenCalledOnce());
	view.unmount();
	await act(async () => speech.resolve({ audio: "YQ==", mediaType: "audio/mpeg" }));
	expect(createAudio).not.toHaveBeenCalled();
});

it("stops question playback and releases its audio when leaving Practise", async () => {
	api.speak.mockResolvedValue({ audio: "YQ==", mediaType: "audio/mpeg" });
	const pause = vi.fn();
	const play = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal(
		"Audio",
		class {
			pause = pause;
			play = play;
			addEventListener = vi.fn();
			removeEventListener = vi.fn();
		},
	);
	const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:question");
	const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
	const view = mount(<PractiseTab {...props} />);
	fireEvent.click(screen.getByRole("button", { name: "Hear it" }));
	await waitFor(() => expect(play).toHaveBeenCalledOnce());
	expect(create).toHaveBeenCalledOnce();
	view.unmount();
	expect(pause).toHaveBeenCalledOnce();
	expect(revoke).toHaveBeenCalledWith("blob:question");
});

it("keeps Saved offer provenance neutral", async () => {
	api.data.savedItems = [
		item("Written offer", {
			kind: "offer",
			...offerTermsSchema.parse({ currency: "EUR", period: "year", base: 95000, variable: null }),
		}),
	];
	mount(<SavedTab {...props} />);
	expect(
		await screen.findByText("What you saved while working on Harbor. Each opens read-only in the place that made it."),
	).toBeTruthy();
	expect(screen.queryByText(/coach wrote/)).toBeNull();
	expect(screen.queryByText(/used the message/)).toBeNull();
	expect(screen.getByRole("link", { name: "Open in Offers" })).toBeTruthy();
});

it("keeps an unacknowledged message across pagehide and requires review after reopening against newer server state", async () => {
	const view = mount(<MessagesTab {...props} />);
	fireEvent.click(screen.getByRole("button", { name: "Paste a message" }));
	const field = await screen.findByRole("textbox", {
		name: `Paste a message from ${isolate(props.application.company)}`,
	});
	fireEvent.change(field, { target: { value: "Durable employer message" } });
	expect(localStorage.getItem(`career-draft:${api.userId}:message:${props.application.id}`)).toBe(
		JSON.stringify("Durable employer message"),
	);
	window.dispatchEvent(new Event("pagehide"));
	await waitFor(() => expect(api.save).toHaveBeenCalled());
	view.unmount();
	localStorage.setItem(
		`career-draft:${api.userId}:message:${props.application.id}`,
		JSON.stringify("Unacknowledged older text"),
	);
	api.save.mockClear();
	api.data.workspace = { ...EMPTY_WORKSPACE, message: "Newer server text" };
	mount(<MessagesTab {...props} />);
	fireEvent.click(screen.getByRole("button", { name: "Paste a message" }));
	expect(await screen.findByRole("button", { name: "Save recovered draft" })).toBeTruthy();
	expect(
		screen.getByRole("textbox", { name: `Paste a message from ${isolate(props.application.company)}` }),
	).toHaveValue("Unacknowledged older text");
	window.dispatchEvent(new Event("pagehide"));
	expect(api.save).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Use saved version" }));
	expect(
		screen.getByRole("textbox", { name: `Paste a message from ${isolate(props.application.company)}` }),
	).toHaveValue("Newer server text");
});

it("commits a typed question on Draft and measures the proposal against the question's limit", async () => {
	const answer = { id: "answer", question: "", answer: "", factIds: [] as string[] };
	api.data.workspace = { ...EMPTY_WORKSPACE, answers: [answer] };
	api.generate.mockResolvedValue({
		item: null,
		answer: { text: "one two three", factIds: [], note: "Check the ownership claim." },
	});
	mount(<ApplyTab {...props} />);
	fireEvent.change(screen.getByRole("textbox", { name: "Question from the form" }), {
		target: { value: "Describe reliability (150 words max)" },
	});
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Draft" }));
	});
	expect(api.save.mock.calls.at(-1)?.[0]).toMatchObject({
		answers: [expect.objectContaining({ question: "Describe reliability (150 words max)" })],
	});
	expect(api.generate).toHaveBeenCalledWith(
		expect.objectContaining({
			task: { task: "answer", question: "Describe reliability (150 words max)", answer: "" },
		}),
		expect.anything(),
	);
	expect(await screen.findByText("Check before accepting: Check the ownership claim.")).toBeTruthy();
	expect(screen.getByText("3 of 150 words")).toBeTruthy();
});

it("confirms a Saved-to-Interview move as one change before anything is written", async () => {
	api.data.savedItems = [
		item("Invite", {
			kind: "reply",
			title: "They're inviting you to the next round",
			message: "We'd like to invite you to the next round.",
			asks: [],
			unconfirmed: [],
			reply: "",
			changes: [{ type: "stage", stage: "interview" }],
			offer: null,
			applied: null,
		}),
	];
	api.apply.mockResolvedValue(undefined);
	mount(<MessagesTab {...props} />);
	expect(await screen.findByText("Mark as applied and move to Interview")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Apply 1 change" }));
	// Nothing is sent until the receipt is confirmed.
	expect(api.apply).not.toHaveBeenCalled();
	expect(await screen.findByText("Mark as applied and move it?")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
	expect(api.apply).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Apply 1 change" }));
	fireEvent.click(await screen.findByRole("button", { name: "Mark as applied and move" }));
	await waitFor(() => expect(api.apply).toHaveBeenCalledTimes(1));
	expect(api.apply.mock.calls[0]?.[0]).toMatchObject({
		id: "Invite",
		changes: [0],
		submission: {
			answers: [],
			expectedAnswers: [],
			expectedDocuments: { resumeId: null, coverLetterId: null },
		},
	});
});

it("shows every extracted offer term before applying, including deadline, bonus, equity and start", async () => {
	api.data.savedItems = [
		item("Offer", {
			kind: "reply",
			title: "They sent an offer",
			message: "We are pleased to offer you the role. Let us know by 20 November.",
			asks: [],
			unconfirmed: [],
			reply: "",
			changes: [{ type: "offer" }],
			offer: offerTermsSchema.parse({
				version: "written",
				currency: "EUR",
				period: "year",
				base: 82000,
				variable: 8200,
				variableConditions: "10% of base",
				equity: "0.05% over four years",
				location: "Berlin",
				respondBy: "2026-11-20T16:00:00.000Z",
				startDate: "2027-01-04",
			}),
			applied: null,
		}),
	];
	mount(<MessagesTab {...props} />);
	const details = await screen.findByText(/Opens in Career → Offers/);
	expect(details.textContent).toContain("Base €82,000 per year");
	expect(details.textContent).toContain("Bonus €8,200 (10% of base)");
	expect(details.textContent).toContain("Equity 0.05% over four years");
	expect(details.textContent).toContain("Starts");
	expect(details.textContent).toContain("Jan");
	expect(details.textContent).toContain("Respond by");
});

it.each(["answer", "factIds"] as const)(
	"Tighten Undo refuses an authoritative %s correction after refetch",
	async (field) => {
		const { toast } = await import("@reactive-resume/ui/components/toast");
		const original = { id: "answer", question: "Why this role?", answer: "Original authored answer.", factIds: [] };
		api.data.workspace = { ...EMPTY_WORKSPACE, answers: [original] };
		api.data.reviewedAnswers = [];
		api.generate.mockResolvedValueOnce({ answer: { text: "Accepted answer.", factIds: ["accepted-proof"] } });
		const view = mount(<ApplyTab {...props} />);
		fireEvent.click(screen.getByRole("button", { name: "Tighten" }));
		await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeVisible());
		fireEvent.click(screen.getByRole("button", { name: "Accept" }));
		await waitFor(() => expect(api.save).toHaveBeenCalled());
		const later = { ...original, answer: "Accepted answer.", factIds: ["accepted-proof"] };
		if (field === "answer") later.answer = "Later device correction. Keep this.";
		else later.factIds = ["later-proof"];
		await act(async () => view.queryClient.setQueryData(["workspace"], { ...EMPTY_WORKSPACE, answers: [later] }));
		const undo = vi.mocked(toast.add).mock.calls.findLast(([value]) => value.description === "Answer replaced")?.[0]
			.actionProps?.onClick;
		expect(undo).toBeTypeOf("function");
		api.save.mockClear();
		await act(async () => undo?.({} as never));
		expect(api.save).not.toHaveBeenCalled();
		expect(view.queryClient.getQueryData<CareerWorkspace>(["workspace"])?.answers).toEqual([later]);
	},
);

it("Tighten Undo keeps local typing and pins an unchanged inverse to accepted text and fact IDs", async () => {
	const { toast } = await import("@reactive-resume/ui/components/toast");
	const original = {
		id: "answer",
		question: "Why this role?",
		answer: "Original authored answer.",
		factIds: ["old-proof"],
		aiOperationIds: ["prior-op"],
	};
	api.data.workspace = { ...EMPTY_WORKSPACE, answers: [original] };
	api.data.reviewedAnswers = [];
	api.generate.mockResolvedValueOnce({
		answer: { text: "Accepted answer.", factIds: ["accepted-proof"], aiOperationIds: ["next-op"] },
	});
	mount(<ApplyTab {...props} />);
	fireEvent.click(screen.getByRole("button", { name: "Tighten" }));
	await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeVisible());
	fireEvent.click(screen.getByRole("button", { name: "Accept" }));
	await waitFor(() => expect(api.save).toHaveBeenCalled());
	expect(api.save.mock.calls[0]?.[0]).toMatchObject({ answers: [{ aiOperationIds: ["prior-op", "next-op"] }] });
	const undo = vi.mocked(toast.add).mock.calls.findLast(([value]) => value.description === "Answer replaced")?.[0]
		.actionProps?.onClick;
	expect(undo).toBeTypeOf("function");
	api.save.mockClear();
	fireEvent.change(screen.getByRole("textbox", { name: "Why this role?" }), {
		target: { value: "Later local typing." },
	});
	await act(async () => undo?.({} as never));
	expect(api.save).not.toHaveBeenCalled();
	expect(screen.getByRole("textbox", { name: "Why this role?" })).toHaveValue("Later local typing.");
	fireEvent.change(screen.getByRole("textbox", { name: "Why this role?" }), { target: { value: "Accepted answer." } });
	await act(async () => undo?.({} as never));
	expect(api.save.mock.calls[0]?.[0]).toMatchObject({
		answers: [original],
		expected: {
			answers: [
				{
					...original,
					answer: "Accepted answer.",
					factIds: ["accepted-proof"],
					aiOperationIds: ["prior-op", "next-op"],
				},
			],
		},
	});
});

it("omits absent review subjects and empty answer actions without moving manual indices", async () => {
	mount(<ApplyTab {...props} />);
	await screen.findByRole("heading", { name: "Before you send" });
	expect(within(document.querySelector("#application-readiness") as HTMLElement).getAllByRole("checkbox")).toHaveLength(
		1,
	);
	expect(screen.queryByRole("button", { name: "Copy answers" })).toBeNull();
	fireEvent.click(screen.getByRole("checkbox", { name: `Submit on ${isolate("Harbor")}'s application page yourself` }));
	await waitFor(() =>
		expect(api.save.mock.calls[0]?.[0]).toMatchObject({ checklist: [3], expected: { checklist: [] } }),
	);
});

it.each(["recorded", "legacy", "first version", "saved version"] as const)(
	"shows honest read-only %s review without unfinished progress",
	async (kind) => {
		const answers = [{ id: "answer", question: "Why?", answer: "Current draft", factIds: [] }];
		api.data.workspace = {
			...EMPTY_WORKSPACE,
			answers,
			checklist: [0],
			submissionReview:
				kind === "legacy"
					? null
					: {
							at: "2026-11-03T10:00:00Z",
							checklist: [1],
							documents: false,
							answers: true,
							answerVersionId: "first answers",
						},
		};
		mount(
			<ApplyTab
				{...props}
				version={
					kind === "saved version" || kind === "first version"
						? item(kind === "first version" ? "first answers" : "old answers", {
								kind: "answers",
								answers: [{ question: "Why?", answer: "Old version" }],
							})
						: undefined
				}
			/>,
		);
		await screen.findByText(
			kind === "recorded" || kind === "first version"
				? "Review checks recorded at first submission."
				: "Historical review checks unavailable.",
		);
		const checks = within(document.querySelector("#application-readiness") as HTMLElement).queryAllByRole("checkbox");
		expect(checks).toHaveLength(kind === "recorded" || kind === "first version" ? 2 : 0);
		if (kind === "recorded" || kind === "first version") {
			expect((checks[0] as HTMLInputElement).getAttribute("aria-checked")).toBe("true");
			for (const check of checks) expect(check.getAttribute("aria-disabled")).toBe("true");
		}
		expect(screen.queryByRole("button", { name: "Mark as applied" })).toBeNull();
		expect(document.querySelector("#application-readiness")?.textContent).not.toMatch(/\d+ of \d+/);
	},
);

it("offers answer actions immediately for an unsaved draft and hides them when cleared", async () => {
	const answers = [{ id: "first", question: "Why this role?", answer: "", factIds: [] }];
	api.data.workspace = { ...EMPTY_WORKSPACE, answers };
	const saving = deferred<CareerWorkspace>();
	api.save.mockReturnValue(saving.promise);
	mount(<ApplyTab {...props} />);
	const input = await screen.findByRole("textbox", { name: "Why this role?" });
	expect(screen.queryByRole("button", { name: "Copy answers" })).toBeNull();
	fireEvent.change(input, { target: { value: "First local answer" } });
	expect(screen.getByRole("button", { name: "Copy answers" })).toBeEnabled();
	expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
	fireEvent.blur(input);
	await waitFor(() => expect(api.save).toHaveBeenCalled());
	// The pending network save never returned; visibility still follows local text.
	fireEvent.change(input, { target: { value: "   " } });
	expect(screen.queryByRole("button", { name: "Copy answers" })).toBeNull();
	expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
});

it.each(["first receipt", "legacy"] as const)("opens the correct recorded answers for %s", async (kind) => {
	const first = {
		...item("first", { kind: "answers", answers: [{ question: "Why?", answer: "First submission" }] }),
		submission: true,
	};
	const later = {
		...item("later", { kind: "answers", answers: [{ question: "Why?", answer: "Later submission" }] }),
		submission: true,
	};
	api.data.savedItems = [later, first];
	api.data.workspace = {
		...EMPTY_WORKSPACE,
		answers: [{ id: "draft", question: "Why?", answer: "Current draft", factIds: [] }],
		submissionReview:
			kind === "legacy"
				? null
				: { at: "2026-11-03T10:00:00Z", checklist: [1], documents: false, answers: true, answerVersionId: first.id },
	};
	const go = vi.fn();
	mount(<ApplyTab {...props} application={{ ...application, status: "applied" }} go={go} />);
	fireEvent.click(await screen.findByRole("button", { name: "View recorded answers" }));
	expect(go).toHaveBeenCalledWith("apply", { version: kind === "legacy" ? later.id : first.id });
});

it("keeps approved practice generation running when its tab unmounts", async () => {
	const pending = deferred<{ item: null }>();
	api.generate.mockReturnValueOnce(pending.promise);
	const view = mount(<PractiseTab {...props} />);
	fireEvent.change(screen.getByRole("textbox", { name: "Your answer" }), {
		target: { value: "I coordinated the fictional recovery." },
	});
	fireEvent.click(screen.getByRole("button", { name: "Get feedback" }));
	await waitFor(() => expect(api.generate).toHaveBeenCalledTimes(1));
	const signal = api.generate.mock.calls[0]?.[1]?.signal as AbortSignal;
	expect(signal).toBeDefined();
	view.unmount();
	expect(signal.aborted).toBe(false);
	await act(async () => pending.resolve({ item: null }));
});

// J2-18: a bulk move chosen while a message's stage change is on its way starts from the stage that change saved.
it("makes a later bulk move wait for a message's stage change and start from what it saved", async () => {
	const { stageBaselinesFor } = await import("@reactive-resume/schema/applications/stage-baselines");
	const { STAGE_SCOPE } = await import("@/features/applications/use-application-actions");
	const answer = deferred<unknown>();
	api.apply.mockReturnValueOnce(answer.promise);
	const message = reply();
	if (message.data.kind !== "reply") throw new Error("Expected a reply");
	message.data.changes = [{ type: "stage", stage: "interview" }];
	api.data.savedItems = [message];
	const applied = { ...application, status: "applied" as const };
	const { queryClient } = mount(<MessagesTab {...props} application={applied} />);
	fireEvent.click(screen.getByRole("button", { name: "Apply 1 change" }));
	await waitFor(() => expect(api.apply).toHaveBeenCalled());
	const bulk = stageBaselinesFor(queryClient).begin(STAGE_SCOPE, new Map([[application.id, applied]]));
	const saved = { status: "interview", laneId: null, closedReason: null, stageEntryId: "message-stage" } as const;
	answer.resolve({ stages: [{ id: application.id, ...saved }] });
	expect(await bulk.baselines.get(application.id)).toEqual(saved);
});

// A recovered draft pauses autosave until the user chooses; using a reviewed answer is that choice.
it("resumes autosave after a reviewed answer replaces a recovered draft", async () => {
	const answer = { id: "project", question: "Describe your project", answer: "I wrote a checklist.", factIds: [] };
	api.data.workspace = { ...EMPTY_WORKSPACE, answers: [answer] };
	api.save.mockImplementation(async (input: { answers: unknown[] }) => ({
		...EMPTY_WORKSPACE,
		answers: input.answers,
	}));
	localStorage.setItem(
		`career-draft:workspace-user:answer:${application.id}:project`,
		JSON.stringify("Recovered answer"),
	);
	mount(<ApplyTab {...props} />);
	expect(screen.getByRole("button", { name: "Save recovered draft" })).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Use a saved answer for project" }));
	await waitFor(() => expect(api.save).toHaveBeenCalled());
	await waitFor(() => expect(screen.queryByRole("button", { name: "Save recovered draft" })).toBeNull());
	api.save.mockClear();
	const field = screen.getByRole("textbox", { name: "Describe your project" });
	fireEvent.change(field, { target: { value: "A later edit" } });
	fireEvent.blur(field);
	await waitFor(() =>
		expect(api.save.mock.lastCall?.[0]).toMatchObject({ answers: [{ id: "project", answer: "A later edit" }] }),
	);
});

it("saves a manual debrief to application notes without AI and keeps its draft", async () => {
	api.ai = false;
	api.note.mockResolvedValue({});
	mount(<DebriefTab {...props} />);
	fireEvent.change(screen.getByRole("textbox", { name: "What did they ask?" }), {
		target: { value: "What was your role?" },
	});
	fireEvent.change(screen.getByRole("textbox", { name: "What did you say, as close as you remember?" }), {
		target: { value: "I built the migration plan." },
	});
	fireEvent.click(screen.getByRole("button", { name: "Went well" }));
	expect(screen.queryByRole("button", { name: "Review my answer" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Save to notes" }));
	await waitFor(() =>
		expect(api.note).toHaveBeenCalledWith(
			{ id: application.id, text: "What was your role?\n\nI built the migration plan.\n\nWent well" },
			expect.anything(),
		),
	);
	expect(api.generate).not.toHaveBeenCalled();
	expect(screen.getByRole("textbox", { name: "What did they ask?" })).toHaveValue("What was your role?");
});

it("keeps a manually written reply available without AI and logs only after copying", async () => {
	api.ai = false;
	const writeText = vi.fn().mockResolvedValue(undefined);
	vi.stubGlobal("navigator", { clipboard: { writeText } });
	api.data.savedItems = [];
	api.data.workspace = { ...EMPTY_WORKSPACE, message: "Can you meet Tuesday at 10:00?" };
	const submitted = { ...props.application, status: "applied" as const };
	mount(<MessagesTab {...props} application={submitted} />);
	expect(screen.getByRole("heading", { name: `From ${isolate("Harbor")}` })).toBeVisible();
	const field = await screen.findByRole("textbox", { name: "Suggested reply · edit before sending" });
	fireEvent.change(field, { target: { value: "Thank you. I can meet Tuesday at 10:00." } });
	fireEvent.click(screen.getByRole("button", { name: "Copy and log as replied" }));
	await waitFor(() => expect(api.logReply).toHaveBeenCalledOnce());
	expect(writeText).toHaveBeenCalledWith("Thank you. I can meet Tuesday at 10:00.");
	expect(api.generate).not.toHaveBeenCalled();
});

it("opens a saved Fit summary once without adding a second counts sentence", () => {
	const summary = "6 supported, 1 partly supported, 3 with no evidence yet. Strong on design systems.";
	api.data.savedItems = [
		item("Fit result", { kind: "fit", headline: "Fit check", summary, requirements: [], checks: [], ask: null }),
	];
	mount(<SavedTab {...props} />);
	fireEvent.click(screen.getByRole("button", { name: "Fit result" }));
	expect(screen.getByText(summary)).toBeVisible();
	expect(screen.queryByText(/0 supported/)).not.toBeInTheDocument();
});

it("requires the current packet review and resets approval when its destination changes", async () => {
	const selection = {
		applicationId: application.id,
		targetUrl: "https://example.com/form",
		includeContact: false,
		answerIds: [],
		letterWords: null,
	};
	const makeReview = (targetUrl: string, fingerprint: string) => ({
		selection: { ...selection, targetUrl },
		fingerprint,
		application: { id: application.id, company: application.company, role: application.role },
		contact: null,
		profileRevision: null,
		profileReviewedAt: null,
		experience: "Reviewed experience",
		letterText: "",
		answers: [],
		documents: [{ kind: "resume", id: "resume-1", name: "My resume", revision: "v1" }],
	});
	const initial = makeReview(selection.targetUrl, "a".repeat(64));
	const next = deferred<ReturnType<typeof makeReview>>();
	api.reviewPacket.mockResolvedValueOnce(initial).mockReturnValueOnce(next.promise);
	mount(
		<ApplicationPacketPanel application={{ ...application, resumeId: "resume-1", sourceUrl: selection.targetUrl }} />,
	);
	fireEvent.click(screen.getByRole("button", { name: "Review packet" }));
	const approve = await screen.findByRole("button", { name: "Approve and create packet" });
	expect(approve).toBeDisabled();
	const reviewed = await screen.findByRole("checkbox", {
		name: "I reviewed these fields, answers, the address and each document.",
	});
	await waitFor(() => expect(reviewed).toBeEnabled());
	await userEvent.click(reviewed);
	await waitFor(() => expect(approve).toBeEnabled());
	fireEvent.change(screen.getByRole("textbox", { name: "The form's exact address" }), {
		target: { value: "https://example.com/new-form" },
	});
	expect(approve).toBeDisabled();
	expect(reviewed).not.toBeChecked();
	expect(api.exportPacket).not.toHaveBeenCalled();
	const updated = makeReview("https://example.com/new-form", "b".repeat(64));
	await act(async () => next.resolve(updated));
	expect(approve).toBeDisabled();
	await userEvent.click(reviewed);
	api.exportPacket.mockReturnValue(new Promise(() => {}));
	fireEvent.click(approve);
	await waitFor(() =>
		expect(api.exportPacket).toHaveBeenCalledWith({
			selection: updated.selection,
			fingerprint: updated.fingerprint,
			reviewed: true,
		}),
	);
});

it("starts practice without an application with three general questions and keeps story practice available", () => {
	mount(<StoryPractice storyId="story-1" />);
	expect(screen.getByRole("heading", { name: "Practice without an application" })).toBeVisible();
	expect(screen.getByText("Question 1 of 3 · simulated")).toBeVisible();
	expect(
		screen.getByRole("heading", {
			name: "Tell me about a piece of work you're proud of. What was your part in it, and how did you measure success?",
		}),
	).toBeVisible();
	expect(screen.getByRole("button", { name: "Practice this story" })).toBeEnabled();
});

it("shows the recorded reply changes after reload using the previous stage, not the current follow-up", () => {
	const savedReply = reply();
	if (savedReply.data.kind !== "reply") throw new Error("Expected reply");
	savedReply.data.changes = [
		{ type: "stage", stage: "screening" },
		{ type: "follow-up", at: "2026-11-11T09:00:00Z", note: "Send availability" },
	];
	savedReply.data.applied = {
		at: "2026-11-07T09:00:00Z",
		changes: [0, 1],
		undo: {
			before: {
				status: "applied",
				laneId: null,
				closedReason: null,
				followUpAt: null,
				followUpDateOnly: false,
				followUpNote: null,
			},
			after: {
				status: "screening",
				laneId: null,
				closedReason: null,
				followUpAt: "2026-11-11T09:00:00Z",
				followUpDateOnly: false,
				followUpNote: "Send availability",
			},
			offerId: null,
		},
	};
	api.data.savedItems = [savedReply];
	mount(
		<MessagesTab
			{...props}
			application={{
				...application,
				status: "screening",
				followUpAt: new Date("2026-11-11T09:00:00Z"),
				followUpNote: "Send availability",
			}}
		/>,
	);
	expect(screen.getByText("Was Applied")).toBeVisible();
	expect(screen.getByText(/Follow-up set for .*11/, { selector: "span" })).toBeVisible();
	expect(screen.queryByRole("button", { name: "Apply 2 changes" })).not.toBeInTheDocument();
	expect(screen.queryByText(/replaces the overdue/)).not.toBeInTheDocument();
});

it("lets a no-AI user edit the Messages reply deadline and keeps the row absent with AI", async () => {
	const offer = item("manual-offer", {
		kind: "offer",
		...offerTermsSchema.parse({
			currency: "EUR",
			period: "year",
			base: 95000,
			variable: null,
			respondBy: "2026-11-13T23:59:00Z",
		}),
	});
	api.data.savedItems = [offer];
	api.data.workspace = { ...EMPTY_WORKSPACE, message: "Please reply by Friday." };
	api.updateOffer.mockResolvedValue({
		...offer,
		id: "new-offer",
		data: { ...offer.data, respondBy: "2026-11-16T23:59:00.000Z" },
	});
	const view = mount(<MessagesTab {...props} application={{ ...application, status: "offer" }} />);
	expect(screen.queryByText(/Set by you/)).toBeNull();
	api.ai = false;
	view.rerender(<MessagesTab {...props} application={{ ...application, status: "offer" }} />);
	expect(screen.getByText(/^Reply by /)).toBeVisible();
	expect(screen.getByText("Set by you")).toBeVisible();
	fireEvent.click(screen.getByRole("button", { name: "Edit" }));
	const dialog = screen.getByRole("dialog");
	fireEvent.change(within(dialog).getByLabelText("Respond by"), { target: { value: "2026-11-16" } });
	fireEvent.click(within(dialog).getByRole("button", { name: "Save offer" }));
	await waitFor(() => expect(api.updateOffer).toHaveBeenCalled());
	expect(api.updateOffer.mock.calls[0]?.[0]).toMatchObject({
		id: offer.id,
		terms: { respondBy: "2026-11-16T23:59:00.000Z" },
		expected: { respondBy: "2026-11-13T23:59:00Z" },
		newVersion: true,
	});
});
