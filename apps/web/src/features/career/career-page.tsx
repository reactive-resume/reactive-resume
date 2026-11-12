import type { SavedData, SavedItem } from "./hooks";
import type { CoachStarter } from "@reactive-resume/schema/career-starters";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { coachStarters } from "@reactive-resume/schema/career-starters";
import { Icon } from "@reactive-resume/ui/components/icon";
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
import { ScheduleRows, ScheduleSheetFor, useSchedules } from "./schedules";
import { ContextChip, useCareerTime } from "./shared";
import { List, ListRow } from "@/components/calm/list-row";
import { Columns, Page, PageBody, RootHeader } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { SetUpAiLine } from "@/components/calm/set-up-ai-line";
import { PhoneHeaderActions } from "@/components/layout/phone-header-actions";
import { SetUpAiDialog } from "@/features/ai/set-up-ai";
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
	const providers = useHasUsableAiProvider();
	const noAi = !providers.isLoading && !providers.isUnavailable && !providers.hasUsableProvider;
	const [setupOpen, setSetupOpen] = useState(false);

	return (
		<Page>
			<PageBody>
				<RootHeader title={<Trans>Career</Trans>} actions={<PhoneHeaderActions />} />
				{noAi && (
					<SetUpAiLine className="mt-5" lead={<Trans>The coach needs AI.</Trans>} onSetUp={() => setSetupOpen(true)}>
						<Trans>Knowledge, Offers and Schedules work without it.</Trans>
					</SetUpAiLine>
				)}
				<Columns className="mt-5" aside={<CareerAside schedules={schedules} onScheduleChange={onScheduleChange} />}>
					{!noAi && <CoachInvitation />}
					<RecentConversations first={noAi} />
				</Columns>
			</PageBody>
			<ScheduleSheetFor schedule={schedule} onScheduleChange={onScheduleChange} onDelete={schedules.remove} />
			<SetUpAiDialog open={setupOpen} onOpenChange={setSetupOpen} />
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

	const facts = knowledge.active.length;

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

type Starter = { title: string; note: string };

/** The account's three starters (`coachStarters`), worded as questions with what each one uses. */
function useStarters(): Starter[] {
	const applications = useQuery(applicationsListQueryOptions());
	const opportunities = useQuery(orpc.career.opportunities.queryOptions({ input: {} }));
	const { format } = useCareerTime();
	const open = (applications.data ?? []).filter((application) => application.status !== "closed");
	const next = upcomingInterviews(collectInterviews(open))[0];
	const offered = open.filter((application) => application.status === "offer");
	const word = (starter: CoachStarter): Starter => {
		switch (starter.kind) {
			case "interview": {
				const day = next ? format(next.start, { weekday: "long" }) : "";
				return {
					title: t`Prepare for ${day}'s interview at ${starter.company}`,
					note: t`Uses your briefing and stories`,
				};
			}
			case "offers": {
				const company = offered.length === 1 ? offered[0]?.company : undefined;
				return {
					title: company ? t`Should I take the ${company} offer?` : t`Which of my offers fits what I want?`,
					note: t`Compares it with your requirements, never decides for you`,
				};
			}
			case "opportunities":
				return { title: t`Which new roles match my priorities?`, note: t`Uses your preferences and the roles found` };
			case "story":
				return {
					title: t`Help me turn an accomplishment into a story`,
					note: t`Situation, task, action, result and reflection`,
				};
			case "practice":
				return { title: t`What interview answers should I practise?`, note: t`Uses your stories and applications` };
			default:
				return { title: t`What kinds of roles fit what I've done so far?`, note: t`Uses your facts and preferences` };
		}
	};
	return coachStarters({
		nextInterviewCompany: next?.application.company,
		offers: offered.length,
		opportunities: (opportunities.data ?? []).filter((row) => !row.trackedApplicationId).length,
	}).map(word);
}

function RecentConversations({ first }: { first: boolean }) {
	const threads = useQuery(orpc.agent.threads.list.queryOptions());
	const when = useConversationDate();
	const recent = (threads.data ?? []).filter((thread) => thread.scope === "career").slice(0, 2);
	if (recent.length === 0) return null;
	return (
		<section>
			<SectionHeading
				first={first}
				action={
					<Link to="/dashboard/career/coach/{-$conversationId}" params={{ conversationId: recent[0]?.id }}>
						<Trans>See all</Trans>
					</Link>
				}
			>
				<Trans>Recent conversations</Trans>
			</SectionHeading>
			<List>
				{recent.map((thread) => (
					<ListRow
						key={thread.id}
						render={<Link to="/dashboard/career/coach/{-$conversationId}" params={{ conversationId: thread.id }} />}
						title={titleFor(thread)}
						subtitle={when(new Date(thread.lastMessageAt))}
						caret
					/>
				))}
			</List>
		</section>
	);
}

// ---- The aside: rows to Knowledge, Offers and Schedules ----

function CareerAside({
	schedules,
	onScheduleChange,
}: {
	schedules: ReturnType<typeof useSchedules>;
	onScheduleChange: (schedule: string | undefined) => void;
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
			<ScheduleRows schedules={schedules} onOpen={onScheduleChange} />
			<p className="pt-2.5 text-[13px]/[18px] text-ink-3">
				<Trans>
					What they produce waits in{" "}
					<Link to="/dashboard" className="inline-block font-medium text-accent-text">
						Today
					</Link>
					.
				</Trans>
			</p>
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
