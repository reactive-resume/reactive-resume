import type { SavedData, SavedItem } from "./hooks";
import type { CoachStarter } from "@reactive-resume/schema/career-starters";
import type { ReactElement } from "react";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { coachStarters } from "@reactive-resume/schema/career-starters";
import { Button } from "@reactive-resume/ui/components/button";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { formatList } from "@reactive-resume/utils/locale";
import {
	Composer,
	connectionName,
	handOffPrompt,
	titleFor,
	useCoachKnowledge,
	useConversationDate,
	usedFor,
} from "./coach-thread";
import { useProfile } from "./knowledge/preferences";
import { CareerLoadError } from "./load-state";
import { useApplicationsNeedingAttention } from "./needs-you";
import { ScheduleRows, ScheduleSheetFor, useSchedules } from "./schedules";
import { ContextChip, useCareerTime, useNow } from "./shared";
import { List, ListRow } from "@/components/calm/list-row";
import { Columns, Page, PageBody, RootHeader } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { PhoneHeaderActions } from "@/components/layout/phone-header-actions";
import { SetUpAi } from "@/features/ai/set-up-ai";
import { collectInterviews, upcomingInterviews } from "@/features/applications/interviews";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { ModelMenu } from "@/features/assistant/chat-chrome";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type Offer = SavedItem & { data: SavedData<"offer"> };
type ScheduleUrl = { schedule: string | undefined; onScheduleChange: (schedule: string | undefined) => void };

/** C1: Career is one page. The coach leads as an invitation; Knowledge, Offers and Schedules are rows to their pages. */
export function CareerPage({ schedule, onScheduleChange }: ScheduleUrl) {
	const schedules = useSchedules();
	const profile = useQuery(orpc.career.profile.queryOptions());
	const facts = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: null, all: true } }));
	const stories = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: null } }));
	const empty =
		profile.isSuccess &&
		facts.isSuccess &&
		stories.isSuccess &&
		facts.data.every((fact) => fact.status === "forgotten") &&
		stories.data.length === 0 &&
		profile.data.targetRoles.length === 0 &&
		profile.data.locations.length === 0 &&
		!profile.data.priorities &&
		profile.data.minBase.amount === null &&
		profile.data.maxOfficeDays === null;

	const providers = useHasUsableAiProvider();
	const noAi = !providers.isLoading && !providers.isUnavailable && !providers.hasUsableProvider;

	return (
		<Page>
			<PageBody>
				<RootHeader title={<Trans>Career</Trans>} actions={<PhoneHeaderActions />} />
				{/* Stays mounted once connected, so its dialog can say AI is ready. */}
				<SetUpAi
					className="mt-3"
					needs={<Trans>The coach needs AI.</Trans>}
					works={<Trans>Today, Knowledge, offers and schedules work without it.</Trans>}
				/>
				{empty ? (
					<EmptyState
						className="mt-5"
						title={<Trans>Say what you are looking for</Trans>}
						description={
							<Trans>
								Add your preferences and a few facts about your work. The coach, Fit and interview prep use them, and
								new roles are matched against them.
							</Trans>
						}
						action={
							<Button nativeButton={false} render={<Link to="/dashboard/career/knowledge/preferences" />}>
								<Trans>Set your preferences</Trans>
							</Button>
						}
						secondary={
							<>
								<Button
									variant="secondary"
									nativeButton={false}
									render={<Link to="/dashboard/career/knowledge/facts" />}
								>
									<Trans>Add facts</Trans>
								</Button>
								<Button
									variant="ghost"
									nativeButton={false}
									render={
										<Link to="/dashboard/career/coach/{-$conversationId}" params={{ conversationId: undefined }} />
									}
								>
									<Trans>Ask the coach</Trans>
								</Button>
							</>
						}
					/>
				) : (
					<Columns
						className="mt-5"
						aside={<CareerAside schedules={schedules} onScheduleChange={onScheduleChange} noAi={noAi} />}
					>
						{noAi ? <StartersWithoutAi /> : <CoachInvitation />}
						<RecentConversations noAi={noAi} />
					</Columns>
				)}
			</PageBody>
			<ScheduleSheetFor schedule={schedule} onScheduleChange={onScheduleChange} onDelete={schedules.remove} />
		</Page>
	);
}

