import type { ChatAttachment, MessageContext } from "@/features/assistant/chat";
import type { RouterOutput } from "@/libs/orpc/client";
import type { QueryClient } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import z from "zod";
import { AGENT_ATTACHMENT_TYPES } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { supportsNativeWebSearch } from "@reactive-resume/ai/types";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { formatFileSize } from "@reactive-resume/utils/file";
import { cn } from "@reactive-resume/utils/style";
import { useSessionDraft } from "./hooks";
import { MemoryCard } from "./knowledge/facts";
import { ContextChip, useCareerTime, useNow, withQueryUndo } from "./shared";
import { attachmentErrorMessages, fileToBase64 } from "@/features/assistant/chat";
import { ChatComposer } from "@/features/assistant/chat-chrome";
import { useAttachmentRemoval } from "@/features/assistant/use-attachment-removal";
import { toastError } from "@/libs/error-message";
import { client, orpc, prepareRpc } from "@/libs/orpc/client";

// The open conversation (AI SDK, Markdown) loads once the coach is on screen, so pages that only use the helpers
// here (the workspace) don't carry it.
const loadChatView = () => import("./coach-chat");
const ChatView = lazy(() => loadChatView().then((module) => ({ default: module.ChatView })));

// ---- What a message shared: recorded on the user message when it's sent, shown as "Sent" chips under the answer. ----

export const usedSchema = z.object({
	context: z.object({
		facts: z.array(z.string()).catch([]),
		stories: z.array(z.string()).catch([]),
		preferences: z.boolean().catch(false),
		applications: z.boolean().catch(false),
		offers: z.array(z.string()).catch([]),
		web: z.boolean().catch(false),
	}),
});
export type Used = z.infer<typeof usedSchema>;

/** "Demo AI connection": the provider label, naming it a connection once. */
export const connectionName = (label: string) => (/connection$/i.test(label) ? label : t`${label} connection`);

/** Shared and switched-on facts and stories the coach sees in this scope (global coach: shared only). */
export function useCoachKnowledge(applicationId: string | null) {
	const facts = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: null, all: true } }));
	const stories = useQuery(orpc.career.stories.queryOptions({ input: { applicationId } }));
	// The query results are new objects each render; their refetch functions are not, so `retry` (and this whole
	// object) stays the same while a reply streams.
	const { refetch: refetchFacts } = facts;
	const { refetch: refetchStories } = stories;
	const all = facts.data ?? [];
	// Same order and filters as the server's career context, so the recorded ids are what was sent.
	const active = all.filter(
		(fact) => fact.status === "active" && (fact.applicationId === null || fact.applicationId === applicationId),
	);
	const usable = (stories.data ?? []).filter(
		(story) =>
			story.data.factIds.length > 0 &&
			story.data.factIds.every((id) =>
				active.some(
					(fact) =>
						fact.id === id && (fact.revisions.length === 0 || new Date(fact.updatedAt) <= new Date(story.updatedAt)),
				),
			),
	);
	return {
		loaded: facts.isSuccess && stories.isSuccess,
		/** Changes whenever Knowledge is read again, so what depends on it can be read again too. */
		updatedAt: facts.dataUpdatedAt,
		isPending: facts.isPending || stories.isPending,
		isError: facts.isError || stories.isError,
		retry: () => {
			void refetchFacts();
			void refetchStories();
		},
		all,
		active,
		stories: usable,
		allStories: stories.data ?? [],
	};
}
export type Knowledge = ReturnType<typeof useCoachKnowledge>;

export const usedFor = (knowledge: Knowledge, context: MessageContext): Used => ({
	context: {
		facts: context.memory ? knowledge.active.slice(0, 30).map((fact) => fact.id) : [],
		stories: context.memory ? knowledge.stories.slice(0, 8).map((story) => story.id) : [],
		preferences: context.memory === true,
		applications: context.application === true,
		offers: context.offerIds ?? [],
		web: context.web === true,
	},
});

// ---- Conversations, listed on Career → Coach and in the workspace sheet ----

type ThreadSummary = RouterOutput["agent"]["threads"]["list"][number];

