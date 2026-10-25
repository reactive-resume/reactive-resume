import type { Knowledge, Prompt, SessionProps, Used } from "./coach-thread";
import type { ChatAttachment } from "@/features/assistant/chat";
import type { FactCategory } from "@reactive-resume/schema/career";
import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { lastAssistantMessageIsCompleteWithToolCalls } from "ai";
import { memo, useEffect, useEffectEvent, useRef, useState } from "react";
import z from "zod";
import { agentWebSources } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { careerSourceSchema, factCategorySchema } from "@reactive-resume/schema/career";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@reactive-resume/ui/components/message-scroller";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { TraceIcon, TraceLine, TraceTitle } from "@reactive-resume/ui/components/trace";
import { cn } from "@reactive-resume/utils/style";
import { Composer, contentClass, copyToClipboard, usedFor, usedSchema } from "./coach-thread";
import { Eyebrow, MemoryProposal, Working, workingSteps } from "./shared";
import { attachmentPart } from "@/features/assistant/chat";
import { AssistantMarkdown } from "@/features/assistant/markdown";
import { useAssistantChat } from "@/features/assistant/use-assistant-chat";
import { getOrpcErrorMessage, toastError } from "@/libs/error-message";
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

type Part = { type: string; text?: string; toolCallId?: string; state?: string; output?: unknown };
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
	const { messages, sendMessage, status, error, clearError, regenerate, stop } = useAssistantChat({
		threadId,
		initialMessages: props.initialMessages,
		resume: props.activeRun,
		context: props.context,
		onFinish: refresh,
	});
	const streaming = status === "submitted" || status === "streaming";
	const last = messages.at(-1);
	const answering = status === "streaming" && last?.role === "assistant" && textOf(last) !== "";
	const readOnly = props.readOnly || props.disabled === true;

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
		if (streaming || readOnly) return false;
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
		clearError();
		if (lastAssistantMessageIsCompleteWithToolCalls({ messages })) void sendMessage();
		else void regenerate();
	};

	const stopReply = () => {
		setStopped(true);
		void client.agent.messages.stop({ threadId }).catch(() => undefined);
		void stop();
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{props.header(messages)}
			{/* Follows the reply only while the reader is at the latest message; a saved thread opens on its last question. */}
			<MessageScrollerProvider autoScroll defaultScrollPosition="last-anchor">
				<div className="relative min-h-0 flex-1">
					<MessageScroller>
						<MessageScrollerViewport aria-label={t`Conversation`}>
							{/* Announced when the answer is complete, not token by token. */}
							<MessageScrollerContent aria-busy={streaming} className={cn(contentClass[variant], "flex")}>
								{messages.length === 0 && !streaming && <MessageScrollerItem>{props.empty(send)}</MessageScrollerItem>}
								{messages.map((message, index) => (
									<MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
										<MessageView
											message={message}
											question={questionBefore(messages, index)}
											streaming={streaming && index === messages.length - 1}
											enter={!initialIds.has(message.id)}
											knowledge={knowledge}
											company={props.company}
											scoped={props.applicationId !== null}
										/>
									</MessageScrollerItem>
								))}

								{streaming && (
									<MessageScrollerItem>
										<TraceLine status="running" className={cn("text-[13px]", ENTER_CLASS)}>
											<TraceIcon>
												<Spinner decorative className="size-3" />
											</TraceIcon>
											<TraceTitle>
												{/* Until the first words arrive, say what's happening; then the answer itself shows progress. */}
												{answering ? (
													<Trans>Writing an answer…</Trans>
												) : (
													<Working
														steps={[...workingSteps("chat"), ...(props.context.web ? [t`Searching the web`] : [])]}
													/>
												)}
											</TraceTitle>
										</TraceLine>
									</MessageScrollerItem>
								)}

								{stopped && !streaming && (
									<MessageScrollerItem>
										<TraceLine>
											<TraceIcon>
												<Icon name="stop-circle" size={14} />
											</TraceIcon>
											<TraceTitle>
												<Trans>Stopped</Trans>
											</TraceTitle>
										</TraceLine>
									</MessageScrollerItem>
								)}

								{error && !streaming && (
									<MessageScrollerItem>
										<div
											role="alert"
											className="grid gap-2.5 rounded-xl bg-danger-soft p-3.5 text-[13px] text-danger-text transition-opacity duration-standard ease-enter starting:opacity-0"
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
												<Button size="sm" variant="ghost" onClick={props.onChangeConnection}>
													<Trans>Change connection</Trans>
												</Button>
											</span>
										</div>
									</MessageScrollerItem>
								)}
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
				streaming={streaming}
				disabled={readOnly}
				ensureThread={() => Promise.resolve(threadId)}
				onSend={send}
				onStop={stopReply}
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
	scoped: boolean;
};

/** Memoized: while a reply streams, only its own message re-renders; the ones above keep their props. */
const MessageView = memo(function MessageView({
	message,
	question,
	streaming,
	enter,
	knowledge,
	company,
	scoped,
}: MessageViewProps) {
	const text = textOf(message);

	if (message.role === "user") {
		const files = partsOf(message).filter((part) => part.type === "file") as Array<Part & { filename?: string }>;
		return (
			<div className={cn("grid justify-items-end gap-1", enter && ENTER_CLASS)}>
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
			</div>
		);
	}

	const parsedUsed = usedSchema.safeParse(question?.metadata);
	const used = parsedUsed.success ? parsedUsed.data.context : null;
	const sources = agentWebSources(message);
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

			{!streaming && used && <UsedChips used={used} applications={scoped ? [] : applications} knowledge={knowledge} />}

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

type UsedChipProps = { label: string; title: string; children: ReactNode };

function UsedChip({ label, title, children }: UsedChipProps) {
	return (
		<Popover>
			<PopoverTrigger
				render={
					<button
						type="button"
						className="inline-flex h-6 items-center rounded-sm border border-line-2 px-2 text-xs font-medium text-ink-2 transition-colors duration-quick hover:bg-hover hover:text-ink aria-expanded:bg-hover"
					/>
				}
			>
				{label}
			</PopoverTrigger>
			<PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
				<Eyebrow>{title}</Eyebrow>
				<ul className="grid max-h-72 gap-2 overflow-y-auto">{children}</ul>
			</PopoverContent>
		</Popover>
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
				<AutoRemembered key={item.toolCallId} id={item.id ?? ""} text={item.fact.text} knowledge={knowledge} />
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
			toastError(error, t`Couldn't remember that. Try again.`);
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

type AutoRememberedProps = { id: string; text: string; knowledge: Knowledge };

/** Memory mode Automatically: the fact is already saved, with Undo. Hidden once it's forgotten. */
function AutoRemembered({ id, text, knowledge }: AutoRememberedProps) {
	const queryClient = useQueryClient();
	const [undone, setUndone] = useState(false);
	if (undone || !knowledge.all.some((fact) => fact.id === id)) return null;

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

	return (
		<p className="flex flex-wrap items-center gap-1.5 text-sm text-ink-2">
			<Icon name="check-circle" size={18} className="text-accent-text" />
			<Trans>Remembered: “{text}”</Trans>
			<span aria-hidden="true">·</span>
			<button type="button" className="font-medium text-ink underline underline-offset-2" onClick={() => void undo()}>
				<Trans>Undo</Trans>
			</button>
		</p>
	);
}