// ---- The coach, as an invitation ----

type Chips = { application: boolean; memory: boolean };

/** A question, what the coach can see, a composer, then starters that say what they use. Sending opens the conversation (C4). */
function CoachInvitation() {
	const navigate = useNavigate();
	const providers = useHasUsableAiProvider();
	const knowledge = useCoachKnowledge(null);
	const starters = useStarters();
	const [chips, setChips] = useState<Chips>({ application: true, memory: true });
	const [providerId, setProviderId] = useState<string | null>(null);
	const [menuOpen, setMenuOpen] = useState(false);
	const [sending, setSending] = useState(false);
	const usable = providers.usableProviders;
	const provider = usable.find((item) => item.id === providerId) ?? usable[0];
	const blocked = !provider || (chips.memory && (knowledge.isPending || knowledge.isError));
	const context = { document: true, posting: true, application: chips.application, memory: chips.memory, web: false };

	/** Starts the conversation here, leaves the message for its page and opens it; false keeps the text in the box. */
	const send = async (text: string, attachments: Parameters<typeof handOffPrompt>[1]["attachments"] = []) => {
		if (sending || blocked || !provider) return false;
		setSending(true);
		try {
			const thread = await client.agent.threads.start({ scope: "career", aiProviderId: provider.id });
			try {
				localStorage.setItem(`career-context:${thread.id}`, JSON.stringify({ ...chips, web: false, offers: true }));
			} catch {
				// A convenience: the conversation page falls back to its defaults.
			}
			handOffPrompt(thread.id, { text, attachments, used: usedFor(knowledge, context) });
			void navigate({ to: "/dashboard/career/coach/{-$conversationId}", params: { conversationId: thread.id } });
			return true;
		} catch (error) {
			toastError(error, t`Couldn't start the conversation. Try again.`);
			return false;
		} finally {
			setSending(false);
		}
	};

	const facts = knowledge.kept;

	return (
		<section aria-labelledby="career-coach-title">
			<h2 id="career-coach-title" className="pt-2 t-section-title">
				<Trans>What's on your mind about your search?</Trans>
			</h2>
			<p className="pt-1.5 text-sm text-ink-2">
				{chips.memory
					? plural(facts, {
							one: "The coach can see your applications, documents and # Knowledge fact.",
							other: "The coach can see your applications, documents and # Knowledge facts.",
						})
					: t`The coach can see your applications and documents. Knowledge is off for this message.`}
			</p>
			{chips.memory && knowledge.isError && <CareerLoadError onRetry={knowledge.retry} />}
			<div className="mt-5 [&>div]:p-0!">
				<Composer
					variant="sheet"
					attach={false}
					accentSend
					tall
					draftKey="career-home"
					placeholder={t`Ask about your next career step…`}
					streaming={sending}
					disabled={blocked}
					ensureThread={() => Promise.reject(new Error(t`Send a message first, then attach files.`))}
					onSend={send}
					onStop={() => undefined}
					privacy={() => null}
					chips={
						<>
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
								label={t`Knowledge`}
								tooltip={t`Facts, stories and preferences that are switched on in Knowledge`}
							/>
						</>
					}
					actions={
						usable.length > 0 && (
							<ModelMenu
								variant="ghost"
								open={menuOpen}
								onOpenChange={setMenuOpen}
								onConnect={() => void navigate({ to: "/dashboard/settings/ai" })}
								providers={usable}
								current={provider}
								label={connectionName(provider?.label ?? t`Your AI`)}
								onChoose={setProviderId}
							/>
						)
					}
				/>
			</div>
			<List className="mt-2" aria-label={t`Questions to start from`}>
				{starters.map((starter) => (
					<ListRow
						key={starter.title}
						render={<button type="button" disabled={blocked || sending} onClick={() => void send(starter.title)} />}
						title={starter.title}
						subtitle={starter.note}
						trailing={<Icon name="arrow-right" size={20} className="text-ink-3" />}
					/>
				))}
			</List>
		</section>
	);
}

