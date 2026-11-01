import type { Receipt, ToolPart } from "./proposals";
import type {
	Proposal,
	ProposalEvidence,
	ProposalState,
	RequirementCoverage,
	UnsupportedClaim,
} from "@reactive-resume/resume/proposals";
import type { FactCategory } from "@reactive-resume/schema/career";
import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import { plural, t } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { memo, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, TextInput, View } from "react-native";
import { agentKnowledgeUsed } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { additionParts, blockText, needsConfirmation, proposalText } from "@reactive-resume/resume/proposals";
import { webSources } from "./chat";
import { handToAssistant } from "./handoff";
import { AssistantMarkdown } from "./markdown";
import { isProposeEdits, requirementsOf, skippedCount, titleOf, toProposals } from "./proposals";
import { client, orpc } from "@/api/client";
import { getAccountScope } from "@/auth/session";
import { ReportAiContent } from "@/features/ai/report-content";
import { factCategories } from "@/features/career/facts";
import { useDocuments } from "@/features/documents/queries";
import { routes } from "@/routes";
import { Button, Icon, ListRow, SelectSheet, Sheet, Switch, Text, TextArea, showToast, useTheme } from "@/ui";

export type EditStatus = Proposal["status"];

/** What the chat can do with proposed edits: present only when it's about a document. */
export type ProposalHandlers = {
	statuses: ReadonlyMap<string, Receipt>;
	stateOf: (proposal: Proposal) => ProposalState;
	locked: boolean;
	onAccept: (message: UIMessage, part: ToolPart, proposals: readonly Proposal[]) => void;
	onReject: (message: UIMessage, part: ToolPart, proposals: readonly Proposal[]) => void;
	/** Saves a pending edit's new wording; the card shows it only after this resolves. */
	onEdit: (message: UIMessage, part: ToolPart, proposal: Proposal, text: string) => Promise<void>;
	/** True when these edits tailor to a job and this resume isn't that job's copy (or that isn't known yet). */
	forJobCopy: (message: UIMessage, part: ToolPart) => boolean;
	/** A cited Knowledge fact's text while it's still switched on; null once it's gone. */
	factText: FactText;
};

type FactText = (id: string) => string | null;

type MessageViewProps = {
	message: UIMessage;
	streaming: boolean;
	readOnly: boolean;
	/** Only the newest assistant message may answer a question, as with approvals. */
	answerable: boolean;
	proposals: ProposalHandlers | null;
	/** Null while an answer can't continue the reply (context left out): the question asks for a new message instead. */
	onAnswer: ((toolCallId: string, answer: string) => void) | null;
	/** The coach: the user's messages can be remembered in Knowledge, in this application's scope or all. */
	remember?: { applicationId: string | null } | null;
};

/** Memoized: while a reply streams, only its own message re-renders; the ones above keep their props. */
export const MessageView = memo(function MessageView({
	message,
	streaming,
	readOnly,
	answerable,
	proposals,
	onAnswer,
	remember,
}: MessageViewProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();

	if (message.role === "user") {
		const text = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
		const files = message.parts.flatMap((part) => (part.type === "file" ? [part] : []));
		return (
			<View style={{ alignItems: "flex-end", gap: space.s1, marginStart: space.s8 }}>
				{text ? (
					<View
						style={{
							paddingHorizontal: space.s3,
							paddingVertical: space.s2,
							backgroundColor: colors.sunken,
							borderRadius: radius.rLg,
							borderBottomEndRadius: radius.rSm,
						}}
					>
						<Text selectable>{text}</Text>
					</View>
				) : null}
				{files.map((file) => (
					<FileChip key={file.url} name={file.filename ?? t`Attachment`} />
				))}
				{remember && text && !streaming ? <RememberMessage message={message} scope={remember} /> : null}
			</View>
		);
	}

	const sources = webSources(message);
	const reportText = message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
	const lastText = message.parts.findLastIndex((part) => part.type === "text");

	return (
		<View style={{ gap: space.s3 }}>
			{message.parts.map((part, index) => {
				const key = `${message.id}-${index}`;
				if (part.type === "text")
					return (
						<View key={key}>
							<AssistantMarkdown text={part.text} />
							{streaming && index === lastText ? (
								<View
									accessible={false}
									style={{ width: 8, height: 16, marginTop: space.s1, backgroundColor: colors.ink }}
								/>
							) : null}
						</View>
					);
				return (
					<ToolPartView
						key={key}
						part={part as ToolPart}
						message={message}
						streaming={streaming}
						readOnly={readOnly}
						answerable={answerable}
						proposals={proposals}
						onAnswer={onAnswer}
					/>
				);
			})}
			{!streaming && proposals ? <UsedReads message={message} /> : null}
			{!streaming && remember && reportText ? (
				<AddToResume text={reportText} applicationId={remember.applicationId} />
			) : null}
			{!streaming ? <ReportAiContent source="assistant" text={reportText} /> : null}
			{sources.length > 0 ? (
				<View style={{ gap: space.s1 }}>
					<Text variant="caption" color="ink3">
						<Trans>Sources</Trans>
					</Text>
					{sources.map((source) => (
						<Text
							key={source.url}
							variant="callout"
							color="accentText"
							numberOfLines={1}
							accessibilityRole="link"
							onPress={() => void Linking.openURL(source.url)}
							style={{ textDecorationLine: "underline" }}
						>
							{source.title}
						</Text>
					))}
				</View>
			) : null}
		</View>
	);
});

