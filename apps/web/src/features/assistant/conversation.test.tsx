import type { AssistantDocument } from "./document";
// @vitest-environment happy-dom
import type { Proposal } from "@reactive-resume/resume/proposals";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { applyProposals, getStateIn } from "@reactive-resume/resume/proposals";

const mocks = vi.hoisted(() => ({
	chat: vi.fn(),
	send: vi.fn(),
	attach: vi.fn(),
	publish: vi.fn(),
	record: vi.fn(),
	receipts: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
	useQuery: mocks.receipts,
}));
vi.mock("@/features/resume/editor/store", () => ({
	useEditorStore: { setState: mocks.publish },
}));
vi.mock("@/libs/orpc/client", () => ({
	client: { agent: { attachments: { create: mocks.attach }, messages: { setEditStatus: mocks.record } } },
	orpc: {
		agent: { threads: { get: { queryOptions: () => ({ queryKey: ["thread"] }) }, list: { key: () => ["threads"] } } },
	},
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));
vi.mock("./use-assistant-chat", () => ({ useAssistantChat: mocks.chat }));
vi.mock("./chat", () => ({
	fileToBase64: async () => "Zm9v",
	attachmentPart: (file: { id: string; filename: string; mediaType: string }) => ({
		type: "file",
		url: `agent-attachment:${file.id}`,
		filename: file.filename,
		mediaType: file.mediaType,
	}),
	transcriptOf: () => "",
}));

import { Composer, Conversation } from "./conversation";

const document: AssistantDocument = {
	kind: "resume",
	id: "resume-1",
	name: "Resume",
	locked: false,
	posting: { id: "application-2", company: "Selected Company", role: "Engineer" },
	stateOf: () => "pending",
	accept: () => ({ applied: [], stale: [] }),
	locationOf: () => undefined,
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.receipts.mockReturnValue({});
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	mocks.chat.mockReturnValue({ messages: [], sendMessage: mocks.send, status: "ready", clearError: vi.fn() });
	mocks.record.mockResolvedValue(undefined);
	mocks.attach.mockResolvedValue({ id: "file-1", filename: "posting.txt", mediaType: "text/plain" });
});
afterEach(cleanup);

it("uploads a file in the initial composer before sending its first message", async () => {
	const ensureThread = vi.fn(async () => "draft-thread");
	const send = vi.fn();
	const { container } = render(
		<I18nProvider i18n={i18n}>
			<Composer
				document={document}
				context={{ document: false, posting: false }}
				onContextChange={() => {}}
				providerLabel="Local"
				streaming={false}
				disabled={false}
				threadId={null}
				ensureThread={ensureThread}
				onSend={send}
				onStop={() => {}}
			/>
		</I18nProvider>,
	);
	expect(screen.getByRole("button", { name: "Attach a file" })).toBeDefined();
	const input = container.querySelector('input[type="file"]');
	if (!input) throw new Error("File picker missing");
	fireEvent.change(input, { target: { files: [new File(["foo"], "posting.txt", { type: "text/plain" })] } });
	await waitFor(() => expect(screen.getByText("posting.txt")).toBeDefined());
	expect(mocks.attach).toHaveBeenCalledWith({
		threadId: "draft-thread",
		filename: "posting.txt",
		mediaType: "text/plain",
		data: "Zm9v",
	});
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "Review this posting" } });
	fireEvent.click(screen.getByRole("button", { name: "Send" }));
	expect(send).toHaveBeenCalledWith("Review this posting", [
		{ id: "file-1", filename: "posting.txt", mediaType: "text/plain" },
	]);
});

it("preserves first-message context exclusions, selected application and attachment IDs", async () => {
	const context = { document: false, posting: true, applicationId: "application-2" };
	render(
		<I18nProvider i18n={i18n}>
			<Conversation
				document={document}
				threadId="thread-1"
				initialMessages={[]}
				activeRun={false}
				readOnly={false}
				providerLabel="Local"
				initialContext={context}
				prompt="Prepare"
				promptAttachments={[{ id: "file-1", filename: "posting.txt", mediaType: "text/plain" }]}
				onPromptSent={() => {}}
				onSwitchModel={() => {}}
			/>
		</I18nProvider>,
	);
	await waitFor(() =>
		expect(mocks.send).toHaveBeenCalledWith(
			{ text: "Prepare", files: [expect.objectContaining({ url: "agent-attachment:file-1" })] },
			{ body: { attachmentIds: ["file-1"] } },
		),
	);
	expect(mocks.chat.mock.calls[0]?.[0].context).toEqual(context);
});

