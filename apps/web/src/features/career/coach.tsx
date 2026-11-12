import type { MessageContext } from "@/features/assistant/chat";
import type { RouterOutput } from "@/libs/orpc/client";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { UIMessage } from "ai";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { coachStarters, type CoachStarter } from "@reactive-resume/schema/career-starters";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@reactive-resume/ui/components/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Sheet, SheetContent, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { buildConversationTitle } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { CareerCrumb } from "./career-crumb";
import {
	CoachThread,
	connectionName,
	copyToClipboard,
	deleteConversation,
	dropPrompt,
	takePrompt,
	titleFor,
	useCoachKnowledge,
	useConversationDate,
	WebResearchChip,
	useWebSearch,
} from "./coach-thread";
import { useProfile } from "./knowledge/preferences";
import { CareerLoadError } from "./load-state";
import { PracticeHandoff } from "./prepare-now";
import { ContextChip, PrivacyLine } from "./shared";
import { List, ListRow } from "@/components/calm/list-row";
import { Page, PageBody, PageHeader } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { PhoneHeaderActions } from "@/components/layout/phone-header-actions";
import { SetUpAi as SetUpAiFor } from "@/features/ai/set-up-ai";
import { collectInterviews, upcomingInterviews } from "@/features/applications/interviews";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { transcriptOf } from "@/features/assistant/chat";
import { ChatWelcome, ModelMenu } from "@/features/assistant/chat-chrome";
import { ConnectionNotice } from "@/features/assistant/connection-notice";
import { SetUpAi } from "@/features/assistant/provider-setup";
import { WebAccessAttention } from "@/features/settings/ai/web-access";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type ThreadSummary = RouterOutput["agent"]["threads"]["list"][number];
// ---- Context chips: per conversation, in this browser; new conversations start from the defaults. ----

type Chips = { application: boolean; memory: boolean; web: boolean; offers: boolean };
const DEFAULT_CHIPS: Chips = { application: true, memory: true, web: false, offers: true };
const chipsKey = (id: string) => `career-context:${id}`;

function readChips(id: string | null): Chips {
	if (!id) return DEFAULT_CHIPS;
	try {
		const raw = localStorage.getItem(chipsKey(id));
		return raw ? { ...DEFAULT_CHIPS, ...(JSON.parse(raw) as Partial<Chips>) } : DEFAULT_CHIPS;
	} catch {
		return DEFAULT_CHIPS;
	}
}

function writeChips(id: string, chips: Chips) {
	try {
		localStorage.setItem(chipsKey(id), JSON.stringify(chips));
	} catch {
		// A convenience: without storage the chips reset when the conversation reopens.
	}
}

function readOfferIds(id: string | null): string[] {
	if (!id) return [];
	try {
		const value: unknown = JSON.parse(localStorage.getItem(`career-offers:${id}`) ?? "[]");
		return Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string" && item.length > 0).slice(0, 2)
			: [];
	} catch {
		return [];
	}
}

function writeOfferIds(id: string, offers: string[]) {
	try {
		localStorage.setItem(`career-offers:${id}`, JSON.stringify(offers));
	} catch {
		/* Storage may be unavailable. The URL still carries this session's selection. */
	}
}

type CoachPageProps = { conversationId: string | undefined; offerIds: string[] };