type FileChipProps = { name: string; busy?: boolean | undefined; onRemove?: (() => void) | undefined };

export function FileChip({ name, busy, onRemove }: FileChipProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	return (
		<View
			style={{
				flexDirection: "row",
				alignItems: "center",
				gap: space.s1,
				minHeight: 28,
				paddingStart: space.s2,
				paddingEnd: onRemove ? 0 : space.s2,
				borderRadius: radius.rMd,
				backgroundColor: colors.sunken,
				maxWidth: 200,
			}}
		>
			{busy ? <ActivityIndicator size="small" /> : <Icon name="paperclip" size={14} color={colors.ink2} />}
			<Text variant="caption" color="ink2" numberOfLines={1} style={{ flexShrink: 1 }}>
				{name}
			</Text>
			{onRemove ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={t`Remove ${name}`}
					onPress={onRemove}
					hitSlop={8}
					style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
				>
					<Icon name="x" size={12} color={colors.ink3} />
				</Pressable>
			) : null}
		</View>
	);
}

type StatusProps = { status?: "running" | "error" | "pending" | undefined; children: ReactNode };

/**
 * One step the assistant took, as a quiet trace line (the web's Trace): a spinner while it runs, a check when done,
 * a warning in danger when it failed, a dash and dimmed when it never finished.
 */
export function Status({ status, children }: StatusProps) {
	const { colors, space } = useTheme();
	const color = status === "error" ? colors.dangerText : status === "pending" ? colors.ink3 : colors.accent;
	return (
		<View
			accessibilityRole={status === "error" ? "alert" : undefined}
			style={{ flexDirection: "row", alignItems: "center", gap: space.s2, opacity: status === "pending" ? 0.7 : 1 }}
		>
			{status === "running" ? (
				<ActivityIndicator size="small" />
			) : (
				<Icon
					name={status === "error" ? "warning-circle" : status === "pending" ? "minus" : "check"}
					size={14}
					color={color}
				/>
			)}
			<Text variant="caption" color={status === "error" ? "dangerText" : "ink3"} style={{ flexShrink: 1 }}>
				{children}
			</Text>
		</View>
	);
}

type ToolPartViewProps = Omit<MessageViewProps, "message"> & { part: ToolPart; message: UIMessage };

function ToolPartView({ part, message, streaming, readOnly, answerable, proposals, onAnswer }: ToolPartViewProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const working = part.state === "input-streaming" || part.state === "input-available";
	if (part.state === "approval-requested" || part.state === "approval-responded") return null;
	if (part.state === "output-denied")
		return (
			<Status>
				<Trans>Skipped</Trans>
			</Status>
		);

	switch (part.type) {
		case "tool-read_resume":
		case "tool-read_letter":
			return (
				<Status status={working ? "running" : undefined}>
					{part.type === "tool-read_letter" ? <Trans>Read the letter</Trans> : <Trans>Read the resume</Trans>}
				</Status>
			);
		case "tool-read_attachment":
			if (part.state === "output-error")
				return (
					<Status status="error">
						<Trans>Couldn't read the attachment: {part.errorText}</Trans>
					</Status>
				);
			return (
				<Status status={working ? "running" : undefined}>
					<Trans>Read the attachment</Trans>
				</Status>
			);
		case "tool-web_search":
		case "tool-google_search":
		case "tool-search_web":
		case "tool-read_page": {
			const reading = part.type === "tool-read_page";
			if (working && !streaming)
				return (
					<Status status="pending">
						{reading ? <Trans>Page reading didn't finish.</Trans> : <Trans>Web search didn't finish.</Trans>}
					</Status>
				);
			if (part.state === "output-error")
				return (
					<Status status="error">
						{reading ? (
							<Trans>Couldn't read this page: {part.errorText}</Trans>
						) : (
							<Trans>Web search failed: {part.errorText}</Trans>
						)}
					</Status>
				);
			const page = reading
				? (part.output as { truncated?: unknown; completeness?: unknown; fallbackReason?: unknown })
				: null;
			return (
				<View style={{ gap: space.s1 }}>
					<Status status={working ? "running" : undefined}>
						{reading ? (
							working ? (
								<Trans>Reading page…</Trans>
							) : (
								<Trans>Read the page</Trans>
							)
						) : working ? (
							<Trans>Searching the web…</Trans>
						) : (
							<Trans>Searched the web</Trans>
						)}
					</Status>
					{page && (page.truncated === true || page.completeness === "incomplete") ? (
						<Text variant="caption" color="ink3">
							<Trans>This page is clipped or incomplete. Check the original before using it.</Trans>
						</Text>
					) : null}
					{page && typeof page.fallbackReason === "string" ? (
						<Text variant="caption" color="ink3">
							<Trans>Enhanced reading unavailable; used the built-in reader.</Trans>
						</Text>
					) : null}
				</View>
			);
		}
		case "tool-apply_resume_patch":
			return (
				<Status>
					<Trans>Changed the resume directly (an earlier conversation)</Trans>
				</Status>
			);
		case "tool-ask_user_question":
			return <QuestionCard part={part} readOnly={readOnly || !answerable} busy={streaming} onAnswer={onAnswer} />;
		case "tool-propose_edits": {
			if (part.state === "output-error")
				return (
					<Status status="error">
						<Trans>Couldn't propose these edits: {part.errorText}</Trans>
					</Status>
				);
			if (!isProposeEdits(part))
				return (
					<Status status="running">
						<Trans>Preparing edits…</Trans>
					</Status>
				);
			if (!proposals) return null;
			const list = toProposals(part, proposals.statuses);
			const skipped = skippedCount(part);
			const requirements = requirementsOf(part);
			const forJobCopy = proposals.forJobCopy(message, part);
			const states = list.map(proposals.stateOf);
			return (
				<View style={{ gap: space.s2 }}>
					{list.length > 0 ? (
						<ChangeSet
							title={titleOf(part)}
							proposals={list}
							states={states}
							locked={proposals.locked || forJobCopy}
							onAccept={(chosen) => proposals.onAccept(message, part, chosen)}
							onReject={(chosen) => proposals.onReject(message, part, chosen)}
							onEdit={(proposal, text) => proposals.onEdit(message, part, proposal, text)}
							requirements={requirements}
							factText={proposals.factText}
						/>
					) : requirements.length > 0 ? (
						<View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: radius.rLg, overflow: "hidden" }}>
							<Coverage requirements={requirements} factText={proposals.factText} />
						</View>
					) : null}
					{forJobCopy && list.some((proposal) => proposal.status === "pending") ? (
						<Text variant="caption" color="ink2">
							{part.output && typeof part.output === "object" && "tailoredFor" in part.output
								? t`These edits use a job posting, so they go to a copy of this resume made for that job. Copy it for the job and ask again there; this resume stays unchanged.`
								: t`These edits are from before the assistant recorded which job posting they use, so they can't be applied. Ask again on the resume you want to change.`}
						</Text>
					) : null}
					{skipped > 0 ? (
						<Text variant="caption" color="ink3">
							{plural(skipped, {
								one: "# change couldn't be prepared. Save your latest changes and ask again, or open Write to edit it directly.",
								other:
									"# changes couldn't be prepared. Save your latest changes and ask again, or open Write to edit them directly.",
							})}
						</Text>
					) : null}
				</View>
			);
		}
		case "data-knowledge-withdrawn":
			return (
				<Status>
					<Trans>This reply used Knowledge that has since changed, so it's hidden.</Trans>
				</Status>
			);
		case "tool-save_story": {
			const story = part.output as { data?: { title?: unknown } } | undefined;
			const title = typeof story?.data?.title === "string" ? story.data.title : null;
			return part.state === "output-available" && title ? (
				<Status>
					<Trans>Saved a story: {title}</Trans>
				</Status>
			) : null;
		}
		case "tool-remember_fact":
			return streaming ? null : <RememberNote part={part} />;
		case "tool-search_career_knowledge":
			return (
				<Status status={working ? "running" : undefined}>
					{working ? <Trans>Searching your Knowledge…</Trans> : <Trans>Searched your Knowledge</Trans>}
				</Status>
			);
		default:
			return null;
	}
}

