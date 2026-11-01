import type { Knowledge, Prompt, SessionProps, Used } from "./coach-thread";
import type { ChatAttachment } from "@/features/assistant/chat";
import type { FactCategory } from "@reactive-resume/schema/career";
import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { lastAssistantMessageIsCompleteWithApprovalResponses, lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { memo, useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import z from "zod";
import { agentWebSources, type AgentUIMessage } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { careerSourceSchema, factCategorySchema } from "@reactive-resume/schema/career";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@reactive-resume/ui/components/message-scroller";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { TraceIcon, TraceLine, TraceTitle } from "@reactive-resume/ui/components/trace";
import { cn } from "@reactive-resume/utils/style";
import { Composer, contentClass, copyToClipboard, usedFor, usedSchema } from "./coach-thread";
import { CATEGORIES, categoryLabel } from "./knowledge/facts";
import { StoryEditor } from "./knowledge/stories";
import { MemoryProposal, useCareerTime, Working, workingSteps } from "./shared";
import { attachmentPart } from "@/features/assistant/chat";
import { handToAssistant } from "@/features/assistant/handoff";
import { AssistantMarkdown } from "@/features/assistant/markdown";
import { QuestionCard } from "@/features/assistant/question-card";
import { ToolApprovals, type StoryEditorRender } from "@/features/assistant/tool-approvals";
import { useAssistantChat } from "@/features/assistant/use-assistant-chat";
import { UsedChip } from "@/features/assistant/used-chip";
import { getOrpcErrorMessage, isProviderFailure, toastError } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";
import { client, orpc } from "@/libs/orpc/client";

// The open conversation, loaded lazily by CoachThread: it carries the AI SDK and Markdown.

const rememberSchema = z.object({
	status: z.enum(["proposed", "saved", "skipped"]),
	fact: z.object({
		applicationId: z.string().nullable(),
		text: z.string(),
		category: factCategorySchema,
		source: careerSourceSchema,
	}),
	id: z.string().optional(),
});
type Remember = z.infer<typeof rememberSchema> & { toolCallId: string };

const opportunitiesSchema = z.array(z.object({ id: z.string(), company: z.string(), role: z.string() }));
const storySchema = z.object({ id: z.string(), data: z.object({ title: z.string() }) });

type Part = { type: string; text?: string; toolCallId?: string; state?: string; input?: unknown; output?: unknown };
const partsOf = (message: UIMessage) => message.parts as unknown as Part[];
const textOf = (message: UIMessage) =>
	partsOf(message)
		.flatMap((part) => (part.type === "text" && part.text ? [part.text] : []))
		.join("\n\n")
		.trim();
const outputsOf = (message: UIMessage, tool: string) =>
	partsOf(message).filter((part) => part.type === `tool-${tool}` && part.state === "output-available");

type ChatViewProps = SessionProps & { initialMessages: UIMessage[]; activeRun: boolean; readOnly: boolean };

export function ChatView(props: ChatViewProps) {
	const { threadId, knowledge, variant, connection } = props;
	const queryClient = useQueryClient();
	const [stopped, setStopped] = useState(false);
	// Messages already in the thread when it opens are history; only new ones rise in.
	const [initialIds] = useState(() => new Set(props.initialMessages.map((message) => message.id)));

	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: orpc.agent.threads.list.key() });
		// The coach may have remembered a fact or saved a story.
		void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
		void queryClient.invalidateQueries({ queryKey: orpc.career.stories.key() });
	};
	const {
		messages,
		sendMessage,
		status,
		error,
		clearError,
		regenerate,
		setMessages,
		stop,
		resuming,
		addToolOutput,
		addToolApprovalResponse,
	} = useAssistantChat({
		threadId,
		initialMessages: props.initialMessages,
		resume: props.activeRun,
		context: props.context,
		onFinish: refresh,
	});
	const streaming = status === "submitted" || status === "streaming";
	// A pending resume keeps the SDK at "ready"; lock the conversation until the replayed run starts or ends.
	const busy = streaming || resuming;
	const last = messages.at(-1);
	// What the server no longer sends (Knowledge changed) and which replies ended early, read again whenever Knowledge
	// changes; the transcript itself is the chat's own.
	const historyOptions = orpc.agent.threads.get.queryOptions({ input: { id: threadId } });
	const history = useQuery({
		...historyOptions,
		queryKey: [...historyOptions.queryKey, "history", knowledge.updatedAt],
		select: (data) => ({
			cutoffAt: data.history?.cutoffAt ?? null,
			withheld: new Set(data.history?.withheld ?? []),
			interrupted: data.interrupted ?? [],
		}),
		placeholderData: (previous) => previous,
	});
	const withheld = history.data?.withheld ?? new Set<string>();
	const lastWithheld = messages.findLast((message) => withheld.has(message.id));
	const earlier = messages.filter((message) => !withheld.has(message.id)).length;
	const answering = status === "streaming" && last?.role === "assistant" && textOf(last) !== "";
	const readOnly = props.readOnly || props.disabled === true;
	// Stable so a streaming reply doesn't re-render every message above it.
	const answer = useCallback(
		(toolCallId: string, output: string) => addToolOutput({ tool: "ask_user_question", toolCallId, output }),
		[addToolOutput],
	);

	const deliver = ({ text, attachments, used }: Prompt) => {
		const files = attachments.map(attachmentPart);
		void sendMessage(
			{ text, metadata: used, ...(files.length > 0 ? { files } : {}) },
			{ body: { attachmentIds: attachments.map((attachment) => attachment.id) } },
		);
		// The server titles the conversation from its first message.
		window.setTimeout(refresh, 1500);
	};

	const send = (text: string, attachments: ChatAttachment[] = []) => {
		if (busy || readOnly) return false;
		clearError();
		setStopped(false);
		deliver({ text, attachments, used: usedFor(knowledge, props.context) });
		return true;
	};

	// The first message of a new conversation goes out once the chat exists.
	const { prompt } = props;
	const sentPrompt = useRef(false);
	const sendPrompt = useEffectEvent((value: Prompt) => {
		props.onPromptSent();
		deliver(value);
	});
	useEffect(() => {
		if (!prompt || sentPrompt.current) return;
		sentPrompt.current = true;
		sendPrompt(prompt);
	}, [prompt]);

	// A failed continuation (after an answer) is sent again as it was; regenerating would drop the answer.
	const retry = () => {
		if (busy || readOnly) return;
		clearError();
		if (
			lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
			lastAssistantMessageIsCompleteWithApprovalResponses({ messages })
		)
			void sendMessage();
		else void regenerate();
	};

	const stopReply = async () => {
		setStopped(true);
		await Promise.all([client.agent.messages.stop({ threadId }).catch(() => undefined), stop()]);
		// The server keeps what it wrote before the stop reached it, which can be more (or less) than arrived here. Show
		// its copy once the run is settled, so Continue and Try again act on what was actually saved.
		for (let attempt = 0; attempt < 10; attempt++) {
			const saved = await client.agent.threads.get({ id: threadId }).catch(() => null);
			if (!saved) return;
			if (!saved.thread.activeRunId) {
				setMessages(saved.messages as AgentUIMessage[]);
				void history.refetch();
				return;
			}
			await new Promise((resolve) => window.setTimeout(resolve, 300));
		}
	};

	// "Edit first": the proposal opens in the story editor in place, in this conversation's scope. Saving the edited
	// story declines the proposal as it stood; Cancel goes back to the review card and keeps the edits.
	const storyEditor = ({ approvalId, story, onSaved, onCancel }: Parameters<StoryEditorRender>[0]) => (
		<StoryEditor
			story={undefined}
			facts={knowledge.all}
			proposal={{ key: `${threadId}:${approvalId}`, story, applicationId: props.applicationId }}
			onSaved={() => {
				onSaved();
				refresh();
				toast.add({ description: t`Your edited story is saved to Knowledge.` });
			}}
			onCancel={onCancel}
			onDelete={undefined}
		/>
	);

	// A reply that ended early, here or before a reload: continue what it said, or ask again if it said nothing.
	const lastReply = last?.role === "assistant" ? last : undefined;
	const endedEarly =
		!busy &&
		!error &&
		(stopped || (lastReply !== undefined && (history.data?.interrupted ?? []).includes(lastReply.id)));
	const saidSomething = lastReply !== undefined && textOf(lastReply) !== "";

	// Status rows live inside the last message's row, never as rows of their own: swapping a row (working → stopped →
	// error) makes the scroller re-anchor to the first turn it hasn't settled, which is the top of a reopened thread.
	const footer = (
		<>
			{busy && (
				<TraceLine status="running" className={cn("mt-6 text-[13px]", ENTER_CLASS)}>
					<TraceIcon>
						<Spinner decorative className="size-3" />
					</TraceIcon>
					<TraceTitle>
						{/* Until the first words arrive, say what's happening; then the answer itself shows progress. */}
						{answering ? (
							<Trans>Writing an answer…</Trans>
						) : (
							<Working steps={[...workingSteps("chat"), ...(props.context.web ? [t`Searching the web`] : [])]} />
						)}
					</TraceTitle>
				</TraceLine>
			)}

			{endedEarly && (
				<p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-2 transition-opacity duration-standard ease-enter starting:opacity-0">
					<Icon name="stop-circle" size={18} className="text-ink-3" />
					{saidSomething ? (
						<Trans>Stopped before the answer finished.</Trans>
					) : (
						<Trans>Stopped before answering.</Trans>
					)}
					{!readOnly && (
						<button
							type="button"
							className="font-medium text-ink underline underline-offset-2"
							onClick={() => (saidSomething ? send(t`Continue`) : retry())}
						>
							{saidSomething ? <Trans>Continue</Trans> : <Trans>Try again</Trans>}
						</button>
					)}
				</p>
			)}

			{error && !busy && (
				<div
					role="alert"
					className="mt-6 grid gap-2.5 rounded-xl bg-danger-soft p-3.5 text-[13px] text-danger-text transition-opacity duration-standard ease-enter starting:opacity-0"
				>
					<span className="flex gap-2">
						<Icon name="warning-circle" size={18} className="shrink-0" />
						{/* Say why when the server knows (a switched-off connection, a limit); otherwise that it didn't answer. */}
						<span>
							{getOrpcErrorMessage(error, {
								fallback: t`${connection} didn't respond.`,
								allowServerMessage: true,
							})}
						</span>
					</span>
					<span className="flex flex-wrap gap-1.5">
						<Button size="sm" variant="secondary" onClick={retry}>
							<Trans>Try again</Trans>
						</Button>
						{/* Another connection can't fix a lost network or this server's own refusal. */}
						{isProviderFailure(error) && (
							<Button size="sm" variant="ghost" onClick={props.onChangeConnection}>
								<Trans>Change connection</Trans>
							</Button>
						)}
					</span>
				</div>
			)}
		</>
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{props.header(messages)}
			{/* Follows the reply only while the reader is at the latest message; a saved thread opens on its last question. */}
			<MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
				<div className="relative min-h-0 flex-1">
					<MessageScroller>
						<MessageScrollerViewport aria-label={t`Conversation`}>
							{/* Announced when the answer is complete, not token by token. */}
							<MessageScrollerContent aria-busy={busy} className={cn(contentClass[variant], "flex")}>
								{messages.length === 0 && (
									<MessageScrollerItem>
										{!busy && props.empty(send)}
										{footer}
									</MessageScrollerItem>
								)}
								{messages.map((message, index) => (
									<MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
										<MessageView
											message={message}
											question={questionBefore(messages, index)}
											streaming={busy && index === messages.length - 1}
											enter={!initialIds.has(message.id)}
											knowledge={knowledge}
											company={props.company}
											applicationId={props.applicationId}
											readOnly={readOnly || index !== messages.length - 1}
											onAnswer={answer}
										/>
										<ToolApprovals
											message={message}
											disabled={readOnly || busy || index !== messages.length - 1}
											facts={knowledge.all}
											storyEditor={storyEditor}
											onDecision={(decision) => {
												void addToolApprovalResponse(decision);
											}}
										/>
										{message === lastWithheld && <HistoryCutoff cutoffAt={history.data?.cutoffAt ?? null} />}
										{index === messages.length - 1 && footer}
									</MessageScrollerItem>
								))}
							</MessageScrollerContent>
						</MessageScrollerViewport>
						<MessageScrollerButton>
							<Icon name="arrow-down" size={16} />
							<Trans>Latest</Trans>
						</MessageScrollerButton>
					</MessageScroller>
				</div>
			</MessageScrollerProvider>

			<Composer
				{...props}
				privacy={props.privacy({ earlier, withheld: messages.length - earlier })}
				streaming={busy}
				disabled={readOnly}
				ensureThread={() => Promise.resolve(threadId)}
				onSend={send}
				onStop={() => void stopReply()}
			/>
		</div>
	);
}