/** C7–C11: conversations about the whole search, with what each message shares chosen in the composer. */
export function CoachPage({ conversationId, offerIds: routeOfferIds }: CoachPageProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const breakpoint = useBreakpoint();
	const wide = breakpoint === "wide";
	const providers = useHasUsableAiProvider();
	const threads = useQuery(orpc.agent.threads.list.queryOptions());
	const knowledge = useCoachKnowledge(null);
	const [railOpen, setRailOpen] = useState(false);
	const [renaming, setRenaming] = useState<string | null>(null);
	const railOpener = useRef<HTMLElement | null>(null);
	const titleButton = useRef<HTMLButtonElement | null>(null);
	const focusTarget = () => (railOpener.current?.isConnected ? railOpener.current : titleButton.current);
	useEffect(() => {
		if (wide && renaming === null && document.activeElement === document.body) focusTarget()?.focus();
	}, [wide, renaming]);
	const [modelMenuOpen, setModelMenuOpen] = useState(false);
	const [copySlot, setCopySlot] = useState<HTMLSpanElement | null>(null);
	const [providerId, setProviderId] = useState<string | null>(null);
	const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
	const created = useRef<ThreadSummary | null>(null);

	// The conversation shown: the URL's, or the one just created here while the URL catches up. Arriving at the thread
	// that was just created keeps the chat mounted, so its first answer keeps streaming.
	const [session, setSession] = useState({ key: 0, created: null as string | null, url: conversationId });
	if (session.url !== conversationId) {
		const same = conversationId !== undefined && conversationId === session.created;
		setSession({
			key: same ? session.key : session.key + 1,
			created: same ? session.created : null,
			url: conversationId,
		});
	}
	const threadId = conversationId ?? session.created;
	// A first message written on Career's page, sent as this conversation opens.
	const initialPrompt = takePrompt(threadId);
	useEffect(() => dropPrompt(threadId), [threadId]);
	const offerIds = routeOfferIds.length > 0 ? routeOfferIds : readOfferIds(threadId);
	useEffect(() => {
		if (threadId && routeOfferIds.length > 0) writeOfferIds(threadId, routeOfferIds);
	}, [threadId, routeOfferIds]);

	const [stored, setStored] = useState(() => ({ id: threadId, chips: readChips(threadId) }));
	if (stored.id !== threadId) {
		// The conversation just created here keeps the chips it was started with; storage may be blocked or full.
		const justCreated = stored.id === null && threadId !== null && threadId === session.created;
		setStored({ id: threadId, chips: justCreated ? stored.chips : readChips(threadId) });
	}
	const chips = stored.chips;
	const setChips = (next: Chips) => {
		setStored({ id: threadId, chips: next });
		if (threadId) writeChips(threadId, next);
	};

	const listKey = orpc.agent.threads.list.queryKey();
	const conversations = (threads.data ?? []).filter((thread) => thread.scope === "career" && !hidden.has(thread.id));
	const summary = threads.data?.find((thread) => thread.id === threadId);
	const usable = providers.usableProviders;

	// A conversation runs on its own connection. One switched off or removed is never swapped silently: the user picks
	// another before the next message goes anywhere. A new conversation starts on the default (listed first).
	const saved = summary ? usable.find((item) => item.id === summary.aiProviderId) : undefined;
	const stranded = summary !== undefined && saved === undefined && !providers.isLoading;
	const provider = summary ? saved : (usable.find((item) => item.id === providerId) ?? usable[0]);
	const label = provider?.label ?? summary?.providerLabel ?? t`Your AI`;
	const connection = connectionName(label);
	const web = useWebSearch(provider);
	const webAccess = web.status;

	const context: MessageContext = {
		// A career conversation has no document or posting to leave out.
		document: true,
		posting: true,
		application: chips.application,
		memory: chips.memory,
		// The message still requires Web research on and per-operation destination approval.
		web: chips.web && web.canSearch,
		...(offerIds.length > 0 && chips.offers ? { offerIds } : {}),
	};

	const createThread = async () => {
		const thread = await client.agent.threads.start({
			scope: "career",
			...(provider ? { aiProviderId: provider.id } : {}),
		});
		created.current = thread;
		return thread.id;
	};

	const onThreadCreated = (id: string, text: string) => {
		queryClient.setQueryData(listKey, (old) => {
			const thread = old?.find((item) => item.id === id) ?? (created.current?.id === id ? created.current : undefined);
			if (!old || !thread) return old;
			return [
				{ ...thread, title: buildConversationTitle(text, thread.title, 47), lastMessageAt: new Date() },
				...old.filter((item) => item.id !== id),
			];
		});
		// No longer a draft: the URL names it from here on.
		created.current = null;
		writeChips(id, chips);
		writeOfferIds(id, offerIds);
		setSession((current) => ({ ...current, created: id }));
		void navigate({
			to: "/dashboard/career/coach/{-$conversationId}",
			params: { conversationId: id },
			search: offerIds.length > 0 ? { offers: offerIds } : {},
			replace: true,
		});
	};

	const chooseProvider = async (id: string) => {
		setProviderId(id);
		// A draft created for an attachment exists before the URL names it.
		const target = threadId ?? created.current?.id;
		if (!target) return;
		const chosen = usable.find((item) => item.id === id);
		queryClient.setQueryData(listKey, (old) =>
			old?.map((thread) =>
				thread.id === target ? { ...thread, aiProviderId: id, providerLabel: chosen?.label ?? null } : thread,
			),
		);
		try {
			await client.agent.threads.update({ id: target, aiProviderId: id });
		} catch (error) {
			toastError(error, t`Couldn't switch connections. Try again.`);
		}
		void queryClient.invalidateQueries({ queryKey: orpc.agent.threads.list.key() });
	};

	const rename = async (thread: ThreadSummary, title: string) => {
		const next = title.trim();
		if (!next || next === thread.title || next === titleFor(thread)) return;
		queryClient.setQueryData(listKey, (old) =>
			old?.map((item) => (item.id === thread.id ? { ...item, title: next } : item)),
		);
		try {
			await client.agent.threads.update({ id: thread.id, title: next });
		} catch (error) {
			toastError(error, t`Couldn't rename this conversation. Try again.`);
		}
		void queryClient.invalidateQueries({ queryKey: orpc.agent.threads.list.key() });
	};

	const remove = (thread: ThreadSummary) =>
		deleteConversation(
			queryClient,
			thread.id,
			() => {
				setHidden((current) => new Set(current).add(thread.id));
				if (thread.id === threadId)
					void navigate({ to: "/dashboard/career/coach/{-$conversationId}", params: { conversationId: undefined } });
			},
			() =>
				setHidden((current) => {
					const next = new Set(current);
					next.delete(thread.id);
					return next;
				}),
		);

	// Only states that block or delay sending get a line; what each message shares shows in the chips.
	const privacy = () => {
		const note = stranded
			? t`Nothing is sent until you choose a connection for this conversation.`
			: chips.memory && knowledge.isError
				? t`Knowledge couldn't load. Try again or switch Knowledge off before sending.`
				: chips.memory && knowledge.isPending
					? t`Loading Knowledge before you send…`
					: null;
		return note && <PrivacyLine>{note}</PrivacyLine>;
	};

	const contextChips = (
		<>
			{chips.memory && knowledge.isError && <CareerLoadError onRetry={knowledge.retry} />}
			<ContextChip
				icon="briefcase"
				pressed={chips.application}
				onPressedChange={(application) => setChips({ ...chips, application })}
				label={t`Applications`}
				tooltip={t`Summaries of your open applications`}
			/>
			<ContextChip
				icon="books"
				pressed={chips.memory}
				onPressedChange={(memory) => setChips({ ...chips, memory })}
				label={plural(knowledge.kept, { one: "Knowledge · # fact", other: "Knowledge · # facts" })}
				tooltip={
					chips.memory
						? t`Facts, stories and preferences that are switched on in Knowledge`
						: t`Knowledge is off for this message: the coach doesn't read it or remember anything you say`
				}
			/>
			<WebResearchChip
				status={webAccess}
				fallbackLabel={web.fallbackLabel}
				pressed={chips.web}
				onPressedChange={(web) => setChips({ ...chips, web })}
			/>
			{offerIds.length > 0 && (
				<ContextChip
					pressed={chips.offers}
					onPressedChange={(offers) => setChips({ ...chips, offers })}
					label={plural(offerIds.length, { one: "# saved offer", other: "# saved offers" })}
					tooltip={t`The offers you chose to compare, with their terms`}
				/>
			)}
		</>
	);

	// The copy button needs the messages, which only the thread holds: it renders into the page header's slot.
	const header = (messages: readonly UIMessage[]) => (
		<>
			{copySlot &&
				createPortal(
					<IconButton
						icon="copy"
						label={t`Copy conversation`}
						className="text-ink-2"
						disabled={messages.length === 0}
						onClick={() =>
							void copyToClipboard(
								transcriptOf(messages, { user: t`You`, assistant: t`Coach`, sources: t`Sources` }),
								t`Conversation copied`,
							)
						}
					/>,
					copySlot,
				)}
			<PracticeHandoff />
		</>
	);

	const startRename = (opener: HTMLElement) => {
		if (!summary) return;
		railOpener.current = opener;
		setRenaming(summary.id);
		if (!wide) setRailOpen(true);
	};

	const pageActions = (
		<div className="flex items-center gap-1">
			{!wide && (
				<IconButton
					icon="clock-counter-clockwise"
					label={t`Conversations`}
					className="text-ink-2"
					onClick={(event) => {
						railOpener.current = event.currentTarget;
						setRailOpen(true);
					}}
				/>
			)}
			{(usable.length > 0 || summary) && (
				// The trigger caps itself at half its container, which here is only as wide as the trigger.
				<div className="flex min-w-0 [&>button]:max-w-[320px]">
					<ModelMenu
						variant="ghost"
						size="default"
						open={modelMenuOpen}
						onOpenChange={setModelMenuOpen}
						onConnect={() => void navigate({ to: "/dashboard/settings/ai" })}
						providers={usable}
						current={provider}
						label={label}
						onChoose={(id) => void chooseProvider(id)}
					/>
				</div>
			)}
			<span ref={setCopySlot} className="contents" />
			{summary && (
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<IconButton
								ref={titleButton}
								icon="dots-three"
								label={t`Rename or delete this conversation`}
								className="text-ink-2"
							/>
						}
					/>
					<DropdownMenuContent align="end" finalFocus={false}>
						<DropdownMenuItem onClick={() => titleButton.current && startRename(titleButton.current)}>
							<Icon name="pencil-simple" />
							<Trans>Rename</Trans>
						</DropdownMenuItem>
						<DropdownMenuItem variant="destructive" onClick={() => remove(summary)}>
							<Icon name="trash" />
							<Trans>Delete</Trans>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			)}
			<PhoneHeaderActions />
		</div>
	);

	const notSetUp = threads.error instanceof ORPCError && threads.error.code === "PRECONDITION_FAILED";
	const noProvider = !providers.isUnavailable && !providers.hasUsableProvider && !threadId;

	const rail = (
		<ConversationRail
			threads={conversations}
			currentId={threadId}
			renaming={renaming}
			onRenamingChange={setRenaming}
			onNavigate={() => setRailOpen(false)}
			onRename={(thread, title) => void rename(thread, title)}
			onDelete={remove}
		/>
	);

	// What the main column shows: a state that blocks the coach, or the conversation.
	const body = (
		<>
			{notSetUp ? (
				<>
					{header([])}
					<WebAccessAttention />
					<p className="m-6 rounded-xl bg-sunken p-4 text-sm text-ink-2">
						<Trans>
							The coach isn't set up on this server. Whoever runs it needs to set ENCRYPTION_SECRET. Knowledge, Offers
							and your applications work without it.
						</Trans>
					</p>
				</>
			) : providers.error && !threadId ? (
				<AiProviderLoadState
					state={{
						...providers,
						retry: () => {
							providers.retry();
							void threads.refetch();
							knowledge.retry();
						},
					}}
				/>
			) : (providers.isLoading && !threadId) || threads.isPending ? (
				<div className="grid flex-1 place-items-center">
					<Spinner />
				</div>
			) : threads.isError && !threads.data ? (
				<CareerLoadError
					onRetry={() => {
						void threads.refetch();
						providers.retry();
					}}
				/>
			) : noProvider && !threadId ? (
				<>
					{header([])}
					<div className="min-h-0 flex-1 overflow-y-auto">
						<div className="mx-auto max-w-[560px] px-4 py-6">
							<SetUpAiFor
								needs={<Trans>The coach needs AI.</Trans>}
								works={<Trans>Today, Knowledge, offers and schedules work without it.</Trans>}
							/>
						</div>
					</div>
				</>
			) : (
				<>
					<WebAccessAttention />
					{!provider && (
						<div role="status" className="grid justify-items-start gap-2 bg-warn-soft p-3 text-sm text-warn-text">
							<Trans>
								This conversation's AI connection is unavailable. Its history stays here. Fix the saved connection or
								choose a model before sending again.
							</Trans>
							<SetUpAi />
						</div>
					)}
					<CoachThread
						key={session.key}
						draftKey={`career-coach:${threadId ?? "new"}`}
						threadId={threadId}
						initialPrompt={initialPrompt}
						createThread={createThread}
						onThreadCreated={onThreadCreated}
						applicationId={null}
						context={context}
						connection={connection}
						onChangeConnection={() => setModelMenuOpen(true)}
						header={header}
						empty={(send) => (
							<EmptyState
								disabled={!provider || (chips.memory && (knowledge.isPending || knowledge.isError))}
								offers={context.offerIds?.length ?? 0}
								onPick={send}
							/>
						)}
						chips={contextChips}
						notice={
							stranded ? (
								<ConnectionNotice
									label={summary?.providerLabel ?? null}
									fallback={usable[0]}
									onUse={(id) => void chooseProvider(id)}
									onChoose={() => setModelMenuOpen(true)}
								/>
							) : null
						}
						privacy={privacy}
						placeholder={t`Ask about your next career step…`}
						disabled={!provider || (chips.memory && (knowledge.isPending || knowledge.isError))}
						variant="page"
					/>
				</>
			)}
		</>
	);

	return (
		// The conversation fills what's left of the window height and scrolls inside; the aside sits beside it from 1280.
		<Page className="min-h-0">
			<PageBody className="flex min-h-[560px] flex-1 flex-col pb-0 max-sm:min-h-0">
				<PageHeader crumb={<CareerCrumb />} title={titleFor(summary)} actions={pageActions} />
				<div className="mt-2 grid min-h-0 flex-1 gap-12 xl:grid-cols-[minmax(0,1fr)_320px]">
					<section aria-label={t`Coach`} className="flex min-h-0 min-w-0 flex-col border-t border-line">
						{body}
					</section>
					{wide ? (
						<aside className="min-h-0 overflow-y-auto">{rail}</aside>
					) : (
						<Sheet open={railOpen} onOpenChange={setRailOpen}>
							<SheetContent
								side="left"
								finalFocus={focusTarget}
								closeLabel={t`Close`}
								className="p-4 pt-5 data-[side=left]:sm:max-w-[320px]"
							>
								<SheetTitle className="sr-only">
									<Trans>Conversations</Trans>
								</SheetTitle>
								{rail}
							</SheetContent>
						</Sheet>
					)}
				</div>
			</PageBody>
		</Page>
	);
}