type QuestionCardProps = Pick<MessageViewProps, "readOnly" | "onAnswer"> & {
	part: ToolPart;
	busy?: boolean;
};

/** The assistant asks before writing anything the document doesn't say: an info-soft card with its choices. */
function QuestionCard({ part, readOnly, busy = false, onAnswer }: QuestionCardProps) {
	const { t } = useLingui();
	const { colors, radius, size, space, type } = useTheme();
	const [other, setOther] = useState("");
	const submitted = useRef(false);
	const input = (part.input ?? {}) as { question?: unknown; choices?: unknown };
	const question = typeof input.question === "string" ? input.question : "";
	const choices = Array.isArray(input.choices)
		? input.choices.filter((choice): choice is string => typeof choice === "string")
		: [];
	const answer = part.state === "output-available" && typeof part.output === "string" ? part.output : null;
	const toolCallId = part.toolCallId;
	const canAnswer = part.state === "input-available" && !readOnly && toolCallId !== undefined;
	if (!question && part.state === "input-streaming" && busy) return null;
	if (!question && part.state !== "input-streaming" && part.state !== "output-error") return null;

	const submit = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed || busy || !canAnswer || !toolCallId || !onAnswer || submitted.current) return;
		// Two activations in one render turn must not let the second answer replace the first.
		submitted.current = true;
		onAnswer(toolCallId, trimmed);
	};

	return (
		<View style={{ gap: space.s3, padding: space.s3, borderRadius: radius.rLg, backgroundColor: colors.infoSoft }}>
			{question ? (
				<Text variant="label" color="infoText">
					{question}
				</Text>
			) : null}
			{answer !== null ? (
				<Text variant="callout" color="infoText">
					<Trans>You answered: {answer}</Trans>
				</Text>
			) : part.state === "input-streaming" ? (
				busy ? null : (
					<Text variant="callout" color="infoText">
						<Trans>This question didn't finish.</Trans>
					</Text>
				)
			) : part.state === "output-error" ? (
				<Text variant="callout" color="infoText">
					<Trans>This question couldn't be asked. Send a new message to continue.</Trans>
				</Text>
			) : !canAnswer ? null : !onAnswer ? (
				<Text variant="callout" color="infoText">
					<Trans>Context is left out, so reply with a new message instead.</Trans>
				</Text>
			) : (
				<>
					{choices.length > 0 ? (
						<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
							{choices.map((choice) => (
								<Button
									key={choice}
									variant="secondary"
									label={choice}
									disabled={busy}
									onPress={() => submit(choice)}
								/>
							))}
						</View>
					) : null}
					<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
						<TextInput
							value={other}
							onChangeText={setOther}
							editable={!busy}
							accessibilityLabel={t`Answer in your own words`}
							placeholder={t`Or in your own words…`}
							placeholderTextColor={colors.ink3}
							returnKeyType="send"
							onSubmitEditing={() => submit(other)}
							style={{
								...type.body,
								flex: 1,
								minHeight: size.hit,
								paddingHorizontal: space.s3,
								color: colors.ink,
								backgroundColor: colors.raised,
								borderRadius: radius.rMd,
								borderWidth: 1,
								borderColor: colors.line2,
							}}
						/>
						<Button
							variant="secondary"
							label={t`Send`}
							disabled={busy || !other.trim()}
							onPress={() => submit(other)}
						/>
					</View>
				</>
			)}
		</View>
	);
}

