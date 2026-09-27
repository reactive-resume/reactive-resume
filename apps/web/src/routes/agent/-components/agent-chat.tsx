import type { AgentUIMessage } from "@reactive-resume/ai/tools/agent-tool-contracts";
import type { UIMessage } from "ai";
import type * as React from "react";
import type { RouterOutput } from "@/libs/orpc/client";
import type { PatchApprovalResponse } from "./patch-approval-card";
import { useChat } from "@ai-sdk/react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { eventIteratorToUnproxiedDataStream } from "@orpc/client";
import {
	ArchiveIcon,
	ArrowClockwiseIcon,
	ClockCounterClockwiseIcon,
	CopyIcon,
	DotsThreeVerticalIcon,
	FileIcon,
	PaperclipIcon,
	PaperPlaneRightIcon,
	SidebarSimpleIcon,
	SparkleIcon,
	SquaresFourIcon,
	StopIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	lastAssistantMessageIsCompleteWithApprovalResponses,
	lastAssistantMessageIsCompleteWithToolCalls,
	parseJsonEventStream,
	uiMessageChunkSchema,
} from "ai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { agentMessageMetadataSchema } from "@reactive-resume/ai/tools/agent-tool-contracts";
import {
	Attachment,
	AttachmentContent,
	AttachmentGroup,
	AttachmentMedia,
	AttachmentTitle,
} from "@reactive-resume/ui/components/attachment";
import { Bubble, BubbleContent } from "@reactive-resume/ui/components/bubble";
import { Button } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle } from "@reactive-resume/ui/components/empty";
import { Marker, MarkerContent, MarkerIcon } from "@reactive-resume/ui/components/marker";
import { Message, MessageContent } from "@reactive-resume/ui/components/message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@reactive-resume/ui/components/message-scroller";
import {
	Questionnaire,
	QuestionnaireActions,
	QuestionnaireChoice,
	QuestionnaireChoices,
	QuestionnaireError,
	QuestionnaireInput,
	QuestionnaireItem,
	QuestionnaireSubmit,
	QuestionnaireTitle,
} from "@reactive-resume/ui/components/questionnaire";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { useConfirm } from "@/hooks/use-confirm";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc, streamClient } from "@/libs/orpc/client";
import { attachmentIdsFromTransportBody, buildAgentChatSubmission } from "../-helpers/chat-attachments";
import { OperationRow, PatchApprovalCard } from "./patch-approval-card";
import { ToolPartCard } from "./tool-part-card";

type AgentThreadDetail = RouterOutput["agent"]["threads"]["get"];
type AgentAction = AgentThreadDetail["actions"][number];
type AgentAttachment = AgentThreadDetail["attachments"][number];
type PatchOperation = AgentAction["operations"][number];

type PatchToolCardProps = {
	part: UIMessage["parts"][number];
	action: AgentAction | undefined;
	onRevert: (actionId: string) => void;
	isReverting: boolean;
};

type StarterPromptMarqueeProps = {
	onSelect: (prompt: string) => void;
};

type AssistantMarkdownProps = {
	text: string;
};

type FileAttachmentProps = {
	filename?: string | null;
	mediaType?: string | null;
	state?: "idle" | "uploading" | "processing" | "error" | "done";
};

type AskUserQuestionProps = {
	part: UIMessage["parts"][number];
	answer: string | null;
	disabled?: boolean;
	onAnswer: (toolCallId: string, answer: string) => void;
};

type MessagePartProps = {
	part: UIMessage["parts"][number];
	isUser: boolean;
	isReadOnly: boolean;
	onAnswer: (toolCallId: string, answer: string) => void;
	onApprovalRespond: (response: PatchApprovalResponse) => void;
	onRevert: (actionId: string) => void;
	isReverting: boolean;
	actionsById: Map<string, AgentAction>;
};

type ChatMessageProps = {
	message: UIMessage;
	isReadOnly: boolean;
	onAnswer: (toolCallId: string, answer: string) => void;
	onApprovalRespond: (response: PatchApprovalResponse) => void;
	onRevert: (actionId: string) => void;
	isReverting: boolean;
	actionsById: Map<string, AgentAction>;
};

export type AgentChatProps = {
	threadId: string;
	initialMessages: UIMessage[];
	isReadOnly: boolean;
	readOnlyReason: "archived" | "missing" | null;
	threadStatus: string;
	reviewPatches: boolean;
	activeRunId: string | null;
	actions: AgentAction[];
	onToggleThreads?: () => void;
	onToggleResume?: () => void;
	onClose?: () => void;
};

type AgentChatReadOnlyBannerProps = {
	isReadOnly: boolean;
	readOnlyReason: "archived" | "missing" | null;
};

type AgentChatMessagesProps = {
	actionsById: Map<string, AgentAction>;
	error: Error | undefined;
	isReadOnly: boolean;
	isReverting: boolean;
	isStreaming: boolean;
	messages: UIMessage[];
	onAnswer: (toolCallId: string, answer: string) => void;
	onApprovalRespond: (response: PatchApprovalResponse) => void;
	onRevert: (actionId: string) => void;
	onRetry: () => void;
	onStarterSelect: (prompt: string) => void;
};

type AgentChatHeaderProps = {
	isArchived: boolean;
	isArchivePending: boolean;
	isDeletePending: boolean;
	isUpdatePending: boolean;
	isStreaming: boolean;
	reviewPatches: boolean;
	threadTokenTotal: number;
	onArchive: () => void;
	onCopyConversation: () => void;
	onCopyConversationJson: () => void;
	onDelete: () => void;
	onClose?: () => void;
	onToggleResume?: () => void;
	onToggleReviewPatches: (reviewPatches: boolean) => void;
	onToggleThreads?: () => void;
};

