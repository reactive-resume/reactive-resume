import type { MessageContext, ThreadSummary } from "./chat";
import type { AssistantDocument } from "./document";
import type { IconName } from "@/ui";
import { Trans, useLingui } from "@lingui/react/macro";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { useThreads } from "./chat";
import { ChatView, ContextChip } from "./chat-view";
import { useLetterAssistantDocument, useResumeAssistantDocument } from "./document";
import { takeAssistantHandoff } from "./handoff";
import { publishProposals } from "./proposals";
import { ConnectionNotice, ModelButton, ModelSheet, ProviderGate, useConversationProvider } from "./provider";
import { PastConversations } from "./threads";
import { client } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";
import { useLetterStore, useResumeStore } from "@/draft";
import { useHasAIProvider } from "@/features/ai/providers";
import { routes } from "@/routes";
import { Banner, Button, Icon, IconButton, Text, useTheme } from "@/ui";

export type AssistantScreenProps = {
	resumeId: string;
	/** A conversation to open (another document's row in Past conversations opens it here). */
	threadId?: string | undefined;
	/** A question to send in a new conversation as soon as the assistant can. */
	ask?: string | undefined;
	/** Prepare for next step: the application's suggestions (fit, follow-up, interview). */
	prepare?: boolean | undefined;
	/** The application this resume was opened for. */
	applicationId?: string | undefined;
};

/** Another document's conversation opens that document, with the Assistant on it. */
function openElsewhere(router: ReturnType<typeof useRouter>, thread: ThreadSummary) {
	if (thread.workingResumeId && !thread.coverLetterId) {
		router.replace(routes.builder(thread.workingResumeId));
		router.push({ pathname: routes.assistant(thread.workingResumeId), params: { thread: thread.id } });
	} else if (thread.coverLetterId) {
		router.replace(routes.letter(thread.coverLetterId));
		router.push({ pathname: routes.letterAssistant(thread.coverLetterId), params: { thread: thread.id } });
	}
}

const belongsTo = (thread: ThreadSummary, document: AssistantDocument) =>
	document.kind === "letter"
		? thread.coverLetterId === document.id
		: thread.workingResumeId === document.id && !thread.coverLetterId;

/**
 * The builder's Assistant, full screen over the builder: it knows the open resume and the posting it's for, proposes
 * edits as cards (marked on Page), and asks before writing anything the resume doesn't say.
 */
export function AssistantScreen(props: AssistantScreenProps) {
	useSession();
	const document = useResumeAssistantDocument(props.resumeId, props.applicationId);
	const loadFailed = useResumeStore((state) => state.document === null && state.status === "error");
	return (
		<DocumentAssistantScreen
			{...props}
			key={`${getAccountScope()}:${props.resumeId}:${props.threadId}:${props.ask}:${props.prepare}`}
			kind="resume"
			documentId={props.resumeId}
			document={document}
			loadFailed={loadFailed}
		/>
	);
}

export type LetterAssistantScreenProps = Omit<AssistantScreenProps, "resumeId"> & { letterId: string };

export function LetterAssistantScreen(props: LetterAssistantScreenProps) {
	useSession();
	const document = useLetterAssistantDocument(props.letterId, props.applicationId);
	const loadFailed = useLetterStore((state) => state.document === null && state.status === "error");
	return (
		<DocumentAssistantScreen
			{...props}
			key={`${getAccountScope()}:${props.letterId}:${props.threadId}:${props.ask}`}
			kind="letter"
			documentId={props.letterId}
			document={document}
			loadFailed={loadFailed}
		/>
	);
}

type DocumentAssistantScreenProps = Omit<AssistantScreenProps, "resumeId"> & {
	kind: "resume" | "letter";
	documentId: string;
	document: AssistantDocument | null;
	loadFailed: boolean;
};