type ChangeSetProps = {
	/** What the set does, as the assistant titled it. */
	title: string;
	proposals: readonly Proposal[];
	states: readonly ProposalState[];
	locked: boolean;
	onAccept: (proposals: readonly Proposal[]) => void;
	onReject: (proposals: readonly Proposal[]) => void;
	onEdit: (proposal: Proposal, text: string) => Promise<void>;
	requirements: readonly RequirementCoverage[];
	factText: FactText;
};

/** "n proposed edits" with Accept all, then each edit numbered: where it lands, old text struck, new text, why. */
function ChangeSet({
	title,
	proposals,
	states,
	locked,
	onAccept,
	onReject,
	onEdit,
	requirements,
	factText,
}: ChangeSetProps) {
	const { t } = useLingui();
	const { colors, radius, size, space } = useTheme();
	// Edits whose wording is open, saving or failed to save can't be accepted from here, by any path (web proposal-list).
	const [drafting, setDrafting] = useState<ReadonlySet<string>>(new Set());
	const acceptable = (proposal: Proposal, index: number) =>
		!locked && states[index] === "pending" && !drafting.has(proposal.id);
	const accept = (chosen: readonly Proposal[]) => {
		const allowed = chosen.filter((proposal) => acceptable(proposal, proposals.indexOf(proposal)));
		if (allowed.length > 0) onAccept(allowed);
	};
	const pending = proposals.filter((proposal, index) => acceptable(proposal, index));
	// Edits that add a detail are accepted one by one, after the user checks them (web proposal-list).
	const checked = pending.filter((proposal) => !needsConfirmation(proposal));
	const toConfirm = pending.length - checked.length;
	const accepted = states.filter((state) => state === "accepted").length;
	// Worded from the undecided edits, as on the web: a locked set or one being rewritten still has edits to decide.
	const count = states.some((state) => state === "pending")
		? plural(proposals.length, { one: "# proposed edit", other: "# proposed edits" })
		: t`${accepted} of ${proposals.length} applied`;

	return (
		<View style={{ borderWidth: 1, borderColor: colors.line, borderRadius: radius.rLg, overflow: "hidden" }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space.s2,
					minHeight: size.hit,
					paddingHorizontal: space.s3,
					paddingVertical: space.s2,
					backgroundColor: colors.bg,
					borderBottomWidth: 1,
					borderColor: colors.line,
				}}
			>
				<Text variant="label" accessibilityRole="header" style={{ flex: 1 }}>
					{title ? `${title} · ${count}` : count}
				</Text>
				{checked.length > 1 ? (
					<Button
						size="sm"
						label={toConfirm > 0 ? t`Accept the others` : t`Accept all`}
						disabled={locked}
						onPress={() => accept(checked)}
					/>
				) : null}
			</View>
			{toConfirm > 0 && checked.length > 1 ? (
				<Text variant="caption" color="ink3" style={{ paddingHorizontal: space.s3, paddingTop: space.s2 }}>
					{plural(toConfirm, {
						one: "# edit adds a new detail, so accept it on its own once you've checked it.",
						other: "# edits add new details, so accept each on its own once you've checked it.",
					})}
				</Text>
			) : null}
			{requirements.length > 0 ? <Coverage requirements={requirements} factText={factText} /> : null}
			{proposals.map((proposal, index) => (
				<View
					key={proposal.id}
					style={{
						gap: space.s2,
						padding: space.s3,
						borderTopWidth: index === 0 ? 0 : 1,
						borderColor: colors.line,
					}}
				>
					<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
						<View
							style={{
								minWidth: 20,
								minHeight: 20,
								borderRadius: radius.rLg,
								alignItems: "center",
								justifyContent: "center",
								backgroundColor: colors.accent,
							}}
						>
							<Text variant="micro" color="onAccent">
								{index + 1}
							</Text>
						</View>
						<Text
							variant="caption"
							color="ink3"
							numberOfLines={1}
							accessibilityLabel={t`Edit ${index + 1}: ${proposal.location}`}
							style={{ flex: 1 }}
						>
							{proposal.location}
						</Text>
					</View>
					{additionParts(proposal) ? (
						<Text variant="callout" color="ink3">
							<Trans>Adds after: {additionParts(proposal)?.anchor}</Trans>
						</Text>
					) : proposal.before ? (
						<Text variant="callout" color="ink3" style={{ textDecorationLine: "line-through" }}>
							{proposalText(proposal, "before")}
						</Text>
					) : null}
					<ProposalBody
						proposal={proposal}
						state={states[index] ?? "pending"}
						locked={locked}
						factText={factText}
						onAccept={() => accept([proposal])}
						onReject={() => onReject([proposal])}
						// A structural change is reviewed as a whole: its wording can't be rewritten here.
						onEdit={proposal.snapshot ? undefined : (text) => onEdit(proposal, text)}
						onDrafting={(open) =>
							setDrafting((current) => {
								const next = new Set(current);
								if (open) next.add(proposal.id);
								else next.delete(proposal.id);
								return next;
							})
						}
					/>
				</View>
			))}
		</View>
	);
}