/** The user message this answer replies to. */
const questionBefore = (messages: readonly UIMessage[], index: number) =>
	messages.slice(0, index).findLast((message) => message.role === "user");

// ---- One message ----

type MessageViewProps = {
	message: UIMessage;
	/** The user message before this answer, which records what it shared. */
	question: UIMessage | undefined;
	streaming: boolean;
	enter: boolean;
	knowledge: Knowledge;
	company: string | undefined;
	/** About one application: its facts are private to it, and the application itself is implied. */
	applicationId: string | null;
	readOnly: boolean;
	onAnswer: (toolCallId: string, answer: string) => void;
};

/** Memoized: while a reply streams, only its own message re-renders; the ones above keep their props. */
const MessageView = memo(function MessageView({
	message,
	question,
	streaming,
	enter,
	knowledge,
	company,
	applicationId,
	readOnly,
	onAnswer,
}: MessageViewProps) {
	const text = textOf(message);
	const scoped = applicationId !== null;

	if (message.role === "user") {
		const files = partsOf(message).filter((part) => part.type === "file") as Array<Part & { filename?: string }>;
		return (
			<div className={cn("group/message grid justify-items-end gap-1", enter && ENTER_CLASS)}>
				{text && (
					<p className="max-w-[80%] rounded-lg bg-sunken px-3.5 py-2.5 text-sm leading-[21px] whitespace-pre-wrap">
						{text}
					</p>
				)}
				{files.map((file, index) => (
					<span key={index} className="flex items-center gap-1 rounded-sm bg-sunken px-2 py-1 text-xs text-ink-2">
						<Icon name="paperclip" size={14} />
						{file.filename ?? t`Attachment`}
					</span>
				))}
				{text && !streaming && <RememberMessage message={message} applicationId={applicationId} company={company} />}
			</div>
		);
	}

	const parsedUsed = usedSchema.safeParse(question?.metadata);
	const used = parsedUsed.success ? parsedUsed.data.context : null;
	const sources = agentWebSources(message);
	const questions = partsOf(message).filter((part) => part.type === "tool-ask_user_question");
	const stories = outputsOf(message, "save_story").flatMap((part) => {
		const parsed = storySchema.safeParse(part.output);
		return parsed.success ? [parsed.data] : [];
	});
	const applications = outputsOf(message, "list_opportunities").flatMap((part) => {
		const parsed = opportunitiesSchema.safeParse(part.output);
		return parsed.success ? parsed.data : [];
	});

	return (
		<div className={cn("grid min-w-0 gap-3", enter && ENTER_CLASS)}>
			{text && (
				// min-w-0 lets a wide table scroll inside its own box instead of stretching the column.
				<div className="min-w-0 text-[15px] text-ink">
					<AssistantMarkdown text={text} />
				</div>
			)}

			{questions.map((part, index) => (
				<QuestionCard
					key={part.toolCallId ?? index}
					part={part}
					readOnly={readOnly}
					busy={streaming}
					onAnswer={onAnswer}
				/>
			))}

			{sources.length > 0 && (
				<div className="grid gap-1 text-xs">
					<span className="font-medium text-ink-3">
						<Trans>Sources</Trans>
					</span>
					{sources.map((source) => (
						<a
							key={source.url}
							href={source.url}
							target="_blank"
							rel="noreferrer"
							className="truncate text-accent-text underline underline-offset-2"
						>
							{source.title?.trim() || source.url}
						</a>
					))}
				</div>
			)}

			{/* An answer that never came used nothing; a stopped one still shows what it was given. */}
			{!streaming && used && (text || stories.length > 0) && (
				<UsedChips used={used} applications={scoped ? [] : applications} knowledge={knowledge} />
			)}

			{stories.map((story) => (
				<p key={story.id} className="flex flex-wrap items-center gap-1.5 text-sm text-accent-text">
					<Icon name="check-circle" size={18} />
					<Trans>Saved a story: {story.data.title}</Trans>
					<Link
						to="/dashboard/career/knowledge/stories/{-$storyId}"
						params={{ storyId: story.id }}
						className="underline underline-offset-2"
					>
						<Trans>View</Trans>
					</Link>
				</p>
			))}

			{!streaming && <MemoryNotes message={message} knowledge={knowledge} company={company} />}

			{!streaming && text && (
				<div className="flex gap-1">
					<Button
						size="sm"
						variant="ghost"
						className="text-ink-2"
						onClick={() => void copyToClipboard(text, t`Answer copied`)}
					>
						<Icon name="copy" size={16} />
						<Trans>Copy</Trans>
					</Button>
					<AddToResume text={text} applicationId={applicationId} company={company} />
				</div>
			)}
		</div>
	);
});