/** New conversations are titled in English on the server until their first message. */
export const titleFor = (thread: ThreadSummary | undefined) =>
	thread && thread.title !== "New conversation" ? thread.title : t`New conversation`;

/** "Now", "17:58", "Yesterday", "Mon 5 Oct", then "28 Sep". */
export function useConversationDate() {
	const { format, time, day } = useCareerTime();
	const now = useNow();
	const dayKey = (value: Date) => format(value, { year: "numeric", month: "numeric", day: "numeric" });
	return (value: Date) => {
		const age = now.getTime() - value.getTime();
		if (age < 60_000) return t`Now`;
		if (dayKey(value) === dayKey(now)) return time(value);
		if (dayKey(value) === dayKey(new Date(now.getTime() - 86_400_000))) return t`Yesterday`;
		if (age < 6 * 86_400_000) return day(value);
		return format(value, {
			day: "numeric",
			month: "short",
			...(value.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
		});
	};
}

/**
 * Deletes a conversation when its Undo toast closes. `hide` runs at once; `restore` brings it back on Undo, or when
 * the delete fails.
 */
export function deleteConversation(queryClient: QueryClient, id: string, hide: () => void, restore: () => void) {
	withQueryUndo({
		queryClient,
		queryKey: orpc.agent.threads.list.key(),
		description: t`Conversation deleted`,
		errorMessage: t`Couldn't delete this conversation. Try again.`,
		prepare: () => prepareRpc(client.agent.threads.delete, { id }),
		hide,
		restore: () => {
			const threads = queryClient.getQueryData(orpc.agent.threads.list.queryKey());
			if (threads?.some((thread) => thread.id === id)) restore();
		},
	});
}

// ---- The thread ----

/** `attached` counts the files in the composer, which go with the message. */
export type ChatHistory = { earlier: number; withheld: number; attached: number };

export type Prompt = { text: string; attachments: ChatAttachment[]; used: Used };

type CoachThreadProps = {
	/** No thread yet: the empty state; the first message (or attachment) creates one. */
	threadId: string | null;
	createThread: () => Promise<string>;
	/** The first message created this thread; it's sent as soon as the thread opens. */
	onThreadCreated: (id: string, text: string) => void;
	/** The application this conversation is about (the workspace sheet), or null for the whole search. */
	applicationId: string | null;
	/** Workspace sheet: facts are remembered for this company only. */
	company?: string;
	context: MessageContext;
	/** "Demo AI connection". */
	connection: string;
	onChangeConnection: () => void;
	header: (messages: readonly UIMessage[]) => ReactNode;
	empty: (send: (text: string) => void) => ReactNode;
	chips?: ReactNode;
	/** Above the composer: what needs a decision before the next message (a connection that went away). */
	notice?: ReactNode;
	/** The privacy line, given how many earlier messages still go and how many Knowledge changes hold back. */
	privacy: (history: ChatHistory) => ReactNode;
	placeholder: string;
	/** Keeps the unsent draft when the thread closes (the sheet). */
	draftKey?: string;
	disabled?: boolean;
	variant: "page" | "sheet";
};

/** The coach's chat, shared by Career → Coach and the workspace sheet: messages, writing state, composer. */
export function CoachThread(props: CoachThreadProps) {
	const knowledge = useCoachKnowledge(props.applicationId);
	useEffect(() => void loadChatView(), []);
	const [prompt, setPrompt] = useState<Prompt | null>(null);
	const [starting, setStarting] = useState(false);
	const draft = useRef<string | null>(null);
	const creating = useRef<Promise<string> | null>(null);

	// A conversation exists from its first message or attachment; one created for an attachment is reused.
	const ensureThread = () => {
		if (props.threadId) return Promise.resolve(props.threadId);
		if (draft.current) return Promise.resolve(draft.current);
		creating.current ??= props
			.createThread()
			.then((id) => {
				draft.current = id;
				return id;
			})
			.finally(() => {
				creating.current = null;
			});
		return creating.current;
	};

	/** Resolves false when the conversation couldn't start, so the composer keeps the message. */
	const start = async (text: string, attachments: ChatAttachment[] = []) => {
		if (starting || props.disabled) return false;
		setStarting(true);
		try {
			const id = await ensureThread();
			setPrompt({ text, attachments, used: usedFor(knowledge, props.context) });
			draft.current = null;
			props.onThreadCreated(id, text);
			return true;
		} catch (error) {
			toastError(error, t`Couldn't start the conversation. Try again.`);
			return false;
		} finally {
			setStarting(false);
		}
	};

	if (!props.threadId)
		return (
			<div className="flex min-h-0 flex-1 flex-col">
				{props.header([])}
				<div className="min-h-0 flex-1 overflow-y-auto">
					<div className={contentClass[props.variant]}>
						<Empty render={props.empty} send={(text) => void start(text)} />
					</div>
				</div>
				<Composer
					{...props}
					privacy={(attached) => props.privacy({ earlier: 0, withheld: 0, attached })}
					streaming={starting}
					disabled={props.disabled ?? false}
					ensureThread={ensureThread}
					onSend={start}
					onStop={() => undefined}
				/>
			</div>
		);

	return (
		<ThreadSession
			key={props.threadId}
			{...props}
			threadId={props.threadId}
			knowledge={knowledge}
			prompt={prompt}
			onPromptSent={() => setPrompt(null)}
		/>
	);
}

type EmptyProps = { render: CoachThreadProps["empty"]; send: (text: string) => void };

function Empty({ render, send }: EmptyProps) {
	return render(send);
}

export const contentClass = {
	page: "mx-auto grid w-full max-w-[720px] content-start gap-6 px-6 py-6 max-sm:px-4 max-sm:py-4",
	sheet: "grid content-start gap-4 p-[18px]",
};

export type SessionProps = Omit<CoachThreadProps, "threadId"> & {
	threadId: string;
	knowledge: Knowledge;
	prompt: Prompt | null;
	onPromptSent: () => void;
};

/** Reads the conversation once when it opens (the chat takes its messages once); a new one skips the read. */
function ThreadSession(props: SessionProps) {
	const [fresh] = useState(() => props.prompt !== null);
	const thread = useQuery({
		...orpc.agent.threads.get.queryOptions({ input: { id: props.threadId } }),
		enabled: !fresh,
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
	});

	const loading = (
		<div className="flex min-h-0 flex-1 flex-col">
			{props.header([])}
			<div className="grid flex-1 place-items-center p-6 text-sm text-ink-2">
				{thread.error ? (
					<p role="alert">
						<Trans>This conversation couldn't be opened. Refresh the page to try again.</Trans>
					</p>
				) : (
					// Hidden for the first 150ms, so a quick read never flashes a spinner.
					<Spinner className="transition-opacity delay-150 duration-standard ease-enter starting:opacity-0" />
				)}
			</div>
		</div>
	);

	if (fresh)
		return (
			<Suspense fallback={loading}>
				<ChatView {...props} initialMessages={[]} activeRun={false} readOnly={false} />
			</Suspense>
		);
	if (thread.data && thread.isFetchedAfterMount)
		return (
			<Suspense fallback={loading}>
				<ChatView
					{...props}
					initialMessages={thread.data.messages}
					activeRun={Boolean(thread.data.thread.activeRunId)}
					readOnly={thread.data.isReadOnly}
				/>
			</Suspense>
		);
	return loading;
}

// ---- Composer ----

type Upload = ChatAttachment & { size: number };

type ComposerProps = Pick<CoachThreadProps, "placeholder" | "chips" | "notice" | "draftKey" | "variant"> & {
	/** The privacy line, given how many files are attached. */
	privacy: (attached: number) => ReactNode;
	streaming: boolean;
	disabled: boolean;
	ensureThread: () => Promise<string>;
	/** True once the message is on its way; false keeps it in the box. */
	onSend: (text: string, attachments: ChatAttachment[]) => boolean | Promise<boolean>;
	onStop: () => void;
};

/** A two-row box that grows to eight, with the context chips, attach and send (stop while writing). */
export function Composer(props: ComposerProps) {
	const { i18n } = useLingui();
	const draft = useSessionDraft(props.draftKey ? `coach:${props.draftKey}` : null, "", (value) =>
		typeof value === "string" ? value : undefined,
	);
	const text = draft.value;
	const setText = draft.setValue;
	const [attachments, setAttachments] = useState<Upload[]>([]);
	const removal = useAttachmentRemoval(props.draftKey ?? "draft", (id) =>
		setAttachments((current) => current.filter((item) => item.id !== id)),
	);
	const [uploading, setUploading] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);

	const submit = async () => {
		const value = text.trim();
		if (!value || props.streaming || props.disabled || uploading || removal.isPending) return;
		const sent = await props.onSend(
			value,
			attachments.map(({ size: _size, ...attachment }) => attachment),
		);
		if (!sent) return;
		setText("");
		draft.clear();
		setAttachments([]);
	};

	const upload = async (files: FileList | null) => {
		if (!files?.length) return;
		setUploading(true);
		try {
			const threadId = await props.ensureThread();
			const uploaded = await Promise.all(
				Array.from(files).map(async (file) => {
					const attachment = await client.agent.attachments.create({
						threadId,
						filename: file.name,
						mediaType: file.type || "application/octet-stream",
						data: await fileToBase64(file),
					});
					return { id: attachment.id, filename: attachment.filename, mediaType: attachment.mediaType, size: file.size };
				}),
			);
			setAttachments((current) => [...current, ...uploaded]);
		} catch (error) {
			toastError(error, t`Couldn't attach the file. Try again.`, { byCode: attachmentErrorMessages() });
		} finally {
			setUploading(false);
			if (fileInput.current) fileInput.current.value = "";
		}
	};

	const page = props.variant === "page";

	return (
		<div className={page ? "border-t border-line px-6 py-3 max-sm:px-3 max-sm:py-2" : "px-3.5 pt-2 pb-3.5"}>
			<div className={cn("grid gap-2", page && "mx-auto w-full max-w-[720px]")}>
				{props.notice}
				<ChatComposer
					label={t`Message the coach`}
					placeholder={props.placeholder}
					value={text}
					onValueChange={setText}
					disabled={props.disabled}
					sendDisabled={!text.trim() || props.disabled || uploading || removal.isPending}
					streaming={props.streaming}
					onSend={() => void submit()}
					onStop={props.onStop}
					chips={
						<>
							{props.chips}
							{attachments.map((attachment) => (
								<span
									key={attachment.id}
									className="inline-flex h-7 max-w-full items-center gap-1 rounded-sm border border-line-2 bg-sunken ps-2 text-xs font-medium"
								>
									<Icon name="paperclip" size={16} />
									<span className="truncate">
										{attachment.filename} · {formatFileSize(attachment.size, i18n.locale)}
									</span>
									<button
										type="button"
										aria-label={t`Remove ${attachment.filename}`}
										onClick={() => void removal.remove(attachment.id)}
										disabled={props.disabled || props.streaming || uploading || removal.isPending}
										className="grid size-6 place-items-center rounded-sm text-ink-3 transition-colors duration-quick hover:bg-hover hover:text-ink"
									>
										<Icon name="x" size={14} />
									</button>
								</span>
							))}
						</>
					}
					actions={
						<>
							<IconButton
								icon="paperclip"
								label={t`Attach a file`}
								size="icon-sm"
								disabled={props.disabled || uploading || removal.isPending}
								loading={uploading}
								className="text-ink-2"
								onClick={() => fileInput.current?.click()}
							/>
							<input
								ref={fileInput}
								type="file"
								multiple
								accept={[...AGENT_ATTACHMENT_TYPES, ".md", ".docx"].join(",")}
								className="hidden"
								onChange={(event) => void upload(event.target.files)}
							/>
						</>
					}
				/>
				{props.privacy(attachments.length)}
			</div>
		</div>
	);
}