type Starter = {
	title: string;
	/** What the coach uses to answer it. */
	note: string;
	/** Without AI: the page that already answers it, and what it holds. */
	page: { note: string; link: ReactElement };
};

type StarterKind = CoachStarter | { kind: "week" };

/**
 * The account's three starters, worded as questions with what each one uses. Web asks "What should I do this week?"
 * whenever an application is open (follow-ups and deadlines), ahead of the new-roles question.
 */
function useStarters(): Starter[] {
	const applications = useQuery(applicationsListQueryOptions());
	const opportunities = useQuery(orpc.career.opportunities.queryOptions({ input: {} }));
	const now = useNow();
	const { attention } = useApplicationsNeedingAttention(now);
	const { format } = useCareerTime();
	const open = (applications.data ?? []).filter((application) => application.status !== "closed");
	const next = upcomingInterviews(collectInterviews(open))[0];
	const offered = open.filter((application) => application.status === "offer");
	const today = <Link to="/dashboard" />;
	const word = (starter: StarterKind): Starter => {
		switch (starter.kind) {
			case "interview": {
				const day = next ? format(next.start, { weekday: "long" }) : "";
				return {
					title: t`Prepare for ${day}'s interview at ${starter.company}`,
					note: t`Uses your briefing and stories`,
					page: {
						note: t`Interview prep · a checklist, the people, your stories`,
						link: next ? (
							<Link
								to="/dashboard/applications/$applicationId/{-$tab}"
								params={{ applicationId: next.application.id, tab: "prepare" }}
							/>
						) : (
							today
						),
					},
				};
			}
			case "offers": {
				const company = offered.length === 1 ? offered[0]?.company : undefined;
				return {
					title: company ? t`Should I take the ${company} offer?` : t`Which of my offers fits what I want?`,
					note: t`Compares it with your requirements, never decides for you`,
					page: {
						note: t`Offers · its terms against your requirements, and what is still open`,
						link: <Link to="/dashboard/career/offers" />,
					},
				};
			}
			case "week": {
				const companies = formatList(
					i18n.locale,
					attention.map((item) => item.application.company),
				);
				return {
					title: t`What should I do this week?`,
					note: t`Ranks follow-ups and deadlines`,
					page: {
						note:
							attention.length > 0
								? plural(attention.length, {
										one: `Today · # needs you: ${companies}`,
										other: `Today · # need you: ${companies}`,
									})
								: t`Today · your follow-ups and deadlines`,
						link: today,
					},
				};
			}
			case "opportunities":
				return {
					title: t`Which new roles match my priorities?`,
					note: t`Uses your preferences and the roles found`,
					page: { note: t`Today · the new roles found for you`, link: today },
				};
			case "story":
				return {
					title: t`Help me turn an accomplishment into a story`,
					note: t`Situation, task, action, result and reflection`,
					page: {
						note: t`Stories · write one part by part`,
						link: <Link to="/dashboard/career/knowledge/stories/{-$storyId}" params={{ storyId: undefined }} />,
					},
				};
			case "practice":
				return {
					title: t`What interview answers should I practise?`,
					note: t`Uses your stories and applications`,
					page: {
						note: t`Stories · ready to tell in interviews`,
						link: <Link to="/dashboard/career/knowledge/stories/{-$storyId}" params={{ storyId: undefined }} />,
					},
				};
			default:
				return {
					title: t`What kinds of roles fit what I've done so far?`,
					note: t`Uses your facts and preferences`,
					page: {
						note: t`Preferences · what you are looking for`,
						link: <Link to="/dashboard/career/knowledge/preferences" />,
					},
				};
		}
	};
	const base = coachStarters({
		nextInterviewCompany: next?.application.company,
		offers: offered.length,
		opportunities: 0,
	});
	const lead = base.filter((starter) => starter.kind === "interview" || starter.kind === "offers");
	const rest = base.filter((starter) => starter.kind !== "interview" && starter.kind !== "offers");
	const roles = (opportunities.data ?? []).some((row) => !row.trackedApplicationId);
	const kinds: StarterKind[] = [
		...lead,
		...(open.length > 0 ? [{ kind: "week" } as const] : []),
		...(roles ? [{ kind: "opportunities" } as const] : []),
		...rest,
	];
	return kinds.slice(0, 3).map(word);
}