// ---- "Used": what was shared for this answer, each group opening the exact items ----

type UsedChipsProps = {
	used: Used["context"];
	applications: z.infer<typeof opportunitiesSchema>;
	knowledge: Knowledge;
};

function UsedChips({ used, applications, knowledge }: UsedChipsProps) {
	const chips: ReactNode[] = [];
	const linkClass = "text-[13px] leading-[19px] text-ink hover:underline underline-offset-2";

	if (used.facts.length > 0)
		chips.push(
			<UsedChip key="facts" label={plural(used.facts.length, { one: "# fact", other: "# facts" })} title={t`Facts`}>
				{used.facts.map((id) => {
					const fact = knowledge.all.find((item) => item.id === id);
					return (
						<li key={id}>
							{fact ? (
								<Link to="/dashboard/career/knowledge/facts" search={{ highlight: id }} className={linkClass}>
									{fact.text}
								</Link>
							) : (
								<span className="text-[13px] text-ink-3">
									<Trans>A fact you've since forgotten</Trans>
								</span>
							)}
						</li>
					);
				})}
			</UsedChip>,
		);
	if (used.stories.length > 0)
		chips.push(
			<UsedChip
				key="stories"
				label={plural(used.stories.length, { one: "# story", other: "# stories" })}
				title={t`Stories`}
			>
				{used.stories.map((id) => {
					const story = knowledge.allStories.find((item) => item.id === id);
					return (
						<li key={id}>
							{story ? (
								<Link
									to="/dashboard/career/knowledge/stories/{-$storyId}"
									params={{ storyId: id }}
									className={linkClass}
								>
									{story.data.title}
								</Link>
							) : (
								<span className="text-[13px] text-ink-3">
									<Trans>A story you've since deleted</Trans>
								</span>
							)}
						</li>
					);
				})}
			</UsedChip>,
		);
	if (used.preferences)
		chips.push(
			<UsedChip
				key="preferences"
				label={t({
					message: "Preferences",
					context: "Career preferences: the roles, places, pay and ways of working you want",
				})}
				title={t({
					message: "Preferences",
					context: "Career preferences: the roles, places, pay and ways of working you want",
				})}
			>
				<PreferencesList />
			</UsedChip>,
		);
	if (applications.length > 0)
		chips.push(
			<UsedChip
				key="applications"
				label={plural(applications.length, { one: "# application", other: "# applications" })}
				title={t`Applications`}
			>
				{applications.map((application) => (
					<li key={application.id}>
						<Link
							to="/dashboard/applications/$applicationId/{-$tab}"
							params={{ applicationId: application.id }}
							className={linkClass}
						>
							{application.company} · {application.role}
						</Link>
					</li>
				))}
			</UsedChip>,
		);
	if (used.offers.length > 0)
		chips.push(
			<UsedChip
				key="offers"
				label={plural(used.offers.length, { one: "# saved offer", other: "# saved offers" })}
				title={t`Saved offers`}
			>
				<OffersList ids={used.offers} className={linkClass} />
			</UsedChip>,
		);

	if (chips.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<span className="me-0.5 text-xs text-ink-3">
				<Trans>Used</Trans>
			</span>
			{chips}
		</div>
	);
}