it("keeps old questions inert and shows terminal question states without answer controls", () => {
	const question = (state: string, extra: Record<string, unknown> = {}) => ({
		type: "tool-ask_user_question",
		toolCallId: "question-1",
		state,
		input: { question: "Which office?", choices: ["Berlin", "London"] },
		...extra,
	});
	mocks.chat.mockReturnValue({
		messages: [
			{ id: "old", role: "assistant", parts: [question("input-available")] },
			{ id: "user", role: "user", parts: [{ type: "text", text: "Another topic." }] },
			{ id: "new", role: "assistant", parts: [{ type: "text", text: "New reply.", state: "done" }] },
		],
		status: "ready",
		clearError: vi.fn(),
	});
	const view = render(
		<I18nProvider i18n={i18n}>
			<Conversation
				document={document}
				threadId="thread-1"
				initialMessages={[]}
				activeRun={false}
				readOnly={false}
				providerLabel="Local"
				initialContext={{ document: true, posting: true }}
				prompt={null}
				promptAttachments={[]}
				onPromptSent={() => {}}
				onSwitchModel={() => {}}
			/>
		</I18nProvider>,
	);
	expect(screen.queryByRole("button", { name: "Berlin" })).toBeNull();
	view.unmount();

	mocks.chat.mockReturnValue({
		messages: [
			{ id: "failed", role: "assistant", parts: [question("output-error", { errorText: "Invalid tool input" })] },
		],
		status: "ready",
		clearError: vi.fn(),
	});
	render(
		<I18nProvider i18n={i18n}>
			<Conversation
				document={document}
				threadId="thread-1"
				initialMessages={[]}
				activeRun={false}
				readOnly={false}
				providerLabel="Local"
				initialContext={{ document: true, posting: true }}
				prompt={null}
				promptAttachments={[]}
				onPromptSent={() => {}}
				onSwitchModel={() => {}}
			/>
		</I18nProvider>,
	);
	expect(screen.getByText("This question couldn't be asked. Send a new message to continue.")).toBeDefined();
	expect(screen.queryByRole("button", { name: "Berlin" })).toBeNull();
});

it("reopens native and custom web results with sources, clipping and failed or unfinished tool status", () => {
	const messages = [
		{
			id: "web-history",
			role: "assistant",
			parts: [
				{ type: "tool-web_search", toolCallId: "old-native", state: "output-available", input: {}, output: {} },
				{ type: "source-url", sourceId: "native", url: "https://company.example/job", title: "Company role" },
				{
					type: "tool-search_web",
					toolCallId: "failed",
					state: "output-error",
					input: {},
					errorText: "Enhanced access quota exhausted",
				},
				{ type: "tool-google_search", toolCallId: "stopped", state: "input-available", input: {} },
				{
					type: "tool-read_page",
					toolCallId: "read",
					state: "output-available",
					input: { url: "https://careers.example/role" },
					output: {
						requestedUrl: "https://careers.example/role",
						content: "Description",
						format: "text",
						method: "builtin",
						retrievedAt: "2026-09-30T12:00:00Z",
						truncated: true,
						completeness: "incomplete",
					},
				},
			],
		},
	];
	mocks.chat.mockReturnValue({ messages, status: "ready", clearError: vi.fn() });
	render(
		<I18nProvider i18n={i18n}>
			<Conversation
				document={document}
				threadId="thread-1"
				initialMessages={[]}
				activeRun={false}
				readOnly={false}
				providerLabel="Local"
				initialContext={{ document: true, posting: true }}
				prompt={null}
				promptAttachments={[]}
				onPromptSent={() => {}}
				onSwitchModel={() => {}}
			/>
		</I18nProvider>,
	);
	expect(screen.getAllByText("Searched the web")).toHaveLength(1);
	expect(screen.getByRole("alert").textContent).toContain("Enhanced access quota exhausted");
	expect(screen.getByText("Web search didn't finish.")).toBeDefined();
	expect(screen.getByText("This page is clipped or incomplete. Check the original before using it.")).toBeDefined();
	expect(screen.getByRole("link", { name: "Company role" }).getAttribute("href")).toBe("https://company.example/job");
	expect(screen.getByRole("link", { name: "https://careers.example/role" }).getAttribute("href")).toBe(
		"https://careers.example/role",
	);
});