const addedText = ({ before, after }: Pick<Proposal, "before" | "after">) =>
	blockText(before && after.startsWith(before) ? after.slice(before.length) : after);

type ProposalBodyProps = {
	proposal: Proposal;
	state: ProposalState;
	locked: boolean;
	factText: FactText;
	onAccept: () => void;
	onReject: () => void;
	onEdit: ((text: string) => Promise<void>) | undefined;
	/** The wording opened for editing (true) or closed: saved or cancelled (false). */
	onDrafting: (open: boolean) => void;
};

/** The new text (or the user's rewrite of it), why, what's cited and flagged, and the decision (web proposal-list). */
function ProposalBody({
	proposal,
	state,
	locked,
	factText,
	onAccept,
	onReject,
	onEdit,
	onDrafting,
}: ProposalBodyProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const [draft, setDraftText] = useState<string | null>(null);
	const setDraft = (text: string | null) => {
		if ((text === null) !== (draft === null)) onDrafting(text !== null);
		setDraftText(text);
	};
	const [saving, setSaving] = useState<"saving" | "failed" | null>(null);
	const save = async (text: string) => {
		setSaving("saving");
		try {
			await onEdit?.(text);
			setDraft(null);
			setSaving(null);
		} catch {
			// The draft stays open with the user's words, so nothing is lost and Accept can't use unsaved wording.
			setSaving("failed");
		}
	};

	return (
		<>
			{draft === null ? (
				<Text
					variant="callout"
					style={{
						alignSelf: "flex-start",
						paddingHorizontal: space.s1,
						borderRadius: radius.rMd,
						backgroundColor: colors.accentSoft,
					}}
				>
					{additionParts(proposal)?.added ?? proposalText(proposal, "after")}
				</Text>
			) : (
				<TextInput
					accessibilityLabel={t`Your wording`}
					value={draft}
					onChangeText={setDraft}
					multiline
					maxLength={2000}
					style={{
						minHeight: 72,
						padding: space.s2,
						borderWidth: 1,
						borderColor: colors.line2,
						borderRadius: radius.rMd,
						color: colors.ink,
						backgroundColor: colors.raised,
						textAlignVertical: "top",
					}}
				/>
			)}
			{proposal.edited && draft === null ? (
				<Text variant="caption" color="ink3">
					<Trans>Edited by you</Trans>
				</Text>
			) : null}
			{proposal.why ? (
				<Text variant="caption" color="ink2">
					{proposal.why}
				</Text>
			) : null}
			{proposal.addsClaims && state === "pending" ? (
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						alignSelf: "flex-start",
						gap: space.s1,
						paddingHorizontal: space.s2,
						paddingVertical: space.s1,
						borderRadius: radius.rMd,
						backgroundColor: colors.warnSoft,
					}}
				>
					<Icon name="warning-circle" size={14} color={colors.warnText} />
					<Text variant="caption" color="warnText">
						<Trans>New detail: check it's true</Trans>
					</Text>
				</View>
			) : null}
			<ProposalReview proposal={proposal} factText={factText} />
			{state === "pending" && draft !== null ? (
				<View style={{ gap: space.s1 }}>
					{saving === "failed" ? (
						<Text variant="caption" color="dangerText" accessibilityRole="alert">
							{t`Couldn't save your wording. Your text is still here; try again.`}
						</Text>
					) : null}
					<View style={{ flexDirection: "row", gap: space.s2 }}>
						<Button
							label={saving === "saving" ? t`Saving…` : saving === "failed" ? t`Try again` : t`Save wording`}
							disabled={locked || !draft.trim() || saving === "saving"}
							onPress={() => void save(draft)}
						/>
						<Button
							variant="secondary"
							label={t`Cancel`}
							disabled={saving === "saving"}
							onPress={() => {
								setDraft(null);
								setSaving(null);
							}}
						/>
					</View>
				</View>
			) : (
				<ProposalOutcome
					state={state}
					superseded={proposal.superseded === true}
					locked={locked}
					onAccept={onAccept}
					onReject={onReject}
					onEdit={onEdit ? () => setDraft(addedText(proposal)) : undefined}
				/>
			)}
		</>
	);
}

function useReviewLabels() {
	const { t } = useLingui();
	return {
		claim: (kind: UnsupportedClaim["kind"]) =>
			({
				employer: t`Employer`,
				title: t`Job title`,
				date: t`Date`,
				figure: t({ message: "Figure", context: "A number or metric stated in a resume" }),
				skill: t`Skill`,
				responsibility: t`Responsibility`,
				term: t`Not in your resume`,
			})[kind],
		coverage: (status: RequirementCoverage["status"]) =>
			({
				edited: t`An edit addresses it`,
				cited: t`Cited as already shown · check it`,
				missing: t`No evidence found · left as a gap`,
				unassessed: t`Not assessed`,
			})[status],
	};
}