function PreferencesList() {
	const { data: profile } = useQuery(orpc.career.profile.queryOptions());
	if (!profile)
		return (
			<li>
				<Spinner />
			</li>
		);
	const rows = [
		{ label: t`Roles`, value: profile.targetRoles.join(", ") },
		{ label: t`Locations`, value: profile.locations.join(", ") },
		{ label: t`What matters`, value: profile.priorities },
	].filter((row) => row.value);
	return (
		<>
			{rows.map((row) => (
				<li key={row.label} className="grid gap-0.5 text-[13px] leading-[19px]">
					<span className="text-xs text-ink-3">{row.label}</span>
					<span className="line-clamp-3">{row.value}</span>
				</li>
			))}
			<li>
				<Link
					to="/dashboard/career/knowledge/preferences"
					className="text-[13px] text-accent-text underline underline-offset-2"
				>
					<Trans>Open preferences</Trans>
				</Link>
			</li>
		</>
	);
}

function OffersList({ ids, className }: { ids: string[]; className: string }) {
	const { data } = useQuery(orpc.career.savedItems.queryOptions({ input: { kind: "offer" } }));
	if (!data)
		return (
			<li>
				<Spinner />
			</li>
		);
	return (
		<>
			{ids.map((id) => {
				const offer = data.find((item) => item.id === id);
				return (
					<li key={id}>
						<Link to="/dashboard/career/offers" className={className}>
							{offer?.application ? `${offer.application.company} · ${offer.application.role}` : t`A saved offer`}
						</Link>
					</li>
				);
			})}
		</>
	);
}