function DocumentAssistantScreen(props: DocumentAssistantScreenProps) {
	const router = useRouter();
	const { t } = useLingui();
	const { colors, space } = useTheme();
	const session = useSession();
	const { document, loadFailed } = props;
	const store = props.kind === "letter" ? useLetterStore : useResumeStore;
	const providers = useHasAIProvider();
	const threads = useThreads();
	// Text the coach handed over for this resume and account: it waits in a new conversation's box, unsent.
	const [handed] = useState(() =>
		props.kind === "resume" ? takeAssistantHandoff(getAccountScope(), props.documentId) : null,
	);
	// null: the document's latest conversation; "new": a new one.
	const [selected, setSelected] = useState<string | null>(
		props.ask || props.prepare || handed ? "new" : (props.threadId ?? null),
	);
	const [ask, setAsk] = useState(props.ask ?? null);
	const [prepare, setPrepare] = useState(props.prepare ?? false);
	const [view, setView] = useState<"thread" | "history">("thread");
	const [modelOpen, setModelOpen] = useState(false);
	const [context, setContext] = useState<MessageContext>({ document: true, posting: true });
	const [draftKey, setDraftKey] = useState(0);

	const mine = document ? (threads.data ?? []).filter((thread) => belongsTo(thread, document)) : [];
	const threadId = selected === "new" ? null : (selected ?? mine[0]?.id ?? null);
	const summary = mine.find((thread) => thread.id === threadId);
	const { provider, stranded, label, choose } = useConversationProvider(providers, summary, threadId);

	const newConversation = () => {
		if (props.kind === "resume") publishProposals(props.documentId, []);
		setDraftKey((key) => key + 1);
		setContext({ document: true, posting: true });
		setSelected("new");
		setView("thread");
	};

	const openThread = (thread: ThreadSummary) => {
		if (!document || !belongsTo(thread, document)) return openElsewhere(router, thread);
		setDraftKey((key) => key + 1);
		setContext({ document: true, posting: true });
		setSelected(thread.id);
		setView("thread");
	};

	// Explicit links must belong to this document. Never silently replace a missing or mismatched selection.
	const linked = selected !== null && selected === props.threadId ? selected : null;
	const linkInvalid = linked && threads.data && document && !mine.some((thread) => thread.id === linked);

	const waiting = (message: string, action?: { label: string; onPress: () => void }) => (
		<View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: space.s2, padding: space.s4 }}>
			<ActivityIndicator />
			<Text color="ink2" align="center">
				{message}
			</Text>
			{action ? <Button variant="link" label={action.label} onPress={action.onPress} /> : null}
		</View>
	);
	const notice = (tone: "warn" | "danger", message: string, action: { label: string; onPress: () => void }) => (
		<View style={{ padding: space.s4 }}>
			<Banner tone={tone} message={message} action={action} />
		</View>
	);

	// Chat (and Accept) mounts only after every check passes; each other state says what it waits for or offers a way on.
	const body =
		session.status !== "signed-in" ? (
			notice("warn", t`Sign in to use the assistant.`, {
				label: t`Sign in`,
				onPress: () => router.push(routes.signIn()),
			})
		) : loadFailed ? (
			notice("danger", props.kind === "letter" ? t`Couldn't load the cover letter.` : t`Couldn't load the resume.`, {
				label: t`Retry`,
				onPress: () =>
					void store
						.getState()
						.open(props.documentId)
						.catch(() => undefined),
			})
		) : !document ? (
			waiting(props.kind === "letter" ? t`Opening the letter…` : t`Opening the resume…`, {
				label: props.kind === "letter" ? t`Open letter` : t`Open resume`,
				onPress: () =>
					router.replace(props.kind === "letter" ? routes.letter(props.documentId) : routes.builder(props.documentId)),
			})
		) : threads.isError ? (
			notice("danger", t`Conversations couldn't load.`, { label: t`Retry`, onPress: () => void threads.refetch() })
		) : !threads.data ? (
			waiting(t`Loading conversations…`)
		) : linkInvalid && view !== "history" ? (
			notice("warn", t`This conversation couldn't be opened.`, {
				label: t`New conversation`,
				onPress: () => setSelected("new"),
			})
		) : view === "history" ? (
			<PastConversations
				threads={threads.data ?? []}
				isMine={(thread) => belongsTo(thread, document)}
				currentId={threadId}
				onOpen={openThread}
				onDeleted={(id) => {
					if (id === threadId) setSelected("new");
				}}
			/>
		) : (
			<ChatView
				key={draftKey}
				threadId={threadId}
				createThread={async (scope) =>
					(
						await client.agent.threads.start(
							{
								...(document.kind === "letter" ? { coverLetterId: document.id } : { resumeId: document.id }),
								...(provider ? { aiProviderId: provider.id } : {}),
							},
							{ context: { scope } },
						)
					).id
				}
				onThreadCreated={(id) => {
					setSelected(id);
					setPrepare(false);
					void threads.refetch();
				}}
				context={{ ...context, ...(document.posting ? { applicationId: document.posting.id } : {}) }}
				document={document}
				connection={label}
				privacy={disclosure(t, document, context, label)}
				placeholder={t`Ask, or describe a change…`}
				assistantName={t`Assistant`}
				disabled={document.locked || !provider}
				{...(handed && threadId === null ? { draft: handed } : {})}
				notice={
					stranded ? (
						<ConnectionNotice
							label={summary?.providerLabel ?? null}
							fallback={providers.usableProviders[0]}
							onUse={(id) => void choose(id)}
							onChoose={() => setModelOpen(true)}
						/>
					) : null
				}
				prompt={ask}
				onPromptSent={() => setAsk(null)}
				onSwitchModel={() => setModelOpen(true)}
				chips={
					<>
						<ContextChip
							icon="brain"
							label={t`Knowledge`}
							pressed={context.memory === true}
							onPress={() => setContext({ ...context, memory: !context.memory })}
						/>
						{context.document ? (
							<ContextChip
								icon="file-text"
								label={document.name}
								removeLabel={t`Don't send ${document.name}`}
								onRemove={() => setContext({ ...context, document: false })}
							/>
						) : null}
						{context.posting && document.posting ? (
							<ContextChip
								icon="briefcase"
								label={t`${document.posting.company} posting`}
								removeLabel={t`Don't send ${document.posting.company} posting`}
								onRemove={() => setContext({ ...context, posting: false })}
							/>
						) : null}
						<ContextChip
							icon="brain"
							label={t`Use Knowledge`}
							pressed={context.memory === true}
							onPress={() => setContext({ ...context, memory: context.memory !== true })}
						/>
						{needsJobCopy(document, context) && document.posting ? (
							<Button
								size="sm"
								variant="secondary"
								label={t`Copy for this job`}
								onPress={() =>
									router.push({
										pathname: routes.new(),
										params: { step: "copy", applicationId: document.posting?.id, sourceResumeId: document.id },
									})
								}
							/>
						) : null}
					</>
				}
				empty={(send) => <Suggestions document={document} prepare={prepare} onPick={send} />}
			/>
		);

	const gate = (
		<ProviderGate
			providers={providers}
			readOnly={view === "history" || threadId !== null}
			threadsError={threads.error}
			loading={threads.isPending}
			onRetry={() => {
				providers.retry();
				void threads.refetch();
			}}
			notSetUp={t`The assistant isn't set up on this server. Whoever runs it needs to set ENCRYPTION_SECRET. Everything else works without it.`}
		>
			{body}
		</ProviderGate>
	);

	return (
		<SafeAreaProvider>
			<SafeAreaView edges={["top", "bottom", "left", "right"]} style={{ flex: 1, backgroundColor: colors.surface }}>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						minHeight: 52,
						paddingStart: space.s3,
						paddingEnd: space.s1,
						borderBottomWidth: 1,
						borderColor: colors.line,
					}}
				>
					<Icon name="sparkle" size={20} color={colors.accent} />
					<View style={{ flex: 1, paddingStart: space.s2 }}>
						<Text variant="title" accessibilityRole="header">
							<Trans>Assistant</Trans>
						</Text>
						{providers.hasAIProvider ? (
							<ModelButton label={provider?.model ?? label} onPress={() => setModelOpen(true)} />
						) : null}
					</View>
					<IconButton icon="note-pencil" label={t`New conversation`} onPress={newConversation} />
					<IconButton
						icon="clock-counter-clockwise"
						label={t`Past conversations`}
						selected={view === "history"}
						onPress={() => setView(view === "history" ? "thread" : "history")}
					/>
					<IconButton icon="x" label={t`Close the assistant`} onPress={() => router.back()} />
				</View>

				{props.kind === "resume" ? (
					<View style={{ gap: space.s2, padding: space.s3, borderBottomWidth: 1, borderColor: colors.line }}>
						<Text variant="caption" color="ink2">
							<Trans>
								I can edit your summary, bullets and text fields, and add entries and sections. Review each set before
								accepting it together. Some fields still need Write. I can't translate a whole resume.
							</Trans>
						</Text>
						<Button
							variant="link"
							label={t`Open Write`}
							onPress={() =>
								router.replace({
									pathname: routes.builder(props.documentId, "write"),
									params: props.applicationId ? { applicationId: props.applicationId } : {},
								})
							}
						/>
					</View>
				) : null}
				{gate}

				<ModelSheet
					open={modelOpen}
					onClose={() => setModelOpen(false)}
					providers={providers.usableProviders}
					currentId={provider?.id}
					onChoose={(id) => void choose(id)}
				/>
			</SafeAreaView>
		</SafeAreaProvider>
	);
}