type AgentChatComposerProps = {
	fileInputRef: React.RefObject<HTMLInputElement | null>;
	input: string;
	isReadOnly: boolean;
	isStreaming: boolean;
	isUploading: boolean;
	pendingAttachments: Array<Pick<AgentAttachment, "filename" | "id" | "mediaType">>;
	onInputChange: (value: string) => void;
	onSend: () => void;
	onStopRun: () => void;
	onUploadFiles: (files: FileList | null) => void;
};

const ANSWER_FIELD = "answer";

const OMITTED_RESUME_DATA = "[resume data omitted]";

// "Copy JSON" is for sharing/debugging a conversation; the full resume document embedded in every
// read_resume result (`output.data`) and fresh-document patch result (`output.resume`) would make
// the export enormous and repetitive. Strip those two payloads; everything else copies verbatim.
export function withoutResumeDataForExport(messages: UIMessage[]): UIMessage[] {
	return messages.map((message) => ({
		...message,
		parts: message.parts.map((part) => {
			if (part.type !== "tool-read_resume" && part.type !== "tool-apply_resume_patch") return part;

			const output = "output" in part && typeof part.output === "object" && part.output ? part.output : null;
			if (!output) return part;
			const outputRecord = output as Record<string, unknown>;

			if (part.type === "tool-read_resume" && "data" in outputRecord) {
				return { ...part, output: { ...outputRecord, data: OMITTED_RESUME_DATA } } as UIMessage["parts"][number];
			}
			if (part.type === "tool-apply_resume_patch" && "resume" in outputRecord) {
				return { ...part, output: { ...outputRecord, resume: OMITTED_RESUME_DATA } } as UIMessage["parts"][number];
			}

			return part;
		}),
	}));
}

function toRecord(value: unknown) {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function PatchToolCard({ part, action, onRevert, isReverting }: PatchToolCardProps) {
	const partRecord = part as Record<string, unknown>;
	const state = typeof partRecord.state === "string" ? partRecord.state : null;
	const input = toRecord(partRecord.input);
	const output = toRecord(partRecord.output);
	const actionId =
		state === "output-available"
			? (action?.id ?? (typeof output?.actionId === "string" ? output.actionId : null))
			: null;

	const title =
		action?.title ??
		(typeof output?.title === "string" ? output.title : null) ??
		(typeof input?.title === "string" ? input.title : t`Resume patch`);
	const operations: PatchOperation[] =
		action?.operations ??
		(Array.isArray(output?.operations)
			? (output.operations as PatchOperation[])
			: Array.isArray(input?.operations)
				? (input.operations as PatchOperation[])
				: []);
	const status = action?.status ?? "applied";
	const revertMessage = action?.revertMessage ?? null;
	const label =
		state === "output-error"
			? t`Patch failed`
			: state !== "output-available"
				? t`Patch pending`
				: status === "rolled_back" || status === "reverted"
					? t`Patch rolled back`
					: status === "conflicted"
						? t`Patch conflicted`
						: t`Patch applied`;
	const canRollback = action?.canRollback ?? (Boolean(actionId) && status === "applied");
	const revertDisabled =
		isReverting || !canRollback || status === "rolled_back" || status === "reverted" || status === "conflicted";
	const errorText = typeof partRecord.errorText === "string" ? partRecord.errorText : null;
	const rawPayload = JSON.stringify(
		{
			state,
			input,
			...(partRecord.rawInput !== undefined ? { rawInput: partRecord.rawInput } : {}),
			output,
			...(errorText ? { errorText } : {}),
			...(action ? { action } : {}),
			operations,
		},
		null,
		2,
	);

	return (
		<details className="group text-muted-foreground text-xs">
			<summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-md py-1 font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
				<span>{label}</span>
				<span className="text-muted-foreground/70 group-open:hidden">{title}</span>
			</summary>

			<div className="mt-2 space-y-2 rounded-md border bg-muted/20 p-3">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<p className="truncate font-medium text-foreground">{title}</p>
						{status === "conflicted" && revertMessage ? (
							<p className="mt-1 text-amber-600 dark:text-amber-300">{revertMessage}</p>
						) : null}
						{status === "rolled_back" && revertMessage ? (
							<p className="mt-1 text-muted-foreground">{revertMessage}</p>
						) : null}
						{errorText ? <p className="mt-1 text-rose-500">{errorText}</p> : null}
					</div>
					{actionId ? (
						<Button size="xs" variant="ghost" disabled={revertDisabled} onClick={() => onRevert(actionId)}>
							<ClockCounterClockwiseIcon />
							<Trans>Restore</Trans>
						</Button>
					) : null}
				</div>
				{operations.length > 0 ? (
					<ul className="max-h-48 space-y-1 overflow-auto rounded border bg-background p-2">
						{operations.map((operation, index) => (
							<OperationRow key={`${String((operation as { path?: unknown }).path)}-${index}`} operation={operation} />
						))}
					</ul>
				) : null}
				<details>
					<summary className="cursor-pointer text-muted-foreground/70 hover:text-foreground">
						<Trans>Raw JSON</Trans>
					</summary>
					<pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border bg-background p-3 font-mono text-[0.7rem] leading-relaxed">
						{rawPayload}
					</pre>
				</details>
			</div>
		</details>
	);
}

function fileToBase64(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
		reader.onerror = reject;
		reader.readAsDataURL(file);
	});
}

function textFromMessage(message: UIMessage) {
	const textParts: string[] = [];

	for (const part of message.parts) {
		if (part.type === "text") textParts.push(part.text);
	}

	return textParts.join("\n");
}

function parseAgentSseStream(stream: ReadableStream<string>) {
	return parseJsonEventStream({
		stream: stream.pipeThrough(new TextEncoderStream()),
		schema: uiMessageChunkSchema,
	}).pipeThrough(
		new TransformStream({
			transform(chunk, controller) {
				if (!chunk.success) {
					console.warn("[agent] dropping malformed SSE frame", chunk.error);
					return;
				}

				controller.enqueue(chunk.value);
			},
		}),
	);
}

