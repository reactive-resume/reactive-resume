import type { ToolPart } from "./proposals";
import type { Proposal, ProposalState } from "@reactive-resume/resume/proposals";
import type { UIMessage } from "ai";
import type { ReactNode } from "react";
import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { memo, useState } from "react";
import { ActivityIndicator, Linking, Pressable, TextInput, View } from "react-native";
import { blockText } from "@reactive-resume/resume/proposals";
import { webSources } from "./chat";
import { AssistantMarkdown } from "./markdown";
import { isProposeEdits, skippedCount, toProposals } from "./proposals";
import { client, orpc } from "@/api/client";
import { ReportAiContent } from "@/features/ai/report-content";
import { Button, Icon, Text, showToast, useTheme } from "@/ui";

export type EditStatus = Proposal["status"];

/** What the chat can do with proposed edits: present only when it's about a document. */
export type ProposalHandlers = {
	statuses: ReadonlyMap<string, EditStatus>;
	stateOf: (proposal: Proposal) => ProposalState;
	locked: boolean;
	onAccept: (message: UIMessage, part: ToolPart, proposals: readonly Proposal[]) => void;
	onReject: (message: UIMessage, part: ToolPart, proposals: readonly Proposal[]) => void;
};

type MessageViewProps = {
	message: UIMessage;
	streaming: boolean;
	readOnly: boolean;
	proposals: ProposalHandlers | null;
	/** Null while an answer can't continue the reply (context left out): the question asks for a new message instead. */
	onAnswer: ((toolCallId: string, answer: string) => void) | null;
};

/** Memoized: while a reply streams, only its own message re-renders; the ones above keep their props. */
export const MessageView = memo(function MessageView({
	message,
	streaming,
	readOnly,
	proposals,
	onAnswer,
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
						proposals={proposals}
						onAnswer={onAnswer}
					/>
				);
			})}
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

function ToolPartView({ part, message, streaming, readOnly, proposals, onAnswer }: ToolPartViewProps) {
	const { space } = useTheme();
	const working = part.state === "input-streaming" || part.state === "input-available";

	switch (part.type) {
		case "tool-read_resume":
		case "tool-read_letter":
			return (
				<Status status={working ? "running" : undefined}>
					{part.type === "tool-read_letter" ? <Trans>Read the letter</Trans> : <Trans>Read the resume</Trans>}
				</Status>
			);
		case "tool-read_attachment":
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
			return <QuestionCard part={part} readOnly={readOnly} onAnswer={onAnswer} />;
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
			return (
				<View style={{ gap: space.s2 }}>
					{list.length > 0 ? (
						<ChangeSet
							proposals={list}
							states={list.map(proposals.stateOf)}
							locked={readOnly || proposals.locked}
							onAccept={(chosen) => proposals.onAccept(message, part, chosen)}
							onReject={(chosen) => proposals.onReject(message, part, chosen)}
						/>
					) : null}
					{skipped > 0 ? (
						<Text variant="caption" color="ink3">
							{plural(skipped, {
								one: "# edit couldn't be placed: its text changed. Ask again to redo it.",
								other: "# edits couldn't be placed: their text changed. Ask again to redo them.",
							})}
						</Text>
					) : null}
				</View>
			);
		}
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
		default:
			return null;
	}
}

type QuestionCardProps = Pick<MessageViewProps, "readOnly" | "onAnswer"> & { part: ToolPart };

/** The assistant asks before writing anything the document doesn't say: an info-soft card with its choices. */
function QuestionCard({ part, readOnly, onAnswer }: QuestionCardProps) {
	const { t } = useLingui();
	const { colors, radius, size, space, type } = useTheme();
	const [other, setOther] = useState("");
	const input = (part.input ?? {}) as { question?: unknown; choices?: unknown };
	const question = typeof input.question === "string" ? input.question : "";
	const choices = Array.isArray(input.choices)
		? input.choices.filter((choice): choice is string => typeof choice === "string")
		: [];
	const answer = part.state === "output-available" && typeof part.output === "string" ? part.output : null;
	const toolCallId = part.toolCallId;
	if (!question) return null;

	return (
		<View style={{ gap: space.s3, padding: space.s3, borderRadius: radius.rLg, backgroundColor: colors.infoSoft }}>
			<Text variant="label" color="infoText">
				{question}
			</Text>
			{answer !== null ? (
				<Text variant="callout" color="infoText">
					<Trans>You answered: {answer}</Trans>
				</Text>
			) : readOnly || !toolCallId ? null : !onAnswer ? (
				<Text variant="callout" color="infoText">
					<Trans>Context is left out, so reply with a new message instead.</Trans>
				</Text>
			) : (
				<>
					{choices.length > 0 ? (
						<View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.s2 }}>
							{choices.map((choice) => (
								<Button key={choice} variant="secondary" label={choice} onPress={() => onAnswer(toolCallId, choice)} />
							))}
						</View>
					) : null}
					<View style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}>
						<TextInput
							value={other}
							onChangeText={setOther}
							accessibilityLabel={t`Answer in your own words`}
							placeholder={t`Or in your own words…`}
							placeholderTextColor={colors.ink3}
							returnKeyType="send"
							onSubmitEditing={() => other.trim() && onAnswer(toolCallId, other.trim())}
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
							disabled={!other.trim()}
							onPress={() => onAnswer(toolCallId, other.trim())}
						/>
					</View>
				</>
			)}
		</View>
	);
}