// ---- Memory: one proposal per answer; automatic saves can be undone ----

const dismissedKey = (toolCallId: string) => `career-memory-dismissed:${toolCallId}`;
const isDismissed = (toolCallId: string) => {
	try {
		return localStorage.getItem(dismissedKey(toolCallId)) === "1";
	} catch {
		return false;
	}
};

type MemoryNotesProps = { message: UIMessage; knowledge: Knowledge; company: string | undefined };

function MemoryNotes({ message, knowledge, company }: MemoryNotesProps) {
	const remembers = outputsOf(message, "remember_fact").flatMap((part): Remember[] => {
		const parsed = rememberSchema.safeParse(part.output);
		return parsed.success && part.toolCallId ? [{ ...parsed.data, toolCallId: part.toolCallId }] : [];
	});
	const proposed = remembers.filter((item) => item.status === "proposed");
	const saved = remembers.filter((item) => item.status === "saved" && item.id);
	// Nothing until the facts are known, so a remembered fact never flashes as a question.
	if (!knowledge.loaded || remembers.length === 0) return null;
	return (
		<>
			{proposed.length > 0 && <Proposal items={proposed} knowledge={knowledge} company={company} />}
			{saved.map((item) => (
				<AutoRemembered
					key={item.toolCallId}
					id={item.id ?? ""}
					text={item.fact.text}
					knowledge={knowledge}
					company={company}
				/>
			))}
		</>
	);
}

