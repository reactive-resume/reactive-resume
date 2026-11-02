// @vitest-environment happy-dom
import type { UIMessage } from "ai";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
	send: vi.fn(),
	resume: vi.fn(),
	stop: vi.fn(),
	saveFact: vi.fn(),
	updateFact: vi.fn(),
	thread: vi.fn(async () => ({
		history: { cutoffAt: null as Date | null, withheld: [] as string[] },
		interrupted: [] as string[],
	})),
}));

vi.mock("@tanstack/react-router", () => ({
	Link: () => null,
	useNavigate: () => vi.fn(),
	useRouteContext: () => ({ session: { user: { id: "test-user", timezone: "UTC" } } }),
}));
vi.mock("@/libs/orpc/client", () => ({
	streamClient: { agent: { messages: { send: mocks.send, resume: mocks.resume } } },
	client: {
		agent: {
			attachments: { create: vi.fn() },
			messages: { stop: mocks.stop },
			// The saved copy after Stop is the browser suites' job; here the read fails and the local transcript stays.
			threads: { get: async () => Promise.reject(new Error("Offline")) },
		},
		career: { saveFact: mocks.saveFact, updateFact: mocks.updateFact, forgetFact: vi.fn() },
	},
	orpc: {
		agent: {
			threads: {
				list: { key: () => ["threads"] },
				get: {
					queryOptions: ({ input }: { input: { id: string } }) => ({
						queryKey: ["thread", input.id],
						queryFn: mocks.thread,
					}),
				},
			},
		},
		documents: { list: { queryOptions: () => ({ queryKey: ["documents"], queryFn: async () => [] }) } },
		career: {
			facts: { key: () => ["facts"] },
			stories: { key: () => ["stories"] },
			profile: { queryOptions: () => ({ queryKey: ["profile"], queryFn: async () => ({ memoryMode: "off" }) }) },
		},
	},
}));

import { ChatView } from "./coach-chat";
import { QuestionCard } from "@/features/assistant/question-card";
import { useAssistantChat } from "@/features/assistant/use-assistant-chat";

const knowledge = {
	loaded: true,
	updatedAt: 0,
	isPending: false,
	isError: false,
	retry: vi.fn(),
	all: [],
	active: [],
	stories: [],
	allStories: [],
};
const input = { question: "Which office?", choices: ["Berlin", "London"] };
const question = (state = "input-available", extra: Record<string, unknown> = {}) => ({
	type: "tool-ask_user_question",
	toolCallId: "q-1",
	state,
	input,
	...extra,
});
const assistant = (part = question(), id = "a-1"): UIMessage => ({ id, role: "assistant", parts: [part] }) as UIMessage;
const textMessage = (text: string, id = "a-2"): UIMessage =>
	({ id, role: "assistant", parts: [{ type: "text", text, state: "done" }] }) as UIMessage;
const userMessage = (text: string, id = "u-2"): UIMessage =>
	({ id, role: "user", parts: [{ type: "text", text }] }) as UIMessage;

const frame = (chunk: object) => `data: ${JSON.stringify(chunk)}\n\n`;
async function* reply(id = "a-1") {
	for (const chunk of [
		{ type: "start", messageId: id },
		{ type: "start-step" },
		{ type: "text-start", id: "text-1" },
		{ type: "text-delta", id: "text-1", delta: "Continued with your answer." },
		{ type: "text-end", id: "text-1" },
		{ type: "finish-step" },
		{ type: "finish", finishReason: "stop" },
	])
		yield frame(chunk);
}

type ToolPart = UIMessage["parts"][number] & {
	toolCallId?: string;
	state?: string;
	output?: unknown;
};

/** Persist a question answer like the server's merge, so mounts can round-trip through serialized data. */
function answer(stored: UIMessage, incoming: UIMessage): UIMessage {
	const answered = (incoming.parts as ToolPart[]).find(
		(part) => part.type === "tool-ask_user_question" && part.state === "output-available",
	);
	if (!answered) return stored;
	return {
		...stored,
		parts: (stored.parts as ToolPart[]).map((part) =>
			part.type === "tool-ask_user_question" && part.toolCallId === answered.toolCallId
				? { ...part, state: "output-available", output: answered.output }
				: part,
		) as UIMessage["parts"],
	};
}