type ChangeSetProps = {
	proposals: readonly Proposal[];
	states: readonly ProposalState[];
	locked: boolean;
	onAccept: (proposals: readonly Proposal[]) => void;
	onReject: (proposals: readonly Proposal[]) => void;
};

/** "n proposed edits" with Accept all, then each edit numbered: where it lands, old text struck, new text, why. */
function ChangeSet({ proposals, states, locked, onAccept, onReject }: ChangeSetProps) {
	const { t } = useLingui();
	const { colors, radius, size, space } = useTheme();
	const pending = proposals.filter((_, index) => states[index] === "pending");
	const accepted = states.filter((state) => state === "accepted").length;

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
					{pending.length > 0
						? plural(proposals.length, { one: "# proposed edit", other: "# proposed edits" })
						: t`${accepted} of ${proposals.length} applied`}
				</Text>
				{pending.length > 1 ? (
					<Button size="sm" label={t`Accept all`} disabled={locked} onPress={() => onAccept(pending)} />
				) : null}
			</View>
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
					{proposal.before ? (
						<Text variant="callout" color="ink3" style={{ textDecorationLine: "line-through" }}>
							{blockText(proposal.before)}
						</Text>
					) : null}
					<Text
						variant="callout"
						style={{
							alignSelf: "flex-start",
							paddingHorizontal: space.s1,
							borderRadius: radius.rMd,
							backgroundColor: colors.accentSoft,
						}}
					>
						{blockText(proposal.after)}
					</Text>
					{proposal.why ? (
						<Text variant="caption" color="ink2">
							{proposal.why}
						</Text>
					) : null}
					<ProposalOutcome
						state={states[index] ?? "pending"}
						locked={locked}
						onAccept={() => onAccept([proposal])}
						onReject={() => onReject([proposal])}
					/>
				</View>
			))}
		</View>
	);
}

type ProposalOutcomeProps = { state: ProposalState; locked: boolean; onAccept: () => void; onReject: () => void };

function ProposalOutcome({ state, locked, onAccept, onReject }: ProposalOutcomeProps) {
	const { t } = useLingui();
	const { colors, space } = useTheme();
	if (state === "pending")
		return (
			<View style={{ flexDirection: "row", gap: space.s2 }}>
				<Button label={t`Accept`} disabled={locked} onPress={onAccept} />
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
			{state === "stale" ? <Trans>Out of date: the text has changed since.</Trans> : <Trans>Rejected</Trans>}
		</Text>
	);
}

// ---- Coach memory: a fact proposed for Knowledge, or saved automatically with Undo ----

type RememberOutput = { status?: unknown; id?: unknown; fact?: { text?: unknown } };

function RememberNote({ part }: { part: ToolPart }) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const queryClient = useQueryClient();
	const [outcome, setOutcome] = useState<"pending" | "saved" | "dismissed" | "undone">("pending");
	const [busy, setBusy] = useState(false);
	const output = (part.state === "output-available" ? part.output : null) as RememberOutput | null;
	const text = typeof output?.fact?.text === "string" ? output.fact.text : null;
	if (!output || !text || outcome === "dismissed" || outcome === "undone") return null;
	const refresh = () => void queryClient.invalidateQueries({ queryKey: orpc.career.facts.key() });

	// Memory mode Automatically: already saved, with Undo.
	if (output.status === "saved" && typeof output.id === "string") {
		const id = output.id;
		return (
			<View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s2 }}>
				<Icon name="check-circle" size={18} color={colors.accentText} />
				<Text variant="callout" color="ink2" style={{ flexShrink: 1 }}>
					<Trans>Remembered: “{text}”</Trans>
				</Text>
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
				<Trans>Remember this for future coaching?</Trans>
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
							.catch(() => showToast({ message: t`Couldn't remember that. Try again.` }))
							.finally(() => setBusy(false));
					}}
				/>
				<Button size="sm" variant="ghost" label={t`Not now`} onPress={() => setOutcome("dismissed")} />
			</View>
		</View>
	);
}
