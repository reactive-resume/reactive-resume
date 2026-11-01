import type { SavedItem } from "../hooks";
import type { WorkspaceTabProps } from "./shell";
// @vitest-environment happy-dom
import type { Application } from "@/features/applications/types";
import type { CareerWorkspace } from "@reactive-resume/schema/career";
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { offerTermsSchema, EMPTY_WORKSPACE } from "@reactive-resume/schema/career";
import { useDebouncedSave } from "../hooks";
import { pendingCommits } from "../pending-commits";
import { ApplyTab } from "./apply";
import { DebriefTab } from "./debrief";
import { MessagesTab } from "./messages";
import { PractiseTab } from "./practise";
import { SavedTab } from "./saved";

const api = vi.hoisted(() => ({
	data: {} as Record<string, unknown>,
	save: vi.fn(),
	submit: vi.fn(),
	generate: vi.fn(),
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
		mutationOptions: () => ({ mutationFn: mutation }),
	});
	return {
		orpc: {
			documents: { list: endpoint("documents") },
			applications: { update: endpoint("updateApplication") },
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
				facts: endpoint("facts"),
				saveWorkspace: endpoint("saveWorkspace", api.save),
				submitApplication: endpoint("submit", api.submit),
				generate: endpoint("generate", api.generate),
				deleteSavedItem: endpoint("delete"),
				saveFact: endpoint("saveFact"),
			},
		},
		client: { career: { voice: { speak: api.speak } } },
	};
});
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useRouteContext: () => ({ session: { user: { id: api.userId, timezone: "UTC" } } }),
	Link: ({ children }: { children: ReactNode }) => <a href="#test-link">{children}</a>,
}));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({
		usableProviders: [{ id: "voice-provider", provider: "openai", label: "Test AI" }],
		isLoading: false,
	}),
}));
vi.mock("@/features/applications/use-application-actions", () => ({
	useInvalidateApplications: () => api.invalidate,
}));
vi.mock("../coach-thread", () => ({
	useCoachKnowledge: () => ({
		stories: api.stories,
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
	api.data = {
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
		target: { value: "My reply draft" },
	});
	first.unmount();
	const next = mount(<MessagesTab {...props} />);
	expect(screen.getByRole("textbox", { name: "Suggested reply · edit before sending" })).toHaveValue("My reply draft");
	next.rerender(<MessagesTab {...props} version={savedReply} />);
	expect(screen.getByRole("textbox", { name: "Suggested reply · edit before sending" })).toHaveValue("Original reply");
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
	expect(screen.getByRole("heading", { name: "Earlier round" })).toBeTruthy();
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
	expect(screen.getAllByRole("button", { name: "Review my answer" })).toHaveLength(1);
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
	expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
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

it("keeps Saved offer provenance neutral for both manual and older offer shapes", async () => {
	api.data.savedItems = [
		item("Written offer", {
			kind: "offer",
			...offerTermsSchema.parse({ currency: "EUR", period: "year", base: 95000, variable: null }),
		}),
	];
	mount(<SavedTab {...props} />);
	expect(await screen.findByText("Library items for Harbor, newest first.")).toBeTruthy();
	expect(screen.queryByText(/coach wrote/)).toBeNull();
	expect(screen.queryByText(/used the message/)).toBeNull();
	expect(screen.getByRole("link", { name: "Open in Offers" })).toBeTruthy();
});

it("keeps an unacknowledged message across pagehide and requires review after reopening against newer server state", async () => {
	const view = mount(<MessagesTab {...props} />);
	const field = await screen.findByRole("textbox", { name: `Paste a message from ${props.application.company}` });
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
	expect(await screen.findByRole("button", { name: "Save recovered draft" })).toBeTruthy();
	expect(screen.getByRole("textbox", { name: `Paste a message from ${props.application.company}` })).toHaveValue(
		"Unacknowledged older text",
	);
	window.dispatchEvent(new Event("pagehide"));
	expect(api.save).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Use saved version" }));
	expect(screen.getByRole("textbox", { name: `Paste a message from ${props.application.company}` })).toHaveValue(
		"Newer server text",
	);
});