function mount(
	messages: UIMessage[],
	applicationId: string | null = null,
	activeRun = false,
	knowledgeState: typeof knowledge = knowledge,
) {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<I18nProvider i18n={i18n}>
				<ChatView
					threadId="thread-1"
					knowledge={knowledgeState}
					context={{ document: false, posting: false, memory: true }}
					connection="Local"
					onChangeConnection={() => {}}
					header={() => null}
					empty={() => null}
					privacy={() => null}
					placeholder="Ask coach"
					variant="page"
					createThread={async () => "thread-1"}
					onThreadCreated={() => {}}
					applicationId={applicationId}
					prompt={null}
					onPromptSent={() => {}}
					initialMessages={messages}
					activeRun={activeRun}
					readOnly={false}
				/>
			</I18nProvider>
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	mocks.send.mockImplementation(async () => reply());
});
afterEach(cleanup);

it.each([null, "application-1"])("answers, continues, persists and restores a choice in scope %s", async (scope) => {
	let persisted = assistant();
	mocks.send.mockImplementation(async ({ message }: { message: UIMessage }) => {
		persisted = answer(persisted, message);
		return reply();
	});
	const view = mount([persisted], scope);
	fireEvent.click(screen.getByRole("button", { name: "London" }));
	await screen.findByText("Continued with your answer.");
	expect(mocks.send).toHaveBeenCalledTimes(1);
	expect(mocks.send.mock.calls[0]?.[0].message.id).toBe("a-1");
	expect(screen.getByText("You answered: London")).toBeDefined();
	expect(persisted.parts[0]).toMatchObject({ state: "output-available", output: "London" });
	view.unmount();
	mount([persisted], scope);
	expect(screen.getByText("You answered: London")).toBeDefined();
	expect(screen.queryByRole("button", { name: "London" })).toBeNull();
});

it("trims a custom answer before sending it", async () => {
	mount([assistant()]);
	const text = screen.getByLabelText("Answer in your own words");
	fireEvent.change(text, { target: { value: "  Munich  " } });
	fireEvent.submit(text.closest("form") as HTMLFormElement);
	await screen.findByText("You answered: Munich");
	expect(mocks.send.mock.calls[0]?.[0].message.parts[0].output).toBe("Munich");
});

it("does not offer an old unanswered question as actionable", () => {
	mount([assistant(), userMessage("Never mind, another topic."), textMessage("New reply.")]);
	expect(screen.queryByRole("button", { name: "Berlin" })).toBeNull();
	expect(screen.queryByText("You answered: Berlin")).toBeNull();
	cleanup();
	mount([assistant(), textMessage("New reply.")]);
	expect(screen.queryByRole("button", { name: "Berlin" })).toBeNull();
	expect(mocks.send).not.toHaveBeenCalled();
});

it("shows terminal question states without offering an answer the server cannot merge", () => {
	mount([assistant(question("output-error", { errorText: "Invalid tool input" }))]);
	expect(screen.getByText("This question couldn't be asked. Send a new message to continue.")).toBeDefined();
	expect(screen.queryByRole("button", { name: "Berlin" })).toBeNull();
	expect(mocks.send).not.toHaveBeenCalled();
	cleanup();
	mount([assistant(question("input-streaming"))]);
	expect(screen.getByText("This question didn't finish.")).toBeDefined();
	expect(screen.queryByRole("button", { name: "Berlin" })).toBeNull();
	expect(mocks.send).not.toHaveBeenCalled();
});

it("accepts only the first of two activations before a render", async () => {
	let persisted = assistant();
	mocks.send.mockImplementation(async ({ message }: { message: UIMessage }) => {
		persisted = answer(persisted, message);
		return reply();
	});
	mount([assistant()]);
	const berlin = screen.getByRole("button", { name: "Berlin" });
	const london = screen.getByRole("button", { name: "London" });
	act(() => {
		fireEvent.click(berlin);
		fireEvent.click(london);
	});
	await screen.findByText("You answered: Berlin");
	expect(screen.queryByText("You answered: London")).toBeNull();
	await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
	expect(mocks.send.mock.calls[0]?.[0].message.parts[0].output).toBe("Berlin");
	expect(persisted.parts[0]).toMatchObject({ output: "Berlin" });
});

it("locks the question until a pending active-run resume settles", async () => {
	let release: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	mocks.resume.mockImplementation(async () => {
		await gate;
		return (async function* () {
			yield frame({ type: "start", messageId: "a-1" });
			yield frame({ type: "tool-input-available", toolCallId: "q-1", toolName: "ask_user_question", input });
			yield frame({ type: "finish", finishReason: "tool-calls" });
		})();
	});
	mount([assistant()], null, true);
	await waitFor(() => expect(mocks.resume).toHaveBeenCalled());
	expect((screen.getByRole("button", { name: "Berlin" }) as HTMLButtonElement).disabled).toBe(true);
	fireEvent.click(screen.getByRole("button", { name: "Berlin" }));
	expect(mocks.send).not.toHaveBeenCalled();
	await act(async () => release?.());
	await waitFor(() =>
		expect((screen.getByRole("button", { name: "Berlin" }) as HTMLButtonElement).disabled).toBe(false),
	);
});