/** `offers`: saved offers sent with this conversation (Offers → Plan what to ask), which get their own starters. */
type EmptyStateProps = { disabled: boolean; offers: number; onPick: (text: string) => void };

/** Opened from Offers → Plan what to ask: starters about the offers being decided. */
const offerStarters = (count: number): { icon: IconName; text: string }[] =>
	count > 1
		? [
				{ icon: "question", text: t`What should I ask before deciding?` },
				{ icon: "scales", text: t`Which offer fits my requirements better?` },
				{ icon: "list-checks", text: t`What's missing from these offers that I should get in writing?` },
			]
		: [
				{ icon: "question", text: t`What should I ask before deciding on this offer?` },
				{ icon: "scales", text: t`Does this offer meet what I want?` },
				{ icon: "list-checks", text: t`What's missing from this offer that I should get in writing?` },
			];

const starterText = (starter: CoachStarter): { icon: IconName; text: string } => {
	switch (starter.kind) {
		case "interview":
			return { icon: "microphone", text: t`Help me prepare for my ${starter.company} interview.` };
		case "offers":
			return { icon: "scales", text: t`Help me weigh the offer I have against what I want.` };
		case "opportunities":
			return { icon: "list-magnifying-glass", text: t`Which opportunities best match my priorities?` };
		case "story":
			return {
				icon: "list-numbers",
				text: t`Help me turn an accomplishment into a Situation, Task, Action, Result and Reflection story.`,
			};
		case "practice":
			return { icon: "user-sound", text: t`What interview answers should I practice?` };
		default:
			return { icon: "compass", text: t`What kinds of roles fit what I've done so far?` };
	}
};