const addedAs = (category: FactCategory) =>
	({
		accomplishment: t`Added to Knowledge as an accomplishment.`,
		experience: t`Added to Knowledge as an experience.`,
		skill: t`Added to Knowledge as a skill.`,
		preference: t`Added to Knowledge as a preference.`,
	})[category];

type ProposalProps = { items: Remember[]; knowledge: Knowledge; company: string | undefined };

function Proposal({ items, knowledge, company }: ProposalProps) {
	const queryClient = useQueryClient();
	const [saved, setSaved] = useState<{ ids: string[]; category: FactCategory } | null>(null);
	const [dismissed, setDismissed] = useState(() => items.every((item) => isDismissed(item.toolCallId)));
	const [busy, setBusy] = useState(false);
	const [forgotten, setForgotten] = useState(false);

	// Remembered earlier (a reload): Knowledge has a fact quoted from the same message.
	const matched = knowledge.all.filter((fact) =>
		items.some(
			(item) =>
				fact.source.kind === "user-message" && fact.source.id === item.fact.source.id && fact.text === item.fact.text,
		),
	);
	const remembered =
		saved ??
		(matched[0] ? { ids: matched.map((fact) => fact.id), category: items[0]?.fact.category ?? "preference" } : null);

	const remember = async (selected: number[]) => {
		setBusy(true);
		try {
			const chosen = selected.flatMap((index) => (items[index] ? [items[index]] : []));
			const rows = await Promise.all(chosen.map((item) => client.career.saveFact(item.fact)));
			const ids = rows.flatMap((row) => (row ? [row.id] : []));
			// Nothing saved: each fact's source was forgotten, and forgotten stays forgotten.
			if (ids.length === 0) setForgotten(true);
			else setSaved({ ids, category: chosen[0]?.fact.category ?? "preference" });
			void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
		} catch (error) {
			// The server's reason (the quote isn't in the message, it's gone) says more than "try again".
			toastError(error, t`Couldn't remember that. Try again.`, { allowServerMessage: true });
		} finally {
			setBusy(false);
		}
	};

	const dismiss = () => {
		try {
			for (const item of items) localStorage.setItem(dismissedKey(item.toolCallId), "1");
		} catch {
			// Not now still applies until the page reloads.
		}
		setDismissed(true);
	};

	const first = remembered?.ids[0];
	if (forgotten)
		return (
			<p className="flex items-center gap-1.5 text-sm text-ink-3">
				<Icon name="info" size={18} />
				<Trans>Not saved — this fact was forgotten before.</Trans>
			</p>
		);
	return (
		<MemoryProposal
			question={
				company
					? t`Remember for ${company} only?`
					: items.length > 1
						? plural(items.length, { one: "Remember # fact?", other: "Remember # facts?" })
						: t`Remember this for future coaching?`
			}
			facts={items.map((item) => item.fact.text)}
			state={remembered ? "remembered" : dismissed ? "dismissed" : "pending"}
			busy={busy}
			remembered={
				<>
					{company
						? t`Saved to Knowledge, private to this application.`
						: remembered && remembered.ids.length > 1
							? plural(remembered.ids.length, {
									one: "Added # fact to Knowledge.",
									other: "Added # facts to Knowledge.",
								})
							: addedAs(remembered?.category ?? "preference")}
					{first && (
						<Link
							to="/dashboard/career/knowledge/facts"
							search={{ highlight: first }}
							className="underline underline-offset-2"
						>
							<Trans>View</Trans>
						</Link>
					)}
				</>
			}
			onRemember={(selected) => void remember(selected)}
			onDismiss={dismiss}
		/>
	);
}