/** N10: no AI, so no composer. The same three questions, each pointing to the page that answers it without AI. */
function StartersWithoutAi() {
	const starters = useStarters();
	return (
		<section aria-labelledby="career-starters-title">
			<h2 id="career-starters-title" className="pt-2 t-section-title">
				<Trans>What you might have asked</Trans>
			</h2>
			<p className="pt-1.5 text-sm text-ink-2">
				<Trans>The coach's three starting questions, each answered by a page that needs no AI.</Trans>
			</p>
			<List className="mt-2" aria-label={t`Questions to start from`}>
				{starters.map((starter) => (
					<ListRow
						key={starter.title}
						render={starter.page.link}
						title={starter.title}
						subtitle={starter.page.note}
						trailing={<Icon name="arrow-right" size={20} className="text-ink-3" />}
					/>
				))}
			</List>
		</section>
	);
}

function RecentConversations({ noAi }: { noAi: boolean }) {
	const threads = useQuery(orpc.agent.threads.list.queryOptions());
	const applications = useQuery(applicationsListQueryOptions());
	const when = useConversationDate();
	const recent = (threads.data ?? []).filter((thread) => thread.scope === "career").slice(0, 2);
	if (!threads.isSuccess) return null;
	if (recent.length === 0)
		return noAi ? (
			<section>
				<SectionHeading>
					<Trans>Conversations</Trans>
				</SectionHeading>
				<p className="text-[13px]/[18px] text-ink-3">
					<Trans>
						None yet. A conversation with the coach is kept here, and stays readable if its connection is later removed.
					</Trans>
				</p>
			</section>
		) : null;
	const company = (id: string | null) =>
		id ? applications.data?.find((application) => application.id === id)?.company : undefined;
	return (
		<section>
			<SectionHeading
				action={
					<Link to="/dashboard/career/coach/{-$conversationId}" params={{ conversationId: recent[0]?.id }}>
						<Trans>See all</Trans>
					</Link>
				}
			>
				<Trans>Recent conversations</Trans>
			</SectionHeading>
			<List>
				{recent.map((thread) => {
					const about = company(thread.applicationId);
					const date = when(new Date(thread.lastMessageAt));
					return (
						<ListRow
							key={thread.id}
							render={<Link to="/dashboard/career/coach/{-$conversationId}" params={{ conversationId: thread.id }} />}
							title={titleFor(thread)}
							subtitle={about ? t`${date} · about ${about}` : date}
							caret
						/>
					);
				})}
			</List>
		</section>
	);
}

// ---- The aside: rows to Knowledge, Offers and Schedules ----