/** Starters that fit the account: an upcoming interview, an offer or found roles come first when there are some. */
function useStarters() {
	const applications = useQuery(applicationsListQueryOptions());
	const opportunities = useQuery(orpc.career.opportunities.queryOptions({ input: {} }));
	const open = (applications.data ?? []).filter((application) => application.status !== "closed");
	const next = upcomingInterviews(collectInterviews(open))[0];
	return coachStarters({
		nextInterviewCompany: next?.application.company,
		offers: open.filter((application) => application.status === "offer").length,
		opportunities: (opportunities.data ?? []).filter((row) => !row.trackedApplicationId).length,
	}).map(starterText);
}

function EmptyState({ disabled, offers, onPick }: EmptyStateProps) {
	const accountStarters = useStarters();
	const starters = offers > 0 ? offerStarters(offers) : accountStarters;
	return (
		<div className="pt-[clamp(0px,6vh,48px)]">
			<ChatWelcome
				description={
					<>
						<Trans>
							Ask about your search, or bring an accomplishment you want to explain better. Answers use what's switched
							on below, and each shows what was sent with it.
						</Trans>
					</>
				}
				starters={starters.map((starter) => ({
					icon: starter.icon,
					label: starter.text,
					disabled,
					onPick: () => onPick(starter.text),
				}))}
			/>
		</div>
	);
}