type Translate = ReturnType<typeof useLingui>["t"];

/** What a send shares, and with whom (web's disclosure line). */
function disclosure(t: Translate, document: AssistantDocument, context: MessageContext, provider: string) {
	const posting = context.posting && document.posting;
	const sends = context.document
		? document.kind === "letter"
			? posting
				? t`Sends this letter and the posting to ${provider} with your key, only when you tap send.`
				: t`Sends this letter to ${provider} with your key, only when you tap send.`
			: posting
				? t`Sends this resume and the posting to ${provider} with your key, only when you tap send.`
				: t`Sends this resume to ${provider} with your key, only when you tap send.`
		: posting
			? t`Sends your message and the posting to ${provider} with your key, only when you tap send.`
			: t`Sends your message to ${provider} with your key, only when you tap send.`;
	const history =
		!context.document || !context.posting
			? t`Each send starts fresh with this message and selected files. Previous conversation history stays here.`
			: t`Previous messages, including document details, are also sent.`;
	const knowledge =
		context.memory === true ? ` ${t`Knowledge facts and stories the assistant looks up are sent too.`}` : "";
	const copy =
		needsJobCopy(document, context) && document.posting
			? ` ${t`Edits that use the ${document.posting.company} posting go to a copy made for that job, so this resume stays unchanged.`}`
			: "";
	return `${sends}${knowledge} ${history}${copy}`;
}

