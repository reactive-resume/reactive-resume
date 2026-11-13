// @vitest-environment happy-dom
import type { AssistantDocument } from "./document";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { ConfirmDialogProvider } from "@/hooks/use-confirm";
import { invalidateAccountScope, setAccountScope } from "@/libs/auth/account-scope";

const mocks = vi.hoisted(() => ({
	selected: null as string | null,
	draft: null as string | null,
	threads: [] as unknown[],
	threadData: null as unknown,
	start: vi.fn(),
	attach: vi.fn(),
	setState: vi.fn(),
	invalidate: vi.fn(),
	navigate: vi.fn(),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-query")>()),
	useQuery: (options: { queryKey: string[] }) =>
		options.queryKey[0] === "threads"
			? { data: mocks.threads, isPending: false }
			: options.queryKey[0] === "thread"
				? { data: mocks.threadData, isFetchedAfterMount: true }
				: {},
	useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mocks.navigate,
	useSearch: () => ({ applicationId: "application-2" }),
	Link: () => null,
}));
vi.mock("@/features/resume/editor/store", () => ({
	useEditorStore: Object.assign(
		(select: (state: unknown) => unknown) =>
			select({ assistantThread: mocks.selected, assistantPrompt: null, assistantDraft: mocks.draft }),
		{ setState: mocks.setState },
	),
}));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({
		providers: [{ id: "provider-1", label: "Local", enabled: true, testStatus: "success" }],
		usableProviders: [{ id: "provider-1", label: "Local", enabled: true, testStatus: "success" }],
		hasUsableProvider: true,
	}),
}));
vi.mock("@/libs/orpc/client", () => ({
	client: { agent: { threads: { start: mocks.start }, attachments: { create: mocks.attach } } },
	orpc: {
		career: { facts: { queryOptions: () => ({ queryKey: ["facts"] }) } },
		agent: {
			threads: {
				list: { key: () => ["threads"], queryOptions: () => ({ queryKey: ["threads"] }) },
				get: { queryOptions: () => ({ queryKey: ["thread"] }) },
			},
		},
	},
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));
vi.mock("./use-assistant-chat", () => ({
	useAssistantChat: () => ({ messages: [], sendMessage: vi.fn(), status: "ready", clearError: vi.fn() }),
}));
vi.mock("./chat", async (importOriginal) => ({
	...(await importOriginal<typeof import("./chat")>()),
	fileToBase64: async () => "Zm9v",
}));

import { AssistantPanel } from "./assistant-panel";

const document: AssistantDocument = {
	kind: "resume",
	id: "resume-1",
	name: "Resume",
	locked: false,
	jobCopy: true,
	madeFor: null,
	posting: null,
	stateOf: () => "pending",
	accept: () => ({ applied: [], stale: [] }),
	locationOf: () => undefined,
};
beforeEach(() => {
	vi.clearAllMocks();
	setAccountScope("account-1");
	mocks.selected = null;
	mocks.draft = null;
	mocks.threads = [];
	mocks.threadData = null;
	mocks.setState.mockImplementation((partial: { assistantThread?: string }) => {
		if (partial.assistantThread !== undefined) mocks.selected = partial.assistantThread;
	});
	mocks.start.mockResolvedValue({ id: "draft-thread" });
	mocks.attach.mockResolvedValue({ id: "file-1", filename: "posting.txt", mediaType: "text/plain" });
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});
afterEach(() => {
	cleanup();
	invalidateAccountScope();
});

it("keeps task titles and shows the original message in history, with old-server fallback", () => {
	mocks.selected = "new";
	const thread = {
		id: "history-thread",
		workingResumeId: document.id,
		coverLetterId: null,
		aiProviderId: "provider-1",
		title: "Tailor summary to payments roles",
		firstMessage: "I'm applying for payments roles. Please tailor my summary.",
		lastMessageAt: new Date("2026-11-02T12:00:00Z"),
		editsProposed: 2,
		editsAccepted: 1,
	};
	mocks.threads = [thread];
	const panel = () => (
		<I18nProvider i18n={i18n}>
			<ConfirmDialogProvider>
				<AssistantPanel document={document} onClose={() => {}} />
			</ConfirmDialogProvider>
		</I18nProvider>
	);
	const { rerender } = render(panel());
	fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
	const row = screen.getByRole("button", { name: /Tailor summary to payments roles.*I'm applying/ });
	expect(row.textContent).toContain(thread.firstMessage);
	expect(row.textContent).toContain("1 of 2 edits accepted");
	expect(mocks.start).not.toHaveBeenCalled();
	mocks.threads = [{ ...thread, firstMessage: undefined }];
	rerender(panel());
	expect(screen.queryByText(thread.firstMessage)).toBeNull();
	expect(screen.getByText(thread.title)).toBeDefined();
});

it("states what an accepted edit changes before sending, and offers translation", () => {
	render(
		<I18nProvider i18n={i18n}>
			<AssistantPanel document={document} onClose={vi.fn()} />
		</I18nProvider>,
	);
	expect(screen.getByText(/Nothing changes until you accept an edit|Working on a copy made for/)).toBeDefined();
	expect(screen.getByRole("button", { name: "Translate into another language…" })).toBeDefined();
	expect(mocks.start).not.toHaveBeenCalled();
});

it("keeps first-message text and attachments when the draft appears in a background thread-list refetch", async () => {
	const panel = (
		<I18nProvider i18n={i18n}>
			<AssistantPanel document={document} onClose={() => {}} />
		</I18nProvider>
	);
	const { container, rerender } = render(panel);
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep my first message" } });
	const input = container.querySelector('input[type="file"]');
	if (!input) throw new Error("First-message attachment picker missing");
	fireEvent.change(input, { target: { files: [new File(["foo"], "posting.txt", { type: "text/plain" })] } });
	await waitFor(() => expect(screen.getByText("posting.txt")).toBeDefined());
	mocks.threads = [
		{ id: "draft-thread", workingResumeId: "resume-1", coverLetterId: null, aiProviderId: "provider-1" },
	];
	rerender(
		<I18nProvider i18n={i18n}>
			<AssistantPanel document={document} onClose={() => {}} />
		</I18nProvider>,
	);
	expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Keep my first message");
	expect(screen.getByText("posting.txt")).toBeDefined();
	expect(mocks.setState).toHaveBeenCalledWith({ assistantThread: "new" });
});

it("keeps a stranded conversation readable with one notice and a disabled composer, while other connections work", () => {
	mocks.selected = "old-thread";
	const thread = {
		id: "old-thread",
		workingResumeId: document.id,
		aiProviderId: null,
		providerLabel: "Home Ollama",
		sourceResumeId: null,
	};
	mocks.threads = [thread];
	mocks.threadData = { thread, messages: [], attachments: [], document: {}, interrupted: [], isReadOnly: true };
	render(
		<I18nProvider i18n={i18n}>
			<AssistantPanel document={document} onClose={() => {}} />
		</I18nProvider>,
	);
	expect(screen.getByRole("button", { name: "Connection: Choose a connection" })).toBeDefined();
	expect(screen.getAllByRole("status")).toHaveLength(1);
	expect(screen.getByRole("status").textContent).toContain("Home Ollama is off or was removed");
	expect(screen.queryByRole("button", { name: "Set up AI" })).toBeNull();
	expect(screen.getByRole("textbox", { name: "Message the assistant" })).toBeDisabled();
	expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
	expect(mocks.start).not.toHaveBeenCalled();
});

it("keeps a handed-off request unsent without competing starter cards", () => {
	mocks.draft = "Translate this resume into German. Keep names, dates and figures.";
	render(
		<I18nProvider i18n={i18n}>
			<AssistantPanel document={document} onClose={() => {}} />
		</I18nProvider>,
	);
	expect(screen.getByRole("textbox", { name: "Message the assistant" })).toHaveValue(mocks.draft);
	expect(screen.queryByText("What should we work on?")).toBeNull();
	expect(screen.queryByRole("button", { name: "Find weak bullets" })).toBeNull();
	expect(mocks.start).not.toHaveBeenCalled();
});