// ---- Rail ----

type ConversationRailProps = {
	threads: ThreadSummary[];
	currentId: string | null;
	renaming: string | null;
	onRenamingChange: (id: string | null) => void;
	onNavigate: () => void;
	onRename: (thread: ThreadSummary, title: string) => void;
	onDelete: (thread: ThreadSummary) => void;
};

function ConversationRail({
	threads,
	currentId,
	renaming,
	onRenamingChange: setRenaming,
	onNavigate,
	onRename,
	onDelete,
}: ConversationRailProps) {
	const when = useConversationDate();
	const applications = useQuery(applicationsListQueryOptions());
	const dateOf = (thread: (typeof threads)[number]) => {
		const date = when(new Date(thread.lastMessageAt));
		const about = applications.data?.find((application) => application.id === thread.applicationId)?.company;
		return about ? t`${date} · about ${about}` : date;
	};

	return (
		<nav aria-label={t`Conversations`} className="flex min-h-0 flex-1 flex-col">
			<SectionHeading
				first
				className="pt-3"
				action={
					<Link to="/dashboard/career" onClick={onNavigate}>
						<Trans>New</Trans>
					</Link>
				}
			>
				<Trans>Conversations</Trans>
			</SectionHeading>
			<ul className="grid content-start">
				{currentId === null && (
					<li aria-current="page" className="grid gap-px rounded-lg bg-sunken px-3 py-2.5">
						<span className="text-sm/5 font-semibold">
							<Trans>New conversation</Trans>
						</span>
						<span className="text-[13px]/[18px] text-ink-3">
							<Trans>Now</Trans>
						</span>
					</li>
				)}
				{threads.map((thread) => (
					<RailItem
						key={thread.id}
						thread={thread}
						current={thread.id === currentId}
						date={dateOf(thread)}
						renaming={renaming === thread.id}
						onRenameStart={() => setRenaming(thread.id)}
						onRenameEnd={(title) => {
							setRenaming(null);
							if (title !== null) onRename(thread, title);
						}}
						onDelete={() => onDelete(thread)}
						onNavigate={onNavigate}
					/>
				))}
			</ul>
			<p className="pt-2.5 text-[13px]/[18px] text-ink-3">
				<Trans>A conversation about one job also opens from its application.</Trans>
			</p>
			<Remembering onNavigate={onNavigate} />
		</nav>
	);
}