function promptPreview(prompt: string) {
	const words = prompt.split(/\s+/).filter(Boolean);
	return `${words.slice(0, 7).join(" ")}${words.length > 7 ? "…" : ""}`;
}

function chunkPrompts(prompts: string[], columns: number) {
	return prompts.reduce<string[][]>(
		(rows, prompt, index) => {
			rows[index % columns]?.push(prompt);
			return rows;
		},
		Array.from({ length: columns }, () => []),
	);
}

function StarterPromptMarquee({ onSelect }: StarterPromptMarqueeProps) {
	const prompts = [
		t`Tailor this resume to a product manager job description, and emphasize roadmap ownership, stakeholder communication, and measurable launch outcomes.`,
		t`Compare this resume against this job posting URL and update the keywords without overselling anything.`,
		t`Find the weak bullet points and rewrite them with stronger outcomes, numbers, scope, and sharper verbs.`,
		t`Rewrite the summary for a senior engineering manager role, and keep it specific.`,
		t`Check what an applicant tracking system would miss, and only add keywords you're sure about.`,
		t`Rewrite this resume for a startup founder moving into a product lead role, and show the business impact.`,
		t`Make the experience section about results and cut the vague responsibilities.`,
		t`Adjust the resume for a remote-first role that values async communication and ownership.`,
		t`Review the resume against a job description, and ask me before changing anything you're unsure about.`,
		t`Tighten the skills section so it supports the target role instead of reading like a keyword dump.`,
		t`Update the project bullets to show leadership, constraints, tradeoffs, and measurable outcomes.`,
		t`Prepare a conservative patch that improves clarity without changing the story of my career.`,
	];

	const promptRows = chunkPrompts(prompts, 3);

	return (
		<div className="relative mx-auto grid w-full max-w-4xl gap-3 overflow-hidden py-1 [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
			{promptRows.map((row, rowIndex) => {
				const marqueePrompts = row.flatMap((prompt) => [
					{ id: `${prompt}-primary`, prompt },
					{ id: `${prompt}-repeat-a`, prompt },
					{ id: `${prompt}-repeat-b`, prompt },
				]);
				const duration = 135 + rowIndex * 22;

				return (
					<div
						key={`prompt-row-${row.join("|")}`}
						className="flex w-max animate-[agent-prompt-marquee_135s_linear_infinite] gap-3 focus-within:[animation-play-state:paused] hover:[animation-play-state:paused]"
						style={{ animationDuration: `${duration}s`, animationDirection: rowIndex % 2 === 0 ? "normal" : "reverse" }}
					>
						{marqueePrompts.map(({ id, prompt }) => (
							<Button
								key={id}
								type="button"
								variant="outline"
								className="h-8 shrink-0 rounded-full bg-background/70 px-3 font-normal text-muted-foreground hover:text-foreground"
								onClick={() => onSelect(prompt)}
							>
								{promptPreview(prompt)}
							</Button>
						))}
					</div>
				);
			})}
		</div>
	);
}

// ponytail: parts are append-only and never reordered by the AI SDK, so the index is a stable
// unique key. Content-derived keys collide — every `step-start` part serializes identically.
const getMessagePartKey = (messageId: string, index: number) => `${messageId}-${index}`;

// Memoized on the text string, so completed markdown stops re-rendering during streaming.
export const AssistantMarkdown = memo(function AssistantMarkdown({ text }: AssistantMarkdownProps) {
	return (
		<ReactMarkdown
			skipHtml
			remarkPlugins={[remarkGfm]}
			components={{
				p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
				ul: ({ children }) => <ul className="my-2 ms-5 list-disc space-y-1">{children}</ul>,
				ol: ({ children }) => <ol className="my-2 ms-5 list-decimal space-y-1">{children}</ol>,
				li: ({ children }) => <li className="ps-1">{children}</li>,
				a: ({ children, href }) => (
					<a className="text-primary underline underline-offset-4" href={href} target="_blank" rel="noreferrer">
						{children}
					</a>
				),
				code: ({ children, className }) => (
					<code className={cn("rounded border bg-muted px-1 py-0.5 font-mono text-[0.85em]", className)}>
						{children}
					</code>
				),
				pre: ({ children }) => (
					<pre className="my-3 max-w-full overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
						{children}
					</pre>
				),
				blockquote: ({ children }) => (
					<blockquote className="my-3 border-l-2 ps-3 text-muted-foreground">{children}</blockquote>
				),
				table: ({ children }) => (
					<div className="my-3 max-w-full overflow-x-auto">
						<table className="w-full min-w-max border-collapse text-left text-sm">{children}</table>
					</div>
				),
				th: ({ children }) => <th className="border px-3 py-2 font-semibold">{children}</th>,
				td: ({ children }) => <td className="border px-3 py-2 align-top">{children}</td>,
			}}
		>
			{text}
		</ReactMarkdown>
	);
});

function FileAttachment({ filename, mediaType, state = "done" }: FileAttachmentProps) {
	return (
		<Attachment size="sm" state={state}>
			<AttachmentMedia>
				<FileIcon />
			</AttachmentMedia>
			<AttachmentContent>
				<AttachmentTitle>{filename || t`Attachment`}</AttachmentTitle>
				{mediaType ? <span className="sr-only">{mediaType}</span> : null}
			</AttachmentContent>
		</Attachment>
	);
}