// ---- Composer parts shared by Career → Coach and the workspace sheet ----

/** What the coach may keep from this message, where the user types, with the mode one tap away. */
export function MemoryNote({ knowledge }: { knowledge: boolean }) {
	const { data: profile } = useQuery(orpc.career.profile.queryOptions());
	if (!profile) return null;
	const note = !knowledge
		? t`With Knowledge off, nothing you write is remembered.`
		: {
				ask: t`The coach asks before remembering facts you state.`,
				auto: t`The coach remembers facts you state, and tells you.`,
				off: t`The coach doesn't remember anything you write.`,
			}[profile.memoryMode];
	return (
		<>
			{note}{" "}
			<Popover>
				<PopoverTrigger
					render={
						<button type="button" className="font-medium text-ink-2 underline underline-offset-2 hover:text-ink" />
					}
				>
					<Trans context="Change what the coach remembers">Change</Trans>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-[min(420px,calc(100vw-2rem))] p-2">
					<MemoryCard />
				</PopoverContent>
			</Popover>
		</>
	);
}

/** A failed configured service can still be retried through an explicitly approved native AI search. */
export function useWebSearch(provider: RouterOutput["aiProviders"]["list"][number] | undefined) {
	const status = useQuery(orpc.webAccess.status.queryOptions());
	const failure = status.data?.testResult?.search.error;
	const eligible = !!provider && supportsNativeWebSearch(provider) && (failure === "auth" || failure === "quota");
	const capabilities = useQuery({ ...orpc.ai.capabilities.queryOptions(), enabled: eligible });
	const fallbackLabel = eligible && capabilities.data?.nativeWebSearch === 1 ? provider.label : undefined;
	return { status, canSearch: status.data?.search === true || !!fallbackLabel, fallbackLabel };
}