/** Citations as the assistant made them: pointers to check, never proof. */
function Evidence({ evidence, factText }: { evidence: readonly ProposalEvidence[]; factText: FactText }) {
	const { t } = useLingui();
	return (
		<>
			{evidence.map((item) => (
				<Text
					key={item.kind === "fact" ? `fact:${item.id}` : `passage:${item.location}:${item.text}`}
					variant="caption"
					color="ink2"
				>
					<Text variant="caption" color="ink3">
						{item.kind === "fact" ? t`Knowledge` : item.location}
					</Text>{" "}
					{item.kind === "fact" ? (factText(item.id) ?? t`A fact that's no longer in Knowledge`) : item.text}
				</Text>
			))}
		</>
	);
}

/** What the edit answers in the posting, what the assistant cites, and what nothing checked backs (web proposal-list). */
function ProposalReview({ proposal, factText }: { proposal: Proposal; factText: FactText }) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const labels = useReviewLabels();
	const [showEvidence, setShowEvidence] = useState(false);
	const { requirement, evidence = [], unresolved = 0, unsupported = [] } = proposal;
	if (!requirement && evidence.length === 0 && unresolved === 0 && unsupported.length === 0) return null;

	return (
		<View style={{ gap: space.s1 }}>
			{requirement ? (
				<Text variant="caption" color="ink2">
					{t`Posting asks for: ${requirement}`}
				</Text>
			) : null}
			{evidence.length > 0 ? (
				<>
					<Pressable
						accessibilityRole="button"
						accessibilityState={{ expanded: showEvidence }}
						onPress={() => setShowEvidence((shown) => !shown)}
						hitSlop={8}
					>
						<Text variant="caption" color="ink2" style={{ textDecorationLine: "underline" }}>
							{plural(evidence.length, {
								one: "The assistant cites # source · check it says this",
								other: "The assistant cites # sources · check they say this",
							})}
						</Text>
					</Pressable>
					{showEvidence ? <Evidence evidence={evidence} factText={factText} /> : null}
				</>
			) : requirement ? (
				<Text variant="caption" color="ink2">
					{t`Nothing cited for this edit.`}
				</Text>
			) : null}
			{unresolved > 0 ? (
				<Text variant="caption" color="ink2">
					{plural(unresolved, {
						one: "# citation didn't match anything the assistant could read.",
						other: "# citations didn't match anything the assistant could read.",
					})}
				</Text>
			) : null}
			{unsupported.length > 0 ? (
				<View
					accessible
					style={{ gap: space.s1, padding: space.s2, borderRadius: radius.rMd, backgroundColor: colors.warnSoft }}
				>
					<View style={{ flexDirection: "row", alignItems: "center", gap: space.s1 }}>
						<Icon name="warning-circle" size={14} color={colors.warnText} />
						<Text variant="caption" color="warnText" style={{ flex: 1, fontWeight: "600" }}>
							{t`Nothing checked backs these. Confirm each before accepting:`}
						</Text>
					</View>
					{unsupported.map((claim) => (
						<Text key={`${claim.kind}:${claim.text}`} variant="caption" color="warnText">
							{`• ${labels.claim(claim.kind)}: ${claim.text}`}
						</Text>
					))}
				</View>
			) : null}
		</View>
	);
}

/** Every posting requirement as the assistant read it, gaps included (web proposal-list). */
function Coverage({ requirements, factText }: { requirements: readonly RequirementCoverage[]; factText: FactText }) {
	const { t } = useLingui();
	const { colors, space } = useTheme();
	const labels = useReviewLabels();
	const gaps = requirements.filter((item) => item.status === "missing" || item.status === "unassessed").length;
	const [open, setOpen] = useState(gaps > 0);

	return (
		<View
			style={{
				gap: space.s2,
				paddingHorizontal: space.s3,
				paddingVertical: space.s2,
				borderBottomWidth: 1,
				borderColor: colors.line,
			}}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded: open }}
				onPress={() => setOpen(!open)}
				hitSlop={8}
			>
				<Text variant="caption" color="ink2" style={{ textDecorationLine: "underline" }}>
					{`${plural(requirements.length, {
						one: "The assistant's reading of # posting requirement",
						other: "The assistant's reading of # posting requirements",
					})}${gaps > 0 ? ` ${plural(gaps, { one: "· # gap", other: "· # gaps" })}` : ""}`}
				</Text>
			</Pressable>
			{open ? (
				<>
					{requirements.map((item) => (
						<View key={item.text} style={{ gap: 2 }}>
							<Text variant="caption">{item.text}</Text>
							<Text
								variant="caption"
								color={item.status === "missing" || item.status === "unassessed" ? "warnText" : "ink2"}
							>
								{labels.coverage(item.status)}
							</Text>
							<Evidence evidence={item.evidence} factText={factText} />
							{(item.unresolved ?? 0) > 0 ? (
								<Text variant="caption" color="ink2">
									{plural(item.unresolved ?? 0, {
										one: "# citation didn't match anything the assistant could read.",
										other: "# citations didn't match anything the assistant could read.",
									})}
								</Text>
							) : null}
						</View>
					))}
					<Text variant="caption" color="ink3">
						{t`An AI reading to help you edit, not a prediction of how an employer or screening system will respond.`}
					</Text>
				</>
			) : null}
		</View>
	);
}