type AutoRememberedProps = { id: string; text: string; knowledge: Knowledge; company: string | undefined };

/**
 * Memory mode Automatically: the fact is already saved, with Undo. A fact remembered in a job's workspace is private
 * to that job until the user chooses to use it for all applications. Hidden once it's forgotten.
 */
function AutoRemembered({ id, text, knowledge, company }: AutoRememberedProps) {
	const queryClient = useQueryClient();
	const [undone, setUndone] = useState(false);
	const [sharing, setSharing] = useState(false);
	const fact = knowledge.all.find((item) => item.id === id);
	if (undone || !fact) return null;

	const undo = async () => {
		setUndone(true);
		try {
			await client.career.forgetFact({ id });
			void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
		} catch (error) {
			setUndone(false);
			toastError(error, t`Couldn't undo that. Try again.`);
		}
	};

	const share = async () => {
		setSharing(true);
		try {
			await client.career.updateFact({ id, share: true });
			await queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
		} catch (error) {
			toastError(error, t`Couldn't share that fact. Try again.`, { allowServerMessage: true });
		} finally {
			setSharing(false);
		}
	};

	const name = company ?? fact.company;
	return (
		<p className="flex flex-wrap items-center gap-1.5 text-sm text-ink-2">
			<Icon name="check-circle" size={18} className="text-accent-text" />
			{fact.applicationId !== null && name ? (
				<Trans>
					Remembered for {name} only: “{text}”
				</Trans>
			) : (
				<Trans>Remembered: “{text}”</Trans>
			)}
			{fact.applicationId !== null && (
				<>
					<span aria-hidden="true">·</span>
					<button
						type="button"
						disabled={sharing}
						className="font-medium text-ink underline underline-offset-2 disabled:opacity-60"
						onClick={() => void share()}
					>
						<Trans>Use for all applications</Trans>
					</button>
				</>
			)}
			<span aria-hidden="true">·</span>
			<button type="button" className="font-medium text-ink underline underline-offset-2" onClick={() => void undo()}>
				<Trans>Undo</Trans>
			</button>
		</p>
	);
}

// ---- Remember a message on demand, in any memory mode: the user reviews the words, kind and scope first ----

type RememberMessageProps = { message: UIMessage; applicationId: string | null; company: string | undefined };

function RememberMessage({ message, applicationId, company }: RememberMessageProps) {
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const [state, setState] = useState<"idle" | "saving" | "saved" | "forgotten">("idle");
	// The quote is the message's own words as the server saved them: its first text, verbatim.
	const quote = (partsOf(message).find((part) => part.type === "text")?.text ?? "").trim().slice(0, 4000);
	const [text, setText] = useState(() => quote.slice(0, 2000));
	const [category, setCategory] = useState<FactCategory>("accomplishment");
	const [onlyHere, setOnlyHere] = useState(true);
	if (!quote) return null;

	const save = async () => {
		setState("saving");
		try {
			const fact = await client.career.saveFact({
				applicationId: applicationId && onlyHere ? applicationId : null,
				text: text.trim(),
				category,
				source: { kind: "user-message", id: message.id, quote },
			});
			setState(fact ? "saved" : "forgotten");
			setOpen(false);
			void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
		} catch (error) {
			setState("idle");
			toastError(error, t`Couldn't remember that. Try again.`, { allowServerMessage: true });
		}
	};

	if (state === "saved" || state === "forgotten")
		return (
			<p className="flex items-center gap-1.5 text-xs text-ink-3">
				<Icon name={state === "saved" ? "check-circle" : "info"} size={15} />
				{state === "saved" ? (
					<Trans>Added to Knowledge.</Trans>
				) : (
					<Trans>Not saved — this fact was forgotten before.</Trans>
				)}
			</p>
		);
	if (!open)
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-ink-3 opacity-0 transition-opacity duration-quick group-hover/message:opacity-100 hover:text-ink focus-visible:opacity-100 pointer-coarse:opacity-100"
			>
				<Icon name="bookmark-simple" size={14} />
				<Trans>Remember</Trans>
			</button>
		);
	return (
		<form
			className="grid w-full max-w-[80%] gap-2 rounded-lg border border-line bg-raised p-3 text-start"
			onSubmit={(event) => {
				event.preventDefault();
				if (text.trim() && state !== "saving") void save();
			}}
		>
			<div className="grid gap-1">
				<label htmlFor={`${message.id}-remember`} className="text-xs font-medium text-ink-2">
					<Trans>Remember as a fact in Knowledge</Trans>
				</label>
				<Textarea
					id={`${message.id}-remember`}
					value={text}
					maxLength={2000}
					onChange={(event) => setText(event.target.value)}
					className="min-h-[64px] px-3 py-2 text-sm text-ink pointer-coarse:text-base"
				/>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<NativeSelect
					aria-label={t`Fact type`}
					value={category}
					onChange={(event) => setCategory(event.target.value as FactCategory)}
					className="h-8 w-auto text-[13px]"
				>
					{CATEGORIES.map((option) => (
						<option key={option} value={option}>
							{categoryLabel(option)}
						</option>
					))}
				</NativeSelect>
				{applicationId && company && (
					<label className="flex items-center gap-1.5 text-xs text-ink-2">
						<Checkbox checked={onlyHere} onCheckedChange={(checked) => setOnlyHere(checked === true)} />
						<Trans>Only for {company}</Trans>
					</label>
				)}
			</div>
			<p className="text-xs text-ink-3">
				<Trans>Saved from your message as you wrote it. Nothing is sent to the AI.</Trans>
			</p>
			<div className="flex gap-1.5">
				<Button type="submit" size="sm" loading={state === "saving"} disabled={!text.trim()}>
					<Trans>Remember</Trans>
				</Button>
				<Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
					<Trans>Cancel</Trans>
				</Button>
			</div>
		</form>
	);
}