/** What the coach keeps: the memory mode (changed on Facts) and a row to Knowledge. */
function Remembering({ onNavigate }: { onNavigate: () => void }) {
	const { profile } = useProfile();
	const knowledge = useCoachKnowledge(null);
	const stories = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: null } }));
	const mode = profile?.memoryMode;
	const modeLabel =
		mode === "auto" ? t`Automatically` : mode === "off" ? t`Never` : mode === "ask" ? t`Ask first` : null;
	const facts = plural(knowledge.kept, { one: "# fact", other: "# facts" });
	const storyCount = stories.data ? plural(stories.data.length, { one: "# story", other: "# stories" }) : null;
	return (
		<>
			<SectionHeading>
				<Trans>Remembering</Trans>
			</SectionHeading>
			<List>
				<ListRow
					render={<Link to="/dashboard/career/knowledge/facts" onClick={onNavigate} />}
					title={<Trans>Facts from my messages</Trans>}
					subtitle={modeLabel}
					trailing={
						<span className="text-sm font-medium text-accent-text">
							<Trans>Change</Trans>
						</span>
					}
				/>
				<ListRow
					render={<Link to="/dashboard/career/knowledge/facts" onClick={onNavigate} />}
					title={<Trans>Knowledge</Trans>}
					subtitle={[facts, storyCount, t`preferences`].filter(Boolean).join(" · ")}
					caret
				/>
			</List>
		</>
	);
}