// The agent asks one question at a time, so this is a single-item Questionnaire: radio choices plus a
// freeform answer, submitted as the tool output. `Questionnaire` owns the fieldset/legend semantics,
// keyboard shortcuts, focus management, and required-answer validation.
export function AskUserQuestion({ part, answer, disabled, onAnswer }: AskUserQuestionProps) {
	const input =
		"input" in part && typeof part.input === "object" && part.input ? (part.input as Record<string, unknown>) : {};
	const choices = Array.isArray(input.choices)
		? input.choices.filter((choice): choice is string => typeof choice === "string")
		: [];
	const question = typeof input.question === "string" ? input.question : t`The agent needs your input.`;
	const toolCallId = "toolCallId" in part && typeof part.toolCallId === "string" ? part.toolCallId : null;

	// Read-only threads (archived, missing resume/provider) render the static view: answering would
	// only mutate local state before the server rejects the continuation.
	if (answer !== null || !toolCallId || disabled) {
		return (
			<div className="flex flex-col gap-1">
				<p className="font-medium">{question}</p>
				<p className="text-muted-foreground text-sm">{answer ?? <Trans>Waiting for the agent…</Trans>}</p>
			</div>
		);
	}

	const submit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const value = String(new FormData(event.currentTarget).get(ANSWER_FIELD) ?? "").trim();
		if (value) onAnswer(toolCallId, value);
	};

	return (
		<Questionnaire
			shortcuts="numbers"
			items={[{ name: ANSWER_FIELD, required: true, choices: choices.map((choice) => ({ value: choice })) }]}
			onSubmit={submit}
		>
			<QuestionnaireItem required name={ANSWER_FIELD}>
				<QuestionnaireTitle>{question}</QuestionnaireTitle>
				<QuestionnaireChoices>
					{choices.map((choice) => (
						<QuestionnaireChoice key={choice} value={choice}>
							{choice}
						</QuestionnaireChoice>
					))}
					<QuestionnaireInput aria-label={t`Answer in your own words`} placeholder={t`Something else…`} />
				</QuestionnaireChoices>
				<QuestionnaireError />
			</QuestionnaireItem>
			<QuestionnaireActions>
				<QuestionnaireSubmit size="sm">
					<Trans>Send answer</Trans>
				</QuestionnaireSubmit>
			</QuestionnaireActions>
		</Questionnaire>
	);
}

function MessagePart({
	part,
	isUser,
	isReadOnly,
	onAnswer,
	onApprovalRespond,
	onRevert,
	isReverting,
	actionsById,
}: MessagePartProps) {
	if (part.type === "text") {
		return (
			<Bubble variant={isUser ? "default" : "ghost"} align={isUser ? "end" : "start"}>
				<BubbleContent>
					{isUser ? (
						<div className="whitespace-pre-wrap leading-relaxed">{part.text}</div>
					) : (
						<AssistantMarkdown text={part.text} />
					)}
				</BubbleContent>
			</Bubble>
		);
	}

	if (part.type === "reasoning") {
		return (
			<Bubble variant="outline" className="max-w-full">
				<BubbleContent className="w-full">
					<details className="text-sm">
						<summary className="cursor-pointer text-muted-foreground">
							<Trans>Thinking</Trans>
						</summary>
						<div className="mt-2 whitespace-pre-wrap">{part.text}</div>
					</details>
				</BubbleContent>
			</Bubble>
		);
	}

	if (part.type === "tool-ask_user_question") {
		const answer = "output" in part && typeof part.output === "string" ? part.output : null;

		return (
			<Bubble variant="outline" className="max-w-full">
				<BubbleContent className="w-full">
					<AskUserQuestion part={part} answer={answer} disabled={isReadOnly} onAnswer={onAnswer} />
				</BubbleContent>
			</Bubble>
		);
	}

	if (part.type === "tool-apply_resume_patch") {
		const state = "state" in part && typeof part.state === "string" ? part.state : null;

		if (state === "approval-requested" || state === "approval-responded" || state === "output-denied") {
			return (
				<Bubble variant="outline" className="max-w-full">
					<BubbleContent className="w-full">
						<PatchApprovalCard part={part} disabled={isReadOnly} onRespond={onApprovalRespond} />
					</BubbleContent>
				</Bubble>
			);
		}

		const output =
			"output" in part && typeof part.output === "object" && part.output
				? (part.output as Record<string, unknown>)
				: null;
		const actionId = typeof output?.actionId === "string" ? output.actionId : null;
		const action = actionId ? actionsById.get(actionId) : undefined;

		return (
			<Bubble variant="outline" className="max-w-full">
				<BubbleContent className="w-full">
					<PatchToolCard part={part} action={action} onRevert={onRevert} isReverting={isReverting} />
				</BubbleContent>
			</Bubble>
		);
	}

	if (part.type === "file") {
		return <FileAttachment filename={part.filename ?? part.url} mediaType={part.mediaType} />;
	}

	// Previously-invisible tool activity: read_resume, read_attachment, provider-native web_search,
	// and dynamic tools echoed back after a provider switch.
	if (
		part.type === "tool-read_resume" ||
		part.type === "tool-read_attachment" ||
		part.type === "tool-web_search" ||
		part.type === "dynamic-tool"
	) {
		return (
			<Bubble variant="ghost" className="max-w-full">
				<BubbleContent className="w-full">
					<ToolPartCard part={part} />
				</BubbleContent>
			</Bubble>
		);
	}

	return null;
}

type SourceUrlPartLike = { type: "source-url"; url: string; title?: string | null };

function SourcesBlock({ parts }: { parts: SourceUrlPartLike[] }) {
	return (
		<Bubble variant="ghost" className="max-w-full">
			<BubbleContent className="w-full">
				<p className="mb-1 font-medium text-muted-foreground text-xs">
					<Trans>Sources</Trans>
				</p>
				<ul className="space-y-1">
					{parts.map((part, index) => {
						const title = part.title?.trim() || null;
						return (
							// Providers can cite the same URL more than once; the index keeps keys unique.
							<li key={`${part.url}-${index}`}>
								<a className="block text-primary text-sm underline" href={part.url} target="_blank" rel="noreferrer">
									<span className="block truncate">{title ?? part.url}</span>
									{title ? <span className="block truncate text-muted-foreground">{part.url}</span> : null}
								</a>
							</li>
						);
					})}
				</ul>
			</BubbleContent>
		</Bubble>
	);
}