it("aborts a pending resume RPC and unlocks choices when stopped", async () => {
	let signal: AbortSignal | undefined;
	mocks.resume.mockImplementation(
		(_input, options?: { signal?: AbortSignal }) =>
			new Promise((_resolve, reject) => {
				signal = options?.signal;
				signal?.addEventListener("abort", () => reject(signal?.reason), { once: true });
			}),
	);
	mocks.stop.mockResolvedValue(undefined);
	mount([assistant()], null, true);
	await waitFor(() => expect(mocks.resume).toHaveBeenCalled());
	fireEvent.click(screen.getByRole("button", { name: /stop/i }));
	await waitFor(() =>
		expect((screen.getByRole("button", { name: "Berlin" }) as HTMLButtonElement).disabled).toBe(false),
	);
	expect(signal?.aborted).toBe(true);
});

it("keeps a newer resume locked when a superseded request settles late", async () => {
	const release: Array<() => void> = [];
	// A response can arrive after cancellation; it must not clear the newer request's busy state.
	mocks.resume.mockImplementation(() => new Promise((resolve) => release.push(() => resolve(reply()))));
	const { result } = renderHook(() =>
		useAssistantChat({
			threadId: "overlapping-resumes",
			initialMessages: [assistant()],
			resume: false,
			context: { document: false, posting: false, memory: true },
			onFinish: () => {},
		}),
	);
	let first: Promise<void> | undefined;
	let second: Promise<void> | undefined;
	act(() => {
		first = result.current.resumeStream();
	});
	await waitFor(() => expect(mocks.resume).toHaveBeenCalledTimes(1));
	act(() => {
		second = result.current.resumeStream();
	});
	await waitFor(() => expect(mocks.resume).toHaveBeenCalledTimes(2));
	await act(async () => {
		release[0]?.();
		await first;
	});
	expect(result.current.resuming).toBe(true);
	await act(async () => {
		release[1]?.();
		await second;
	});
	expect(result.current.resuming).toBe(false);
});

it("retries a failed continuation with the same persisted answer", async () => {
	let persisted = assistant();
	let attempt = 0;
	mocks.send.mockImplementation(async ({ message }: { message: UIMessage }) => {
		persisted = answer(persisted, message);
		attempt += 1;
		if (attempt === 1)
			return (async function* () {
				yield frame({ type: "start", messageId: "a-1" });
				yield frame({ type: "error", errorText: "Provider unavailable." });
			})();
		return reply();
	});
	mount([persisted]);
	fireEvent.click(screen.getByRole("button", { name: "Berlin" }));
	await screen.findByRole("alert");
	expect(screen.getByRole("alert").textContent).toContain("Provider unavailable");
	expect(persisted.parts[0]).toMatchObject({ state: "output-available", output: "Berlin" });
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	await screen.findByText("Continued with your answer.");
	expect(mocks.send).toHaveBeenCalledTimes(2);
});

it("keeps choice and custom-answer accessible names", async () => {
	const user = userEvent.setup();
	const view = mount([assistant()]);
	screen.getByRole("button", { name: "London" }).focus();
	await user.keyboard("{Enter}");
	await screen.findByText("You answered: London");
	view.unmount();
	mocks.send.mockClear();
	mount([assistant()]);
	const textbox = screen.getByRole("textbox", { name: "Answer in your own words" });
	await user.type(textbox, "  Munich  {Enter}");
	await screen.findByText("You answered: Munich");
	expect(mocks.send.mock.calls[0]?.[0].message.parts[0].output).toBe("Munich");
});

it("keeps the card visible but inert while busy or read-only", () => {
	const onAnswer = vi.fn();
	const view = render(
		<I18nProvider i18n={i18n}>
			<QuestionCard part={question()} readOnly={false} busy onAnswer={onAnswer} />
		</I18nProvider>,
	);
	expect((screen.getByRole("button", { name: "Berlin" }) as HTMLButtonElement).disabled).toBe(true);
	const inputElement = screen.getByLabelText("Answer in your own words");
	fireEvent.change(inputElement, { target: { value: "  " } });
	fireEvent.submit(inputElement.closest("form") as HTMLFormElement);
	expect(onAnswer).not.toHaveBeenCalled();
	view.rerender(
		<I18nProvider i18n={i18n}>
			<QuestionCard part={question()} readOnly onAnswer={onAnswer} />
		</I18nProvider>,
	);
	expect(screen.queryByRole("button", { name: "Berlin" })).toBeNull();
	view.rerender(
		<I18nProvider i18n={i18n}>
			<QuestionCard part={question("input-streaming")} readOnly={false} busy onAnswer={onAnswer} />
		</I18nProvider>,
	);
	expect(screen.queryByText("This question didn't finish.")).toBeNull();
});