type RailItemProps = {
	thread: ThreadSummary;
	current: boolean;
	date: string;
	renaming: boolean;
	onRenameStart: () => void;
	/** The new title, or null when renaming was cancelled. */
	onRenameEnd: (title: string | null) => void;
	onDelete: () => void;
	onNavigate: () => void;
};

/** A conversation: open it; the hover ⋯ or a right-click renames (in place) or deletes it (with Undo). */
function RailItem({
	thread,
	current,
	date,
	renaming,
	onRenameStart,
	onRenameEnd,
	onDelete,
	onNavigate,
}: RailItemProps) {
	const cancelled = useRef(false);
	const title = titleFor(thread);

	return (
		<ContextMenu>
			<ContextMenuTrigger render={<li className="group/row relative" />}>
				{renaming ? (
					<input
						// oxlint-disable-next-line jsx-a11y/no-autofocus -- Rename was just chosen; typing goes straight into the name
						autoFocus
						defaultValue={title}
						aria-label={t`Conversation name`}
						maxLength={200}
						onFocus={(event) => event.currentTarget.select()}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								event.currentTarget.blur();
							}
							if (event.key === "Escape") {
								event.preventDefault();
								cancelled.current = true;
								event.currentTarget.blur();
							}
						}}
						onBlur={(event) => {
							onRenameEnd(cancelled.current ? null : event.currentTarget.value);
							cancelled.current = false;
						}}
						className="h-[54px] w-full rounded-lg border border-accent bg-raised px-2.5 text-base font-medium outline-none md:text-[13px]"
					/>
				) : (
					<Link
						to="/dashboard/career/coach/{-$conversationId}"
						params={{ conversationId: thread.id }}
						aria-current={current ? "page" : undefined}
						onClick={onNavigate}
						className={cn(
							"grid gap-px rounded-lg py-2.5 ps-3 pe-9 transition-colors duration-quick",
							current ? "bg-sunken" : "hover:bg-hover",
						)}
					>
						<span className={cn("line-clamp-2 text-sm/5", current ? "font-semibold" : "font-medium")}>{title}</span>
						<span className="text-[13px]/[18px] text-ink-3">{date}</span>
					</Link>
				)}
				{!renaming && (
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<button
									type="button"
									aria-label={t`More for ${title}`}
									className="absolute inset-e-1 top-1.5 grid size-7 place-items-center rounded-sm text-ink-3 opacity-0 transition-[opacity,background-color,color] duration-quick group-hover/row:opacity-100 hover:bg-hover hover:text-ink focus-visible:opacity-100 aria-expanded:opacity-100 pointer-coarse:opacity-100"
								/>
							}
						>
							<Icon name="dots-three" size={18} />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" finalFocus={false}>
							<DropdownMenuItem onClick={onRenameStart}>
								<Icon name="pencil-simple" size={18} />
								<Trans>Rename</Trans>
							</DropdownMenuItem>
							<DropdownMenuItem variant="destructive" onClick={onDelete}>
								<Icon name="trash" size={18} />
								<Trans>Delete</Trans>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				)}
			</ContextMenuTrigger>
			<ContextMenuContent finalFocus={false}>
				<ContextMenuItem onClick={onRenameStart}>
					<Icon name="pencil-simple" size={18} />
					<Trans>Rename</Trans>
				</ContextMenuItem>
				<ContextMenuItem variant="destructive" onClick={onDelete}>
					<Icon name="trash" size={18} />
					<Trans>Delete</Trans>
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