type MessageRenderItem =
	| { kind: "part"; key: string; part: UIMessage["parts"][number] }
	| { kind: "sources"; key: string; parts: SourceUrlPartLike[] };

// Consecutive source-url parts collapse into one sources block instead of a bubble per link.
function buildRenderItems(message: UIMessage): MessageRenderItem[] {
	const items: MessageRenderItem[] = [];

	for (const [index, part] of message.parts.entries()) {
		if (part.type === "source-url") {
			const last = items.at(-1);
			if (last?.kind === "sources") {
				last.parts.push(part as SourceUrlPartLike);
				continue;
			}
			items.push({ kind: "sources", key: getMessagePartKey(message.id, index), parts: [part as SourceUrlPartLike] });
			continue;
		}

		items.push({ kind: "part", key: getMessagePartKey(message.id, index), part });
	}

	return items;
}

type MessageUsageMetadata = {
	model?: string;
	usage?: { totalTokens?: number; cachedInputTokens?: number };
};

function MessageTokenFooter({ message }: { message: UIMessage }) {
	// Loose read: legacy rows have no metadata and must keep rendering.
	const metadata = (message as { metadata?: MessageUsageMetadata }).metadata;
	const total = metadata?.usage?.totalTokens;
	if (typeof total !== "number") return null;
	const cached = metadata?.usage?.cachedInputTokens;

	// Label-form ("Tokens: N") avoids noun declension against the count entirely, so the string
	// stays grammatical at N=1 in every locale without ICU plural catalogs.
	return (
		<p className="px-1 text-[0.7rem] text-muted-foreground/70">
			{metadata?.model ? `${metadata.model} · ` : null}
			{typeof cached === "number" && cached > 0 ? (
				<Trans>
					Tokens: {total} ({cached} cached)
				</Trans>
			) : (
				<Trans>Tokens: {total}</Trans>
			)}
		</p>
	);
}

// Memoized: completed messages keep stable part references, so they stop re-rendering while a
// later message streams (the handlers passed down are useCallback-stable).
const ChatMessage = memo(function ChatMessage({
	message,
	isReadOnly,
	onAnswer,
	onApprovalRespond,
	onRevert,
	isReverting,
	actionsById,
}: ChatMessageProps) {
	const isUser = message.role === "user";

	return (
		<Message align={isUser ? "end" : "start"}>
			<MessageContent className={cn(isUser ? "items-end" : "items-start")}>
				{buildRenderItems(message).map((item) =>
					item.kind === "sources" ? (
						<SourcesBlock key={item.key} parts={item.parts} />
					) : (
						<MessagePart
							key={item.key}
							part={item.part}
							isUser={isUser}
							isReadOnly={isReadOnly}
							onAnswer={onAnswer}
							onApprovalRespond={onApprovalRespond}
							onRevert={onRevert}
							isReverting={isReverting}
							actionsById={actionsById}
						/>
					),
				)}
				{message.role === "assistant" ? <MessageTokenFooter message={message} /> : null}
			</MessageContent>
		</Message>
	);
});