type WebResearchChipProps = {
	fallbackLabel?: string | undefined;
	status: { data?: { search: boolean } | undefined; isPending: boolean; isError: boolean; refetch: () => unknown };
	pressed: boolean;
	onPressedChange: (pressed: boolean) => void;
};

/**
 * Web research needs a search service. Without one the chip is a way to set it up, not a switch that claims to send
 * searches anywhere; reading links the user pastes doesn't need it.
 */
export function WebResearchChip({ status, pressed, onPressedChange, fallbackLabel }: WebResearchChipProps) {
	const nativeSearchLabel = fallbackLabel ?? "";
	if (status.data?.search || fallbackLabel)
		return (
			<ContextChip
				pressed={pressed}
				onPressedChange={onPressedChange}
				label={t`Web research`}
				tooltip={
					fallbackLabel
						? t`Retry with ${nativeSearchLabel}`
						: t`Lets the coach search public pages through your web search service`
				}
				offIcon="globe-hemisphere-west"
			/>
		);
	const chip =
		"touch-target inline-flex h-7 items-center gap-1 rounded-sm border border-dashed border-line px-[9px] text-xs font-medium text-ink-3";
	if (status.isPending || status.isError)
		return (
			<Tooltip>
				<TooltipTrigger
					render={
						<button
							type="button"
							aria-disabled={status.isPending}
							onClick={() => status.isError && void status.refetch()}
							className={chip}
						/>
					}
				>
					<Icon name={status.isError ? "arrow-clockwise" : "globe-hemisphere-west"} size={16} />
					{status.isError ? t`Web research · Retry` : t`Web research`}
				</TooltipTrigger>
				<TooltipContent>
					{status.isError ? t`Couldn't check for a web search service. Retry.` : t`Checking for a web search service…`}
				</TooltipContent>
			</Tooltip>
		);
	return (
		<Tooltip>
			<TooltipTrigger render={<Link to="/dashboard/settings/ai" className={cn(chip, "hover:text-ink-2")} />}>
				<Icon name="globe-hemisphere-west" size={16} />
				<Trans>Web research · Set up</Trans>
			</TooltipTrigger>
			<TooltipContent>
				<Trans>
					Connect a search service in Settings to research the web. The coach can still read public links you paste.
				</Trans>
			</TooltipContent>
		</Tooltip>
	);
}

export async function copyToClipboard(text: string, done: string) {
	try {
		await navigator.clipboard.writeText(text);
		toast.add({ description: done });
	} catch {
		toast.add({ type: "error", description: t`Couldn't copy to the clipboard. Try again.` });
	}
}