type ProposalOutcomeProps = {
	state: ProposalState;
	/** A later suggestion replaced it. */
	superseded: boolean;
	locked: boolean;
	onAccept: () => void;
	onReject: () => void;
	onEdit: (() => void) | undefined;
};

function ProposalOutcome({ state, superseded, locked, onAccept, onReject, onEdit }: ProposalOutcomeProps) {
	const { t } = useLingui();
	const { colors, space } = useTheme();
	if (state === "pending")
		return (
			<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
				<Button label={t`Accept`} disabled={locked} onPress={onAccept} />
				{onEdit ? <Button variant="secondary" label={t`Edit`} disabled={locked} onPress={onEdit} /> : null}
				<Button variant="secondary" label={t`Reject`} onPress={onReject} />
			</View>
		);
	if (state === "accepted")
		return (
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2, minHeight: 28 }}>
				<Icon name="check" size={16} color={colors.accentText} />
				<Text variant="caption" color="accentText">
					<Trans context="A proposed change has been applied">Applied</Trans>
				</Text>
			</View>
		);
	return (
		<Text variant="caption" color={state === "stale" ? "warnText" : "ink3"} style={{ minHeight: 28 }}>
			{state === "stale" ? (
				<Trans>Out of date: the text has changed since.</Trans>
			) : superseded ? (
				<Trans>Replaced by a newer suggestion</Trans>
			) : (
				<Trans>Rejected</Trans>
			)}
		</Text>
	);
}

// ---- Coach memory: a fact proposed for Knowledge, or saved automatically with Undo ----

type RememberOutput = { status?: unknown; id?: unknown; fact?: { text?: unknown; applicationId?: unknown } };

/** The server's reason when it has one (the quote isn't in the message, the message is gone). */
const reason = (error: unknown, fallback: string) =>
	error instanceof ORPCError && error.message ? error.message : fallback;

function RememberNote({ part }: { part: ToolPart }) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const queryClient = useQueryClient();
	const [outcome, setOutcome] = useState<"pending" | "saved" | "dismissed" | "undone">("pending");
	const [busy, setBusy] = useState(false);
	const [shared, setShared] = useState(false);
	const output = (part.state === "output-available" ? part.output : null) as RememberOutput | null;
	const text = typeof output?.fact?.text === "string" ? output.fact.text : null;
	if (!output || !text || outcome === "dismissed" || outcome === "undone") return null;
	const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
	// Remembered in a job's workspace: private to that job until the user shares it.
	const scoped = typeof output.fact?.applicationId === "string" && !shared;

	// Memory mode Automatically: already saved, with Undo.
	if (output.status === "saved" && typeof output.id === "string") {
		const id = output.id;
		return (
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s2 }}>
				<Icon name="check-circle" size={18} color={colors.accentText} />
				<Text variant="callout" color="ink2" style={{ flexShrink: 1 }}>
					{scoped ? <Trans>Remembered for this application only: “{text}”</Trans> : <Trans>Remembered: “{text}”</Trans>}
				</Text>
				{scoped ? (
					<Button
						variant="link"
						label={t`Use for all applications`}
						loading={busy}
						onPress={() => {
							setBusy(true);
							client.career
								.updateFact({ id, share: true })
								.then(() => {
									setShared(true);
									refresh();
								})
								.catch((error: unknown) =>
									showToast({ message: reason(error, t`Couldn't share that fact. Try again.`) }),
								)
								.finally(() => setBusy(false));
						}}
					/>
				) : null}
				<Button
					variant="link"
					label={t`Undo`}
					onPress={() => {
						setOutcome("undone");
						client.career
							.forgetFact({ id })
							.then(refresh)
							.catch(() => {
								setOutcome("pending");
								showToast({ message: t`Couldn't undo that. Try again.` });
							});
					}}
				/>
			</View>
		);
	}
	if (output.status !== "proposed") return null;

	if (outcome === "saved")
		return (
			<Status>
				<Trans>Added to Knowledge.</Trans>
			</Status>
		);

	return (
		<View style={{ gap: space.s2, padding: space.s3, borderRadius: radius.rLg, backgroundColor: colors.sunken }}>
			<Text variant="label">
				{scoped ? (
					<Trans>Remember for this application only?</Trans>
				) : (
					<Trans>Remember this for future coaching?</Trans>
				)}
			</Text>
			<Text variant="callout" color="ink2">
				{text}
			</Text>
			<View style={{ flexDirection: "row", gap: space.s2 }}>
				<Button
					size="sm"
					label={t`Remember`}
					loading={busy}
					onPress={() => {
						setBusy(true);
						client.career
							.saveFact(output.fact as Parameters<typeof client.career.saveFact>[0])
							.then(() => {
								setOutcome("saved");
								refresh();
							})
							.catch((error: unknown) => showToast({ message: reason(error, t`Couldn't remember that. Try again.`) }))
							.finally(() => setBusy(false));
					}}
				/>
				<Button size="sm" variant="ghost" label={t`Not now`} onPress={() => setOutcome("dismissed")} />
			</View>
		</View>
	);
}

// ---- Remember a message on demand, in any memory mode: the user reviews the words, kind and scope first ----

type RememberMessageProps = { message: UIMessage; scope: { applicationId: string | null } };