/** Tailoring needs the job's own copy: the server refuses edits that use the posting on a resume other jobs share. */
const needsJobCopy = (document: AssistantDocument, context: MessageContext) =>
	document.kind === "resume" && Boolean(context.posting && document.posting) && !document.jobCopy;

type Suggestion = { icon: IconName; label: string; hint: string };

type SuggestionsProps = { document: AssistantDocument; prepare: boolean; onPick: (text: string) => void };

/** "What should we work on?" with starters that send at once. */
function Suggestions({ document, prepare, onPick }: SuggestionsProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const company = document.posting?.company;
	const tailor: Suggestion[] = company
		? [{ icon: "briefcase", label: t`Tailor to the ${company} posting`, hint: t`Uses the linked application` }]
		: [];
	let suggestions: Suggestion[] =
		prepare && company
			? [
					{ icon: "briefcase", label: t`How well do I fit this role?`, hint: t`Compares your resume with the posting` },
					{ icon: "envelope-simple", label: t`Draft a follow-up email`, hint: t`Short and polite, for the recruiter` },
					{
						icon: "chat-text",
						label: t`Prepare me for the interview`,
						hint: t`Likely questions, from the posting and your resume`,
					},
					...tailor,
				]
			: [
					...tailor,
					{ icon: "scissors", label: t`Find weak bullets`, hint: t`Checks every bullet for action and result` },
					{
						icon: "arrows-in-line-vertical",
						label: t`Tighten to one page`,
						hint: t`Suggests cuts, never deletes on its own`,
					},
					{ icon: "text-align-left", label: t`Draft a summary`, hint: t`From your experience entries` },
				];
	if (document.kind === "letter")
		suggestions = [
			...tailor,
			{ icon: "lightning", label: t`Make the opening stronger`, hint: t`Leads with why you fit` },
			{ icon: "arrows-in-line-vertical", label: t`Make it shorter`, hint: t`Keeps the most specific parts` },
			{ icon: "text-align-left", label: t`Make it more specific`, hint: t`Uses facts from your resume` },
		];

	return (
		<View style={{ gap: space.s4, paddingTop: space.s4 }}>
			<View style={{ gap: space.s2 }}>
				<Text variant="heading" accessibilityRole="header">
					<Trans>What should we work on?</Trans>
				</Text>
				<Text color="ink2">
					{document.kind === "letter" ? (
						company ? (
							<Trans>
								I can see this letter and the {company} posting. Suggestions come back as edits you can accept one by
								one.
							</Trans>
						) : (
							<Trans>I can see this letter. Suggestions come back as edits you can review before accepting.</Trans>
						)
					) : company ? (
						<Trans>
							I can see this resume and the {company} posting. Suggestions come back as edits you can review before
							accepting.
						</Trans>
					) : (
						<Trans>I can see this resume. Suggestions come back as edits you can review before accepting.</Trans>
					)}
				</Text>
				{document.locked ? (
					<Text variant="callout" color="warnText">
						<Trans>This document is locked. Unlock it to get suggestions.</Trans>
					</Text>
				) : null}
			</View>
			<View style={{ gap: space.s2 }}>
				{suggestions.map((suggestion) => (
					<Pressable
						key={suggestion.label}
						accessibilityRole="button"
						accessibilityHint={suggestion.hint}
						disabled={document.locked}
						onPress={() => onPick(suggestion.label)}
						style={({ pressed }) => ({
							flexDirection: "row",
							alignItems: "center",
							gap: space.s3,
							minHeight: 52,
							paddingHorizontal: space.s3,
							paddingVertical: space.s2,
							borderWidth: 1,
							borderColor: colors.line,
							borderRadius: radius.rLg,
							backgroundColor: pressed ? colors.press : "transparent",
							opacity: document.locked ? 0.45 : 1,
						})}
					>
						<Icon name={suggestion.icon} size={20} color={colors.ink2} />
						<View style={{ flex: 1 }}>
							<Text variant="label" numberOfLines={1}>
								{suggestion.label}
							</Text>
							<Text variant="caption" color="ink3" numberOfLines={1}>
								{suggestion.hint}
							</Text>
						</View>
					</Pressable>
				))}
			</View>
		</View>
	);
}