it("records only edits actually applied, with failed cards out of date and an accurate applied count", async () => {
	let content = "<p>Original</p>";
	const applications: Record<string, boolean> = {};
	const base: Proposal = {
		id: "rewrite",
		target: { sectionId: "summary", field: "content" },
		location: "Summary",
		before: content,
		after: "<p>Rewritten</p>",
		why: "Clearer",
		status: "pending",
		source: "assistant",
	};
	const edits = [base, { ...base, id: "addition", after: "<p>Conflicting rewrite</p>" }];
	const doc: AssistantDocument = {
		...document,
		stateOf: (edit) => getStateIn(content, edit, applications),
		accept: (chosen) => {
			const result = applyProposals(
				chosen,
				() => content,
				(_, value) => {
					content = value;
				},
			);
			for (const edit of result.applied) applications[edit.id] = true;
			return result;
		},
	};
	mocks.chat.mockReturnValue({
		messages: [
			{
				id: "message",
				role: "assistant",
				parts: [
					{ type: "tool-propose_edits", toolCallId: "call", state: "output-available", output: { edits, skipped: [] } },
				],
			},
		],
		status: "ready",
		clearError: vi.fn(),
	});
	const view = () => (
		<I18nProvider i18n={i18n}>
			<Conversation
				document={doc}
				threadId="thread-1"
				initialMessages={[]}
				activeRun={false}
				readOnly={false}
				providerLabel="Local"
				initialContext={{ document: true, posting: true }}
				prompt={null}
				promptAttachments={[]}
				onPromptSent={() => {}}
				onSwitchModel={() => {}}
			/>
		</I18nProvider>
	);
	const { rerender } = render(view());
	fireEvent.click(screen.getByRole("button", { name: "Accept all" }));
	rerender(view());
	expect(mocks.record).not.toHaveBeenCalled();
	expect(content).toBe("<p>Rewritten</p>");
	expect(screen.getByText("1 of 2 applied")).toBeDefined();
	expect(screen.getByText("Out of date: the text has changed since.")).toBeDefined();
	expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
});

it("persists only explicit history changes after acceptance, retaining refinements and restoring redo", async () => {
	const edit: Proposal = {
		id: "edit",
		target: { sectionId: "summary", field: "content" },
		location: "Summary",
		before: "<p>Old</p>",
		after: "<p>Old</p><p>Added</p>",
		why: "Clearer",
		status: "pending",
		source: "assistant",
	};
	const part = {
		type: "tool-propose_edits",
		toolCallId: "call",
		state: "output-available",
		output: { edits: [edit], skipped: [] },
	};
	mocks.chat.mockReturnValue({
		messages: [{ id: "message", role: "assistant", parts: [part] }],
		status: "ready",
		clearError: vi.fn(),
	});
	let content = edit.before;
	let proposalRevision = "local";
	mocks.receipts.mockReturnValue({ data: { messages: [] } });
	let applied: boolean | undefined;
	const view = () => {
		const doc: AssistantDocument = {
			...document,
			proposalRevision,
			stateOf: (proposal) => getStateIn(content, proposal, applied === undefined ? {} : { edit: applied }),
			accept: (chosen) => {
				const result = applyProposals(
					chosen,
					() => content,
					(_, value) => {
						content = value;
					},
					applied === undefined ? {} : { edit: applied },
				);
				if (result.applied.length) applied = true;
				return result;
			},
		};
		return (
			<I18nProvider i18n={i18n}>
				<Conversation
					document={doc}
					threadId="thread-1"
					initialMessages={[]}
					activeRun={false}
					readOnly={false}
					providerLabel="Local"
					initialContext={{ document: true, posting: true }}
					prompt={null}
					promptAttachments={[]}
					onPromptSent={() => {}}
					onSwitchModel={() => {}}
				/>
			</I18nProvider>
		);
	};
	const { rerender } = render(view());
	fireEvent.click(screen.getByRole("button", { name: "Accept" }));
	rerender(view());
	await waitFor(() => expect(screen.getByText("1 of 1 applied")).toBeDefined());
	content = "<p>Refined anchor</p><p>Refined addition</p>";
	rerender(view());
	expect(screen.getByText("1 of 1 applied")).toBeDefined();
	expect(mocks.record).not.toHaveBeenCalled();
	applied = false;
	content = edit.before;
	rerender(view());
	await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeDefined());
	applied = true;
	content = "<p>Refined anchor</p><p>Refined addition</p>";
	rerender(view());
	await waitFor(() => expect(screen.getByText("1 of 1 applied")).toBeDefined());
	expect(mocks.record).not.toHaveBeenCalled();
	expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
	// A newer remote Undo invalidates both the owner overlay and mounted chat's old receipt.
	applied = undefined;
	content = edit.before;
	proposalRevision = "remote-undo";
	mocks.receipts.mockReturnValue({ data: { messages: [{ id: "message", role: "assistant", parts: [part] }] } });
	rerender(view());
	expect(screen.getByRole("button", { name: "Accept" })).toBeDefined();
	expect(mocks.receipts).toHaveBeenLastCalledWith(expect.objectContaining({ queryKey: ["thread", "remote-undo"] }));
	const refetch = vi.fn();
	proposalRevision = "remote-unread";
	mocks.receipts.mockReturnValue({ error: new Error("Offline"), refetch });
	rerender(view());
	expect(screen.getByRole("button", { name: "Accept" }).hasAttribute("disabled")).toBe(true);
	expect(screen.getByRole("alert").textContent).toContain("This conversation couldn't be opened.");
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(refetch).toHaveBeenCalledOnce();
	expect(mocks.send).not.toHaveBeenCalled();
});