export function AgentChat({
	threadId,
	initialMessages,
	isReadOnly,
	readOnlyReason,
	threadStatus,
	reviewPatches,
	activeRunId,
	actions,
	onToggleThreads,
	onToggleResume,
	onClose,
}: AgentChatProps) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const confirm = useConfirm();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const refreshedPatchOutputsRef = useRef(new Set<string>());
	const lastSyncedThreadIdRef = useRef<string | null>(null);
	const [input, setInput] = useState("");
	const [pendingAttachments, setPendingAttachments] = useState<
		Array<Pick<AgentAttachment, "id" | "filename" | "mediaType">>
	>([]);
	const [isUploading, setIsUploading] = useState(false);
	const revertMutation = useMutation(orpc.agent.actions.revert.mutationOptions());
	const archiveMutation = useMutation(orpc.agent.threads.archive.mutationOptions());
	const deleteMutation = useMutation(orpc.agent.threads.delete.mutationOptions());
	const updateThreadMutation = useMutation(orpc.agent.threads.update.mutationOptions());
	const isArchived = threadStatus === "archived";

	const refreshThread = useCallback(async () => {
		await Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.agent.threads.list.queryKey() }),
			queryClient.invalidateQueries({ queryKey: orpc.agent.threads.get.queryKey({ input: { id: threadId } }) }),
		]);
	}, [queryClient, threadId]);

	const actionsById = useMemo(() => {
		const map = new Map<string, AgentAction>();
		for (const action of actions) map.set(action.id, action);
		return map;
	}, [actions]);

	const handleArchive = () => {
		archiveMutation.mutate(
			{ id: threadId },
			{
				onSuccess: async () => {
					toast.add({ type: "success", description: t`Thread archived.` });
					await refreshThread();
				},
				onError: (error) => {
					toast.add({
						type: "error",
						description: getOrpcErrorMessage(error, { fallback: t`Failed to archive thread.` }),
					});
				},
			},
		);
	};

	const handleDelete = async () => {
		const confirmation = await confirm(t`Delete this agent thread?`, {
			description: t`This action cannot be undone. It deletes the thread's messages and uploaded attachments. The working resume stays in your dashboard, and you can delete it separately.`,
		});

		if (!confirmation) return;

		deleteMutation.mutate(
			{ id: threadId },
			{
				onSuccess: async () => {
					toast.add({ type: "success", description: t`Thread deleted.` });
					await queryClient.invalidateQueries({ queryKey: orpc.agent.threads.list.queryKey() });
					if (onClose) onClose();
					else void navigate({ to: "/agent" });
				},
				onError: (error) => {
					toast.add({
						type: "error",
						description: getOrpcErrorMessage(error, { fallback: t`Failed to delete thread.` }),
					});
				},
			},
		);
	};

	const transport = useMemo(
		() => ({
			async sendMessages(options: { messages: UIMessage[]; abortSignal?: AbortSignal; body?: object }) {
				const message = options.messages.at(-1);
				if (!message) throw new Error("No message to send.");
				const attachmentIds = attachmentIdsFromTransportBody(options.body);

				return parseAgentSseStream(
					eventIteratorToUnproxiedDataStream(
						await streamClient.agent.messages.send(
							{ threadId, message, attachmentIds },
							{ signal: options.abortSignal },
						),
					),
				);
			},
			async reconnectToStream() {
				return parseAgentSseStream(
					eventIteratorToUnproxiedDataStream(await streamClient.agent.messages.resume({ threadId })),
				);
			},
		}),
		[threadId],
	);

	const {
		messages,
		sendMessage,
		regenerate,
		setMessages,
		status,
		error,
		clearError,
		addToolOutput,
		addToolApprovalResponse,
	} = useChat<AgentUIMessage>({
		id: threadId,
		messages: initialMessages as AgentUIMessage[],
		resume: !!activeRunId,
		transport,
		throttle: 50,
		messageMetadataSchema: agentMessageMetadataSchema,
		sendAutomaticallyWhen: (options) =>
			lastAssistantMessageIsCompleteWithToolCalls(options) ||
			lastAssistantMessageIsCompleteWithApprovalResponses(options),
		onFinish: () => {
			void refreshThread();
		},
	});

	useEffect(() => {
		let shouldRefresh = false;

		for (const message of messages) {
			for (const part of message.parts) {
				if (part.type !== "tool-apply_resume_patch" || !("output" in part) || !part.output) continue;

				const output = typeof part.output === "object" ? (part.output as Record<string, unknown>) : null;
				const actionId = typeof output?.actionId === "string" ? output.actionId : null;
				const toolCallId = "toolCallId" in part && typeof part.toolCallId === "string" ? part.toolCallId : null;
				const patchOutputKey = actionId ?? toolCallId;

				if (!patchOutputKey || refreshedPatchOutputsRef.current.has(patchOutputKey)) continue;

				refreshedPatchOutputsRef.current.add(patchOutputKey);
				shouldRefresh = true;
			}
		}

		if (shouldRefresh) void refreshThread();
	}, [messages, refreshThread]);

	useEffect(() => {
		if (lastSyncedThreadIdRef.current === threadId) return;
		lastSyncedThreadIdRef.current = threadId;
		setMessages(initialMessages as AgentUIMessage[]);
	}, [threadId, initialMessages, setMessages]);

	const isStreaming = status === "submitted" || status === "streaming";

	const threadTokenTotal = useMemo(
		() =>
			messages.reduce(
				(sum, message) => sum + ((message as { metadata?: MessageUsageMetadata }).metadata?.usage?.totalTokens ?? 0),
				0,
			),
		[messages],
	);

	const send = () => {
		const text = input.trim();
		if ((!text && pendingAttachments.length === 0) || isReadOnly || isStreaming || isUploading) return;

		clearError();
		const submission = buildAgentChatSubmission(text, pendingAttachments);
		sendMessage(submission.message, submission.options);
		setInput("");
		setPendingAttachments([]);
	};

	const uploadFiles = async (files: FileList | null) => {
		if (!files?.length) return;

		setIsUploading(true);
		try {
			const attachments = await Promise.all(
				Array.from(files).map(async (file) => {
					const attachment = await client.agent.attachments.create({
						threadId,
						filename: file.name,
						mediaType: file.type || "application/octet-stream",
						data: await fileToBase64(file),
					});
					return { id: attachment.id, filename: attachment.filename, mediaType: attachment.mediaType };
				}),
			);

			setPendingAttachments((current) => [...current, ...attachments]);
			toast.add({ type: "success", description: t`Attachment uploaded.` });
		} catch (error) {
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Failed to upload attachment.` }),
			});
		} finally {
			setIsUploading(false);
			if (fileInputRef.current) fileInputRef.current.value = "";
		}
	};

	const stopRun = async () => {
		await client.agent.messages.stop({ threadId });
	};

	const copyConversationJson = () => {
		void navigator.clipboard.writeText(
			JSON.stringify(
				{
					threadId,
					threadStatus,
					chatStatus: status,
					isReadOnly,
					readOnlyReason,
					messages: withoutResumeDataForExport(messages),
					actions,
				},
				null,
				2,
			),
		);
		toast.add({ type: "success", description: t`Conversation JSON copied.` });
	};

	const copyConversationText = () => {
		void navigator.clipboard.writeText(messages.map(textFromMessage).join("\n\n"));
		toast.add({ type: "success", description: t`Conversation copied.` });
	};

	const answerToolCall = useCallback(
		(toolCallId: string, answer: string) => {
			addToolOutput({ tool: "ask_user_question", toolCallId, output: answer });
		},
		[addToolOutput],
	);

	// Responds locally; the composed sendAutomaticallyWhen resubmits the assistant message once
	// every pending approval on it has a decision.
	const respondToApproval = useCallback(
		(response: PatchApprovalResponse) => {
			void addToolApprovalResponse(response);
		},
		[addToolApprovalResponse],
	);

	const toggleReviewPatches = (nextReviewPatches: boolean) => {
		updateThreadMutation.mutate(
			{ id: threadId, reviewPatches: nextReviewPatches },
			{
				onSuccess: () => void refreshThread(),
				onError: (error) =>
					toast.add({
						type: "error",
						description: getOrpcErrorMessage(error, { fallback: t`Failed to update thread settings.` }),
					}),
			},
		);
	};

	const revertActionMutate = revertMutation.mutate;
	const revertAction = useCallback(
		(actionId: string) => {
			void (async () => {
				const confirmation = await confirm(t`Restore the resume to before this patch?`, {
					description: t`This will roll back this patch and any patches applied after it.`,
				});
				if (!confirmation) return;

				revertActionMutate(
					{ id: actionId },
					{
						onSuccess: (action) => {
							if (action.status === "conflicted") {
								toast.add({
									type: "error",
									description:
										action.revertMessage ?? t`Cannot restore; the resume has changed since this edit was applied.`,
								});
							} else if (action.status === "rolled_back" || action.status === "reverted") {
								toast.add({ type: "success", description: t`Patch rolled back.` });
							}
							void refreshThread();
						},
						onError: (error) =>
							toast.add({
								type: "error",
								description: getOrpcErrorMessage(error, { fallback: t`Could not restore this patch.` }),
							}),
					},
				);
			})();
		},
		[confirm, revertActionMutate, refreshThread],
	);

	const retryLastMessage = () => {
		clearError();
		// A failed question/approval continuation must not regenerate: regenerate() removes the
		// answered assistant message and resends the prior user prompt, losing the recorded
		// decision. Resubmitting the transcript (sendMessage with no message) retries the
		// continuation itself; regenerate stays for ordinary generation failures.
		const last = messages.at(-1);
		if (
			last?.role === "assistant" &&
			(lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
				lastAssistantMessageIsCompleteWithApprovalResponses({ messages }))
		) {
			void sendMessage();
			return;
		}
		void regenerate();
	};

	return (
		<section className="flex h-full min-h-0 flex-col bg-background">
			<AgentChatHeader
				isArchived={isArchived}
				isArchivePending={archiveMutation.isPending}
				isDeletePending={deleteMutation.isPending}
				isUpdatePending={updateThreadMutation.isPending}
				isStreaming={isStreaming}
				reviewPatches={reviewPatches}
				threadTokenTotal={threadTokenTotal}
				onArchive={handleArchive}
				onClose={onClose}
				onCopyConversation={copyConversationText}
				onCopyConversationJson={copyConversationJson}
				onDelete={() => void handleDelete()}
				onToggleResume={onToggleResume}
				onToggleReviewPatches={toggleReviewPatches}
				onToggleThreads={onToggleThreads}
			/>

			<AgentChatReadOnlyBanner isReadOnly={isReadOnly} readOnlyReason={readOnlyReason} />

			<AgentChatMessages
				actionsById={actionsById}
				error={error}
				isReadOnly={isReadOnly}
				isReverting={revertMutation.isPending}
				isStreaming={isStreaming}
				messages={messages}
				onAnswer={answerToolCall}
				onApprovalRespond={respondToApproval}
				onRevert={revertAction}
				onRetry={retryLastMessage}
				onStarterSelect={setInput}
			/>

			<AgentChatComposer
				fileInputRef={fileInputRef}
				input={input}
				isReadOnly={isReadOnly}
				isStreaming={isStreaming}
				isUploading={isUploading}
				pendingAttachments={pendingAttachments}
				onInputChange={setInput}
				onSend={send}
				onStopRun={() => void stopRun()}
				onUploadFiles={(files) => void uploadFiles(files)}
			/>
		</section>
	);
}

function AgentChatReadOnlyBanner({ isReadOnly, readOnlyReason }: AgentChatReadOnlyBannerProps) {
	if (!isReadOnly) return null;

	return (
		<div className="border-amber-300 border-b bg-amber-50 px-4 py-2 text-amber-950 text-sm dark:bg-amber-950/20 dark:text-amber-200">
			{readOnlyReason === "archived" ? (
				<Trans>This thread is archived. You can't send new messages.</Trans>
			) : (
				<Trans>This thread is read-only because the working resume or AI provider is unavailable.</Trans>
			)}
		</div>
	);
}

function AgentChatMessages({
	actionsById,
	error,
	isReadOnly,
	isReverting,
	isStreaming,
	messages,
	onAnswer,
	onApprovalRespond,
	onRevert,
	onRetry,
	onStarterSelect,
}: AgentChatMessagesProps) {
	return (
		<MessageScrollerProvider autoScroll defaultScrollPosition="end">
			<MessageScroller className="min-h-0 flex-1">
				<MessageScrollerViewport>
					<MessageScrollerContent className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
						{messages.length === 0 ? (
							<Empty className="py-12">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<SparkleIcon />
									</EmptyMedia>
									<EmptyTitle className="text-2xl">
										<Trans>What do you want to do?</Trans>
									</EmptyTitle>
								</EmptyHeader>
								<EmptyContent className="max-w-full">
									<StarterPromptMarquee onSelect={onStarterSelect} />
								</EmptyContent>
							</Empty>
						) : null}

						{messages.map((message) => (
							<MessageScrollerItem key={message.id} messageId={message.id} scrollAnchor={message.role === "user"}>
								<ChatMessage
									message={message}
									isReadOnly={isReadOnly}
									isReverting={isReverting}
									actionsById={actionsById}
									onAnswer={onAnswer}
									onApprovalRespond={onApprovalRespond}
									onRevert={onRevert}
								/>
							</MessageScrollerItem>
						))}

						{isStreaming ? (
							<MessageScrollerItem>
								<Marker className="w-fit rounded-md bg-muted px-4 py-3">
									<MarkerIcon>
										<SparkleIcon />
									</MarkerIcon>
									<MarkerContent>
										<Trans>Working…</Trans>
									</MarkerContent>
								</Marker>
							</MessageScrollerItem>
						) : null}

						{error ? (
							<MessageScrollerItem>
								<Marker className="items-center justify-between gap-3 rounded-md border border-rose-300 bg-rose-50 p-3 text-rose-950 dark:bg-rose-950/20 dark:text-rose-200">
									<MarkerContent>{error.message}</MarkerContent>
									{!isReadOnly ? (
										<Button size="sm" variant="outline" type="button" onClick={onRetry}>
											<ArrowClockwiseIcon />
											<Trans>Retry</Trans>
										</Button>
									) : null}
								</Marker>
							</MessageScrollerItem>
						) : null}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

function AgentChatHeader({
	isArchived,
	isArchivePending,
	isDeletePending,
	isUpdatePending,
	isStreaming,
	reviewPatches,
	threadTokenTotal,
	onArchive,
	onClose,
	onCopyConversation,
	onCopyConversationJson,
	onDelete,
	onToggleResume,
	onToggleReviewPatches,
	onToggleThreads,
}: AgentChatHeaderProps) {
	return (
		<div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
			<div className="flex min-w-0 items-center gap-2">
				{onToggleThreads ? (
					<Button size="icon-sm" variant="ghost" onClick={onToggleThreads}>
						<SidebarSimpleIcon />
						<span className="sr-only">
							<Trans>Toggle threads</Trans>
						</span>
					</Button>
				) : null}

				<div className="min-w-0 truncate font-semibold">
					<Trans>Chat</Trans>
				</div>
				{threadTokenTotal > 0 ? (
					<span className="shrink-0 text-muted-foreground/70 text-xs">
						<Trans>Tokens: {threadTokenTotal}</Trans>
					</span>
				) : null}
			</div>
			<div className="flex items-center gap-1">
				{onToggleResume ? (
					<Button size="icon-sm" variant="ghost" onClick={onToggleResume}>
						<SquaresFourIcon />
						<span className="sr-only">
							<Trans>Toggle resume preview</Trans>
						</span>
					</Button>
				) : null}
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button size="icon-sm" variant="ghost">
								<DotsThreeVerticalIcon />
								<span className="sr-only">
									<Trans>Thread actions</Trans>
								</span>
							</Button>
						}
					/>

					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={onCopyConversation}>
							<CopyIcon />
							<Trans>Copy</Trans>
						</DropdownMenuItem>
						<DropdownMenuItem onClick={onCopyConversationJson}>
							<CopyIcon />
							<Trans>Copy JSON</Trans>
						</DropdownMenuItem>

						<DropdownMenuSeparator />

						{!isArchived ? (
							<DropdownMenuCheckboxItem
								checked={reviewPatches}
								// Approval behavior is captured when a run starts; toggling mid-run would
								// misrepresent what the streaming run actually does (server rejects it too).
								disabled={isUpdatePending || isStreaming}
								onCheckedChange={(checked) => onToggleReviewPatches(checked === true)}
							>
								<Trans>Review edits</Trans>
							</DropdownMenuCheckboxItem>
						) : null}

						{!isArchived ? (
							<DropdownMenuItem disabled={isArchivePending} onClick={onArchive}>
								<ArchiveIcon />
								<Trans>Archive</Trans>
							</DropdownMenuItem>
						) : null}

						<DropdownMenuItem variant="destructive" disabled={isDeletePending} onClick={onDelete}>
							<TrashIcon />
							<Trans>Delete</Trans>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>

				{onClose ? (
					<Button size="icon-sm" variant="ghost" onClick={onClose}>
						<XIcon />
						<span className="sr-only">
							<Trans>Close AI assistant</Trans>
						</span>
					</Button>
				) : null}
			</div>
		</div>
	);
}

function AgentChatComposer({
	fileInputRef,
	input,
	isReadOnly,
	isStreaming,
	isUploading,
	pendingAttachments,
	onInputChange,
	onSend,
	onStopRun,
	onUploadFiles,
}: AgentChatComposerProps) {
	return (
		<form
			className="border-t p-3"
			onSubmit={(event) => {
				event.preventDefault();
				onSend();
			}}
		>
			<div className="mx-auto flex max-w-3xl flex-col gap-2">
				{pendingAttachments.length > 0 ? (
					<AttachmentGroup className="flex-wrap gap-2 overflow-visible py-0">
						{pendingAttachments.map((attachment) => (
							<FileAttachment
								key={attachment.id}
								filename={attachment.filename}
								mediaType={attachment.mediaType}
								state={isUploading ? "uploading" : "done"}
							/>
						))}
					</AttachmentGroup>
				) : null}

				<div className="flex items-end gap-1 rounded-md border bg-card p-1.5">
					<input
						ref={fileInputRef}
						type="file"
						multiple
						aria-label={t`Upload attachments`}
						className="hidden"
						onChange={(event) => onUploadFiles(event.target.files)}
					/>
					<Button
						type="button"
						size="icon"
						variant="ghost"
						aria-label={t`Attach files`}
						disabled={isReadOnly || isUploading}
						onClick={() => fileInputRef.current?.click()}
					>
						{isUploading ? <ArrowClockwiseIcon className="animate-spin" /> : <PaperclipIcon />}
					</Button>
					<Textarea
						value={input}
						rows={1}
						// Not disabled while streaming: the browser blurs a disabled field, so the caret would
						// jump out of the composer on every send. `send` already ignores calls mid-stream.
						disabled={isReadOnly}
						onChange={(event) => onInputChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.nativeEvent.isComposing) return;
							if (event.key !== "Enter" || event.shiftKey) return;
							event.preventDefault();
							onSend();
						}}
						placeholder={isReadOnly ? t`This thread is read-only` : t`Ask anything about this resume`}
						className="max-h-40 min-h-9 resize-none border-0 bg-transparent p-2 leading-5 shadow-none focus-visible:ring-0"
					/>
					{isStreaming && !isReadOnly ? (
						<Button type="button" size="icon" variant="outline" aria-label={t`Stop generation`} onClick={onStopRun}>
							<StopIcon />
						</Button>
					) : (
						<Button
							type="submit"
							size="icon"
							aria-label={t`Send message`}
							disabled={isReadOnly || isUploading || (!input.trim() && pendingAttachments.length === 0)}
						>
							<PaperPlaneRightIcon />
						</Button>
					)}
				</div>
			</div>
		</form>
	);
}