it("marks a reply that ended early after a reopen, without crediting Knowledge to an empty one", async () => {
	const used = {
		context: { facts: ["f-1"], stories: [], preferences: true, applications: false, offers: [], web: false },
	};
	const asked = { ...userMessage("Answer slowly please."), metadata: used } as UIMessage;
	mocks.thread.mockResolvedValue({ history: { cutoffAt: null, withheld: [] }, interrupted: ["a-2"] });
	const view = mount([asked, { id: "a-2", role: "assistant", parts: [] } as UIMessage]);
	await screen.findByText("Stopped before answering.");
	expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
	expect(screen.queryByText("Used")).toBeNull();
	view.unmount();
	mount([asked, textMessage("word0 word1 word27")]);
	await screen.findByText("Stopped before the answer finished.");
	fireEvent.click(screen.getByRole("button", { name: "Continue" }));
	await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
	expect(mocks.send.mock.calls[0]?.[0].message).toMatchObject({
		role: "user",
		parts: [{ type: "text", text: "Continue" }],
	});
});

it("says which messages Knowledge changes hold back, as the server names them", async () => {
	mocks.thread.mockResolvedValue({
		history: { cutoffAt: new Date("2026-10-30T10:00:00Z"), withheld: ["u-2", "a-2"] },
		interrupted: [],
	});
	mount([userMessage("My code word is PELICAN-42."), textMessage("Noted."), userMessage("What was it?", "u-3")]);
	await screen.findByText(/Messages above aren't sent to the AI anymore/);
});

it("remembers a message only after the user reviews it, in Never mode, without asking the AI", async () => {
	mocks.saveFact.mockResolvedValue({ id: "fact-1" });
	mount([userMessage("I mentored three junior designers; two were promoted.", "u-9")], "application-1");
	fireEvent.click(screen.getByRole("button", { name: "Remember" }));
	const field = screen.getByRole("textbox", { name: "Remember as a fact in Knowledge" });
	fireEvent.change(field, { target: { value: "Mentored three junior designers" } });
	fireEvent.click(screen.getAllByRole("button", { name: "Remember" }).at(-1) as HTMLElement);
	await screen.findByText("Added to Knowledge.");
	expect(mocks.saveFact).toHaveBeenCalledWith({
		applicationId: "application-1",
		text: "Mentored three junior designers",
		category: "accomplishment",
		source: { kind: "user-message", id: "u-9", quote: "I mentored three junior designers; two were promoted." },
	});
	expect(mocks.send).not.toHaveBeenCalled();
});

it("says an automatic memory is private to one application and shares it only when asked", async () => {
	mocks.updateFact.mockResolvedValue(undefined);
	const remembered = {
		id: "a-3",
		role: "assistant",
		parts: [
			{
				type: "tool-remember_fact",
				toolCallId: "r-1",
				state: "output-available",
				input: {},
				output: {
					status: "saved",
					id: "fact-2",
					fact: {
						applicationId: "application-1",
						text: "I gave a talk on design tokens.",
						category: "accomplishment",
						source: { kind: "user-message", id: "row-1", quote: "I gave a talk on design tokens." },
					},
				},
			},
		],
	} as UIMessage;
	const fact = { id: "fact-2", applicationId: "application-1", company: "Figma", status: "active", text: "x" };
	mount([remembered], "application-1", false, { ...knowledge, all: [fact] as never });
	await screen.findByText(/Remembered for/);
	fireEvent.click(screen.getByRole("button", { name: "Use for all applications" }));
	await waitFor(() => expect(mocks.updateFact).toHaveBeenCalledWith({ id: "fact-2", share: true }));
});

it("names a lost connection and offers another AI connection only for provider failures", async () => {
	mocks.send.mockRejectedValueOnce(new TypeError("Failed to fetch"));
	mount([]);
	const view = screen.getByRole("textbox", { name: "Message the coach" });
	fireEvent.change(view, { target: { value: "Hello" } });
	fireEvent.keyDown(view, { key: "Enter" });
	await screen.findByText("Couldn't reach Reactive Resume. Check your internet connection, then try again.");
	expect(screen.queryByRole("button", { name: "Change connection" })).toBeNull();
});