function CareerAside({
	schedules,
	onScheduleChange,
	noAi,
}: {
	schedules: ReturnType<typeof useSchedules>;
	onScheduleChange: (schedule: string | undefined) => void;
	noAi: boolean;
}) {
	const facts = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: null, all: true } }));
	const stories = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: null } }));
	const { profile } = useProfile();
	const factCount = facts.data?.filter((fact) => fact.status !== "forgotten").length;
	const count = (value: number | undefined) =>
		value === undefined ? undefined : <span className="t-mono text-ink-3">{i18n.number(value)}</span>;

	const money =
		profile?.minBase.amount == null
			? null
			: new Intl.NumberFormat(i18n.locale, {
					style: "currency",
					currency: profile.minBase.currency || "USD",
					maximumFractionDigits: 0,
				}).format(profile.minBase.amount);
	const days = profile?.maxOfficeDays ?? null;
	const preferences =
		[
			money && t`${money} minimum`,
			days === null
				? null
				: days === 0
					? t`remote only`
					: plural(days, { one: "at most # office day a week", other: "at most # office days a week" }),
		]
			.filter(Boolean)
			.join(" · ") || t`Roles, places, pay and ways of working`;

	return (
		<>
			<SectionHeading first>
				<Trans>Knowledge</Trans>
			</SectionHeading>
			<List>
				<ListRow
					render={<Link to="/dashboard/career/knowledge/facts" />}
					title={<Trans>Facts</Trans>}
					subtitle={<Trans>What you've done, in your words</Trans>}
					value={count(factCount)}
					caret
				/>
				<ListRow
					render={<Link to="/dashboard/career/knowledge/stories/{-$storyId}" params={{ storyId: undefined }} />}
					title={<Trans>Stories</Trans>}
					subtitle={<Trans>Ready to tell in interviews</Trans>}
					value={count(stories.data?.length)}
					caret
				/>
				<ListRow
					render={<Link to="/dashboard/career/knowledge/preferences" />}
					title={<Trans>Job search preferences</Trans>}
					subtitle={preferences}
					caret
				/>
			</List>

			<OffersRows />

			<SectionHeading
				action={
					<Link to="/dashboard/career/schedules">
						<Trans>See all</Trans>
					</Link>
				}
			>
				<Trans>Schedules</Trans>
			</SectionHeading>
			<ScheduleRows schedules={schedules} onOpen={onScheduleChange} hide={noAi ? ["prepare"] : undefined} />
			{noAi ? (
				<p className="pt-2.5 text-[13px]/[18px] text-ink-3">
					<Trans>Reminders need no AI. A briefing refresh does.</Trans>
				</p>
			) : (
				<p className="pt-2.5 text-[13px]/[18px] text-ink-3">
					<Trans>
						What they produce waits in{" "}
						<Link to="/dashboard" className="inline-block font-medium text-accent-text">
							Today
						</Link>
						.
					</Trans>
				</p>
			)}
		</>
	);
}

/** One row per job with an offer (its latest version), soonest answer first; none: a row to add one. */
function OffersRows() {
	const query = useQuery(orpc.career.savedItems.queryOptions({ input: { kind: "offer" } }));
	const { format } = useCareerTime();
	const latest = new Map<string, Offer>();
	for (const item of query.data ?? []) {
		if (item.data.kind !== "offer") continue;
		const key = item.applicationId ?? item.id;
		const kept = latest.get(key);
		if (!kept || new Date(item.createdAt) > new Date(kept.createdAt)) latest.set(key, item as Offer);
	}
	const offers = [...latest.values()]
		.filter((offer) => offer.application?.status !== "closed")
		.toSorted((a, b) => String(a.data.respondBy ?? "~").localeCompare(String(b.data.respondBy ?? "~")));

	return (
		<>
			<SectionHeading>
				<Trans>Offers</Trans>
			</SectionHeading>
			{query.isError && !query.data ? (
				<CareerLoadError onRetry={() => void query.refetch()} />
			) : (
				<List>
					{offers.length === 0 ? (
						<ListRow
							render={<Link to="/dashboard/career/offers" />}
							title={<Trans>Add an offer</Trans>}
							subtitle={<Trans>Check its terms against what you want</Trans>}
							caret
						/>
					) : (
						offers.map((offer) => {
							const reply = offer.data.respondBy
								? t`reply by ${format(offer.data.respondBy, { weekday: "short", day: "numeric", month: "short" })}`
								: null;
							return (
								<ListRow
									key={offer.id}
									render={<Link to="/dashboard/career/offers" search={{ a: offer.id }} />}
									leading={<span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-stage-offer" />}
									title={offer.application?.company ?? t`Deleted application`}
									subtitle={[offer.application?.role, reply].filter(Boolean).join(" · ")}
									caret
								/>
							);
						})
					)}
				</List>
			)}
		</>
	);
}