function RememberMessage({ message, scope }: RememberMessageProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const queryClient = useQueryClient();
	const quote = (message.parts.find((part) => part.type === "text")?.text ?? "").trim().slice(0, 4000);
	const [open, setOpen] = useState(false);
	const [text, setText] = useState(() => quote.slice(0, 2000));
	const [category, setCategory] = useState<FactCategory>("accomplishment");
	const [onlyHere, setOnlyHere] = useState(true);
	const [state, setState] = useState<"idle" | "saving" | "saved" | "forgotten">("idle");
	if (!quote) return null;

	const save = () => {
		setState("saving");
		client.career
			.saveFact({
				applicationId: scope.applicationId && onlyHere ? scope.applicationId : null,
				text: text.trim(),
				category,
				source: { kind: "user-message", id: message.id, quote },
			})
			.then((fact) => {
				setState(fact ? "saved" : "forgotten");
				setOpen(false);
				void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });
			})
			.catch((error: unknown) => {
				setState("idle");
				showToast({ message: reason(error, t`Couldn't remember that. Try again.`) });
			});
	};

	if (state === "saved" || state === "forgotten")
		return (
			<Text variant="caption" color="ink3">
				{state === "saved" ? (
					<Trans>Added to Knowledge.</Trans>
				) : (
					<Trans>Not saved — this fact was forgotten before.</Trans>
				)}
			</Text>
		);
	if (!open)
		return <Button variant="link" size="sm" icon="bookmark-simple" label={t`Remember`} onPress={() => setOpen(true)} />;
	return (
		<View
			style={{
				alignSelf: "stretch",
				gap: space.s2,
				padding: space.s3,
				borderRadius: radius.rLg,
				borderWidth: 1,
				borderColor: colors.line,
				backgroundColor: colors.raised,
			}}
		>
			<TextArea
				label={t`Remember as a fact in Knowledge`}
				value={text}
				onChangeText={setText}
				maxLength={2000}
				minLines={3}
			/>
			<SelectSheet label={t`Fact type`} value={category} options={factCategories()} onChange={setCategory} />
			{scope.applicationId ? (
				<Switch label={t`Only for this application`} value={onlyHere} onValueChange={setOnlyHere} />
			) : null}
			<Text variant="caption" color="ink3">
				<Trans>Saved from your message as you wrote it. Nothing is sent to the AI.</Trans>
			</Text>
			<View style={{ flexDirection: "row", gap: space.s2 }}>
				<Button size="sm" label={t`Remember`} loading={state === "saving"} disabled={!text.trim()} onPress={save} />
				<Button size="sm" variant="ghost" label={t`Cancel`} onPress={() => setOpen(false)} />
			</View>
		</View>
	);
}

// ---- What a document reply read: the document, and the facts and stories its Knowledge search found ----

function UsedReads({ message }: { message: UIMessage }) {
	const { space } = useTheme();
	const knowledge = agentKnowledgeUsed(message);
	const readDocument = message.parts.some(
		(part) =>
			(part.type === "tool-read_resume" || part.type === "tool-read_letter") &&
			(part as ToolPart).state === "output-available",
	);
	if (!readDocument && knowledge.facts.length === 0 && knowledge.stories.length === 0) return null;
	const summary = [
		...(readDocument ? [t`the document`] : []),
		...(knowledge.facts.length ? [plural(knowledge.facts.length, { one: "# fact", other: "# facts" })] : []),
		...(knowledge.stories.length ? [plural(knowledge.stories.length, { one: "# story", other: "# stories" })] : []),
	].join(" · ");
	return (
		<View style={{ gap: space.s1 }}>
			<Text variant="caption" color="ink3">{t`Used: ${summary}`}</Text>
			{knowledge.facts.map((fact) => (
				<Text key={fact.id} variant="caption" color="ink2">
					{`• ${fact.text}`}
				</Text>
			))}
			{knowledge.stories.map((story) => (
				<Text key={story.id} variant="caption" color="ink2">
					{`• ${story.title}`}
				</Text>
			))}
		</View>
	);
}

// ---- Hand an answer to a resume's assistant: it proposes the edits there, for review ----

type AddToResumeProps = { text: string; applicationId: string | null };

/**
 * Opens a resume's assistant with the answer in its message box, unsent. In a job's workspace, that job's copies come
 * first. The text is handed over in memory for this account and resume, never in a route.
 */
function AddToResume({ text, applicationId }: AddToResumeProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const documents = useDocuments();
	const resumes = (documents.data ?? []).filter((document) => document.type === "resume" && !document.isLocked);
	const forJob = applicationId ? resumes.filter((resume) => resume.application?.id === applicationId) : [];
	const ordered = [...forJob, ...resumes.filter((resume) => !forJob.includes(resume))];
	const scope = getAccountScope();
	if (ordered.length === 0 || !scope) return null;
	const ask = t`Add this to my resume where it fits. Propose the edits for me to review:\n\n${text}`.slice(0, 2000);
	return (
		<>
			<Button variant="link" size="sm" icon="file-plus" label={t`Add to resume`} onPress={() => setOpen(true)} />
			<Sheet open={open} onClose={() => setOpen(false)} title={t`Open in the resume's assistant`}>
				{ordered.map((resume) => (
					<ListRow
						key={resume.id}
						title={resume.name}
						subtitle={forJob.includes(resume) ? t`Copy for this job` : undefined}
						onPress={() => {
							setOpen(false);
							handToAssistant(scope, resume.id, ask);
							router.push(routes.assistant(resume.id));
						}}
					/>
				))}
			</Sheet>
		</>
	);
}