// ---- Hand an answer to a resume's assistant: it proposes the edits there, for review ----

type AddToResumeProps = { text: string; applicationId: string | null; company: string | undefined };

/**
 * Opens a resume's assistant with the answer in its message box, unsent. In a job's workspace, that job's copies come
 * first. The text is handed over in memory for this account and resume, never in the URL.
 */
function AddToResume({ text, applicationId, company }: AddToResumeProps) {
	const navigate = useNavigate();
	const { session } = useRouteContext({ strict: false });
	const { data } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const resumes = (data ?? []).filter((document) => document.type === "resume" && !document.isLocked);
	const forJob = applicationId ? resumes.filter((resume) => resume.application?.id === applicationId) : [];
	const others = resumes.filter((resume) => !forJob.includes(resume));
	const userId = session?.user.id;
	if (resumes.length === 0 || !userId) return null;
	const ask = t`Add this to my resume where it fits. Propose the edits for me to review:\n\n${text}`.slice(0, 2000);
	const open = (resumeId: string) => {
		handToAssistant(userId, resumeId, ask);
		void navigate({ to: "/builder/$resumeId", params: { resumeId } });
	};
	const item = (resume: (typeof resumes)[number]) => (
		<DropdownMenuItem key={resume.id} onClick={() => open(resume.id)}>
			<span className="truncate">{resume.name}</span>
		</DropdownMenuItem>
	);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button size="sm" variant="ghost" className="text-ink-2" />}>
				<Icon name="file-plus" size={16} />
				<Trans>Add to resume</Trans>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-64">
				{forJob.length > 0 && (
					<DropdownMenuGroup>
						<DropdownMenuLabel>{company ? t`Copies for ${company}` : t`Copies for this job`}</DropdownMenuLabel>
						{forJob.map(item)}
					</DropdownMenuGroup>
				)}
				{others.length > 0 && (
					<DropdownMenuGroup>
						<DropdownMenuLabel>
							<Trans>Open in the resume's assistant</Trans>
						</DropdownMenuLabel>
						{others.map(item)}
					</DropdownMenuGroup>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// ---- Knowledge changed: earlier messages no longer go to the AI ----

function HistoryCutoff({ cutoffAt }: { cutoffAt: Date | null }) {
	const { when } = useCareerTime();
	return (
		<TraceLine className="mt-6 text-[13px] text-ink-2">
			<TraceIcon>
				<Icon name="eye-slash" size={14} />
			</TraceIcon>
			<TraceTitle>
				{cutoffAt
					? t`Knowledge changed on ${when(cutoffAt)}. Messages above aren't sent to the AI anymore, so it won't remember them. Start a new conversation to keep context together.`
					: t`Messages above aren't sent to the AI anymore, so it won't remember them. Start a new conversation to keep context together.`}
			</TraceTitle>
		</TraceLine>
	);
}
