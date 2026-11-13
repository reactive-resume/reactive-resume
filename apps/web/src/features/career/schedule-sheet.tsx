import type { RouterOutput } from "@/libs/orpc/client";
import type { careerScheduleInputSchema } from "@reactive-resume/schema/career";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import type z from "zod";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useId, useState } from "react";
import { aiModelForTask } from "@reactive-resume/ai/task-models";
import { defaultFollowUpNote } from "@reactive-resume/schema/applications/follow-up";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Sheet, SheetClose, SheetContent, SheetFooter, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Switch } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { fromZonedDateTime } from "@reactive-resume/utils/timezone";
import { CareerLoadError } from "./load-state";
import { Swap, useCareerTime, useNow } from "./shared";
import { List, ListRow } from "@/components/calm/list-row";
import { collectInterviews, interviewKindOf } from "@/features/applications/interviews";
import { applicationDetailQueryOptions, applicationsListQueryOptions } from "@/features/applications/queries";
import { SetUpAi } from "@/features/assistant/provider-setup";
import { SetUpWebAccess } from "@/features/settings/ai/web-access";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { useClosingValue } from "@/hooks/use-closing-value";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

type ScheduleInput = z.input<typeof careerScheduleInputSchema>;
export type Kind = ScheduleInput["kind"];
export type Lead = NonNullable<ScheduleInput["lead"]>;
export type Schedule = RouterOutput["career"]["schedules"][number];

const KINDS: readonly Kind[] = ["discovery", "prepare", "follow-up"];

/** The icon and name a schedule goes by in Today and in toasts. */
export function scheduleKind(kind: string): { icon: IconName; title: string } {
	if (kind === "prepare") return { icon: "graduation-cap", title: t`Interview preparation` };
	if (kind === "follow-up") return { icon: "bell", title: t`Follow-up reminder` };
	return { icon: "globe-simple", title: t`Role discovery` };
}

// ---- Wall-clock time in the Preferences timezone ----

/** "2026-10-08" and "17:58": the wall clock in `timeZone` at `at`. */
function toZoned(at: Date, timeZone: string) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-CA", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		})
			.formatToParts(at)
			.map(({ type, value }) => [type, value]),
	);
	return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Invalid or skipped local times remain invalid, so the form can explain them before saving. */
function fromZoned(date: string, time: string, timeZone: string) {
	return fromZonedDateTime(date, time.slice(0, 5), timeZone) ?? new Date(Number.NaN);
}

const addDays = (date: string, days: number) =>
	new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A repeating schedule's first run after `now`, keeping its wall-clock time in `timeZone`. */
export function rollForward(at: Date, intervalDays: number, timeZone: string, now = new Date()) {
	if (at > now) return at;
	const { date, time } = toZoned(at, timeZone);
	const steps = Math.max(1, Math.ceil((now.getTime() - at.getTime()) / (intervalDays * 86_400_000)));
	const next = fromZoned(addDays(date, steps * intervalDays), time, timeZone);
	if (!Number.isFinite(next.getTime())) return at;
	const candidate = next > now ? next : fromZoned(addDays(date, (steps + 1) * intervalDays), time, timeZone);
	return Number.isFinite(candidate.getTime()) ? candidate : at;
}

/** When a briefing runs; mirrors the server, which recomputes it from the interview on save. */
/** A new briefing's lead: 24 hours before, or 2 hours when that has passed (then it runs now either way). */
const firstLeadAhead = (start: Date | undefined, timeZone: string, now: Date): Lead =>
	start && prepareRunAt(start, "24h", timeZone) <= now && prepareRunAt(start, "2h", timeZone) > now ? "2h" : "24h";

const prepareRunAt = (start: Date, lead: Lead, timeZone: string) =>
	lead === "morning"
		? fromZoned(toZoned(start, timeZone).date, "08:00", timeZone)
		: new Date(start.getTime() - (lead === "24h" ? 24 : 2) * 3_600_000);

// ---- The sheet ----

type Draft = {
	kind: Kind;
	query: string;
	followUpNote: string | null;
	every: string;
	date: string;
	time: string;
	interviewId: string;
	lead: Lead;
	aiProviderId: string;
	applicationId: string;
	enabled: boolean;
	email: boolean;
};

type Form = {
	target: string;
	existing: Schedule | null;
	initial: Draft;
	draft: Draft;
	touched: { query?: boolean; when?: boolean };
	submitted: boolean;
	discarding: boolean;
};

type ScheduleSheetProps = {
	schedule: string | undefined;
	onScheduleChange: (schedule: string | undefined) => void;
	/** Hides the schedule and offers Undo; the page owns it so its list hides the row too. */
	onDelete: (id: string) => void;
};

/**
 * One schedule, from the right (a bottom sheet on phones). `schedule` is an id, or "new" optionally followed by
 * ":kind" and ":applicationId" ("new:follow-up:abc") to preselect what runs.
 */
export function ScheduleSheet({ schedule, onScheduleChange, onDelete }: ScheduleSheetProps) {
	const phone = useBreakpoint() === "mobile";
	const now = useNow();
	const [shown, onClosingComplete] = useClosingValue(schedule ?? null);
	const { when, format, plainTime, timeZone: accountTimeZone, locale } = useCareerTime();
	const context = useRouteContext({ strict: false });
	const user = context.session?.user;
	const { data: schedules } = useQuery(orpc.career.schedules.queryOptions({ input: {} }));
	const timeZone = schedules?.find((row) => row.id === shown)?.timezone ?? accountTimeZone;
	const { data: profile } = useQuery(orpc.career.profile.queryOptions());
	const { data: applications } = useQuery(applicationsListQueryOptions());
	const { data: webAccess } = useQuery(orpc.webAccess.status.queryOptions());
	// Only counted, for the line that says what a briefing sends.
	const knowledge = useQuery(orpc.career.facts.queryOptions({ input: { applicationId: null, all: true } }));
	const stories = useQuery(orpc.career.stories.queryOptions({ input: { applicationId: null } }));
	const providerState = useHasUsableAiProvider();
	const { usableProviders: providers, isLoading: providersLoading } = providerState;
	const close = () => onScheduleChange(undefined);
	// Every mutation refetches all queries (MutationCache), so Today's list follows a save.
	const save = useMutation(orpc.career.saveSchedule.mutationOptions());

	const open = (applications ?? []).filter((application) => application.status !== "closed");
	const interviews = collectInterviews(open);
	const upcoming = interviews.filter((item) => item.end >= now);

	// The form starts once its data is in, and again for each schedule opened; closing drops it.
	const [form, setForm] = useState<Form | null>(null);
	// A lead the person picked stays; until then it follows the chosen interview.
	const [leadChosen, setLeadChosen] = useState(false);
	if (shown && form?.target !== shown && schedules && profile && applications && !providersLoading) {
		const [head, kind, applicationId] = shown.split(":");
		const existing = head === "new" ? null : (schedules.find((row) => row.id === shown) ?? null);
		const at = existing
			? existing.intervalDays
				? rollForward(new Date(existing.nextRunAt), existing.intervalDays, timeZone, now)
				: new Date(existing.nextRunAt)
			: fromZoned(toZoned(new Date(now.getTime() + 86_400_000), timeZone).date, "08:00", timeZone);
		const initial: Draft = {
			kind: existing ? (existing.kind as Kind) : (KINDS.find((item) => item === kind) ?? "discovery"),
			query:
				existing?.kind === "discovery" ? existing.query : [...profile.targetRoles, ...profile.locations].join(" · "),
			followUpNote: existing?.kind === "follow-up" ? existing.query : null,
			every: String(existing?.intervalDays ?? 1),
			...toZoned(at, timeZone),
			interviewId: existing?.interviewId ?? upcoming[0]?.interview.id ?? "",
			lead: (existing?.lead as Lead | null) ?? firstLeadAhead(upcoming[0]?.start, timeZone, now),
			aiProviderId: providers.find((provider) => provider.id === existing?.aiProviderId)?.id ?? providers[0]?.id ?? "",
			applicationId: existing?.applicationId ?? applicationId ?? open[0]?.id ?? "",
			enabled: existing?.enabled ?? true,
			email: existing?.email ?? false,
		};
		setForm({ target: shown, existing, initial, draft: initial, touched: {}, submitted: false, discarding: false });
		setLeadChosen(false);
	}

	const draft = form?.draft;
	const prefill = Boolean(shown && draft?.kind === "follow-up" && draft.followUpNote === null && draft.applicationId);
	const detail = useQuery({ ...applicationDetailQueryOptions(draft?.applicationId ?? ""), enabled: prefill });
	const selectedDetail = detail.data?.id === draft?.applicationId ? detail.data : undefined;
	const prefillBlocked = prefill && (detail.isPending || detail.isFetching || !selectedDetail);
	const followUpNote = draft?.followUpNote ?? (selectedDetail ? defaultFollowUpNote(selectedDetail) : "");
	const set = (patch: Partial<Draft>) =>
		setForm((current) => current && { ...current, draft: { ...current.draft, ...patch } });
	const touch = (field: keyof Form["touched"]) =>
		setForm((current) => current && { ...current, touched: { ...current.touched, [field]: true } });
	const dirty = form ? JSON.stringify(form.draft) !== JSON.stringify(form.initial) : false;
	const requestClose = () => (dirty ? setForm((current) => current && { ...current, discarding: true }) : close());

	const interview = interviews.find((item) => item.interview.id === draft?.interviewId);
	const choices = interviews.filter((item) => item.end >= now || item === interview);
	const runAt =
		draft?.kind === "prepare" ? (interview ? prepareRunAt(interview.start, draft.lead, timeZone) : null) : null;
	const unchangedFollowUp =
		form?.existing?.kind === "follow-up" &&
		draft?.kind === "follow-up" &&
		draft.date === form.initial.date &&
		draft.time === form.initial.time;
	const enteredAt =
		unchangedFollowUp && form?.existing
			? new Date(form.existing.nextRunAt)
			: draft
				? fromZoned(draft.date, draft.time, timeZone)
				: null;
	const errors = {
		query: draft?.kind === "discovery" && draft.query.trim().length < 3 ? t`Add a role or company to look for.` : null,
		when:
			draft && draft.kind !== "prepare" && !unchangedFollowUp && enteredAt && !(enteredAt > now)
				? Number.isNaN(enteredAt.getTime())
					? t`This time does not exist in your timezone. Choose another time.`
					: t`Pick a time after now.`
				: null,
	};
	const shownError = (field: keyof typeof errors) =>
		(form?.submitted || form?.touched[field]) && errors[field] ? errors[field] : null;
	const smtp = context.flags?.smtpEnabled ?? false;
	const verified = Boolean(user?.emailVerified);
	const runnerAvailable = context.flags?.careerSchedulingEnabled ?? false;
	const blocked =
		(draft?.enabled && !runnerAvailable) ||
		(draft?.kind === "prepare" && (!interview || providers.length === 0)) ||
		(draft?.kind === "follow-up" && open.length === 0);
	const needsWebSearch = draft?.kind === "discovery" && draft.enabled && webAccess?.search === false;

	const onSave = () => {
		if (!form || !draft || !enteredAt) return;
		setForm({ ...form, submitted: true });
		if (errors.query || errors.when || blocked || needsWebSearch || prefillBlocked) return;
		save.mutate(
			{
				...(form.existing ? { id: form.existing.id } : {}),
				kind: draft.kind,
				applicationId:
					draft.kind === "prepare"
						? (interview?.application.id ?? null)
						: draft.kind === "follow-up"
							? draft.applicationId || null
							: null,
				query: draft.kind === "follow-up" ? followUpNote.trim() : draft.kind === "discovery" ? draft.query.trim() : "",
				interviewId: draft.kind === "prepare" ? draft.interviewId || null : null,
				lead: draft.kind === "prepare" ? draft.lead : null,
				enabled: draft.enabled,
				email: smtp && verified && draft.email,
				nextRunAt: runAt ?? enteredAt,
				timezone: timeZone,
				locale,
				intervalDays: draft.kind === "discovery" ? Number(draft.every) : null,
				aiProviderId: draft.kind === "prepare" ? draft.aiProviderId || null : null,
			},
			{
				onSuccess: () => {
					close();
					toast.add({ description: t`Schedule saved` });
				},
				onError: (error) => toastError(error, t`Couldn't save this schedule. Try again.`, { allowServerMessage: true }),
			},
		);
	};

	const dateLabel = draft?.kind === "follow-up" ? t`Remind me on` : t`First run`;
	// "Lisbon": the city of the timezone the times are entered in.
	const city = timeZone.split("/").at(-1)?.replaceAll("_", " ") ?? timeZone;
	// "tavily" → "Tavily": the service's own name is its id with a capital.
	const searchService = webAccess?.provider
		? webAccess.provider.charAt(0).toUpperCase() + webAccess.provider.slice(1)
		: null;
	const providerLabel = providers.find((provider) => provider.id === draft?.aiProviderId)?.label;
	const active = (knowledge.data ?? []).filter((fact) => fact.status === "active" && fact.applicationId === null);

	return (
		<Sheet
			open={Boolean(schedule)}
			onOpenChange={(next) => {
				if (!next) requestClose();
			}}
			onOpenChangeComplete={(next) => {
				onClosingComplete(next);
				if (!next) setForm(null);
			}}
		>
			<SheetContent side={phone ? "bottom" : "right"} showCloseButton={false} className="gap-0">
				<div className="flex shrink-0 items-center gap-2 ps-6 pe-4 pt-5 pb-3 max-sm:pt-2">
					<SheetTitle className="flex-1">
						{form?.existing ? <Trans>Edit schedule</Trans> : <Trans>New schedule</Trans>}
					</SheetTitle>
					<SheetClose aria-label={t`Close`} render={<Button variant="ghost" size="icon" className="text-ink-2" />}>
						<Icon name="x" size={20} />
					</SheetClose>
				</div>

				{!form || !draft ? (
					<div className="grid min-h-40 flex-1 place-items-center">
						<Spinner />
					</div>
				) : (
					<div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-6 pt-1 pb-6">
						<Segments
							label={t`What should run`}
							value={draft.kind}
							onChange={(kind) => set({ kind: kind as Kind })}
							options={[
								{ value: "discovery", label: t`Find roles` },
								{ value: "prepare", label: t`Interview prep` },
								{ value: "follow-up", label: t`Remind me` },
							]}
							hint={
								draft.kind === "prepare"
									? t`Writes a briefing before an interview: likely questions, who you'll meet and stories to tell.`
									: undefined
							}
						/>

						{!runnerAvailable && (
							<p role="status" className="text-sm text-warn-text">
								<Trans>
									Scheduled work is not available on this server. Ask your server administrator to configure it.
								</Trans>
							</p>
						)}
						{draft.kind === "discovery" && !webAccess?.search && (
							<div role="status" className="grid gap-2 rounded-lg bg-warn-soft p-3 text-sm text-ink">
								<p>
									<Trans>
										Finding roles needs a working web search service. Set it up first, or save jobs manually in
										Applications.
									</Trans>
								</p>
								{/* While the schedule is on, the footer's button is the way forward; one is enough. */}
								{!needsWebSearch && (
									<div>
										<SetUpWebAccess />
									</div>
								)}
							</div>
						)}
						<Swap id={draft.kind} className="flex flex-col gap-[18px]">
							{draft.kind === "discovery" && (
								<>
									<Field
										label={t`Look for`}
										hint={t`Roles, places and companies. Starts from your preferences; this schedule keeps its own copy.`}
										error={shownError("query")}
									>
										{(props) => (
											<Input
												{...props}
												value={draft.query}
												onChange={(event) => set({ query: event.target.value })}
												onBlur={() => touch("query")}
												className="pointer-coarse:text-base"
											/>
										)}
									</Field>
									<Segments
										label={t`How often`}
										value={draft.every}
										onChange={(every) => set({ every })}
										options={[
											{ value: "1", label: t`Every day` },
											{ value: "3", label: t`Every 3 days` },
											{ value: "7", label: t`Every week` },
										]}
									/>
								</>
							)}

							{draft.kind === "prepare" && (
								<>
									<Field
										label={t`Interview`}
										hint={choices.length === 0 ? t`Add an interview in an application first` : undefined}
									>
										{(props) => (
											<NativeSelect
												{...props}
												disabled={choices.length === 0}
												value={draft.interviewId}
												onChange={(event) => {
													const chosen = choices.find((item) => item.interview.id === event.target.value);
													set({
														interviewId: event.target.value,
														...(leadChosen || form?.existing?.lead || !chosen
															? {}
															: { lead: firstLeadAhead(chosen.start, timeZone, now) }),
													});
												}}
												className="pointer-coarse:text-base"
											>
												{choices.map((item) => (
													<option key={item.interview.id} value={item.interview.id}>
														{[
															item.application.company,
															item.interview.kind === "screening"
																? t`Screening call`
																: (interviewKindOf(item.interview.kind)?.label ?? item.interview.kind),
															when(item.start),
														].join(" · ")}
													</option>
												))}
											</NativeSelect>
										)}
									</Field>
									<Segments
										label={t`Prepare the briefing`}
										value={draft.lead}
										onChange={(lead) => {
											setLeadChosen(true);
											set({ lead: lead as Lead });
										}}
										options={[
											{ value: "24h", label: t`24 hours before` },
											{ value: "2h", label: t`2 hours before` },
											{ value: "morning", label: t`Morning of` },
										]}
										hint={
											!runAt
												? undefined
												: runAt <= now
													? draft.lead === "morning"
														? t`The morning of the interview has passed, so the briefing runs now.`
														: t`Starts in under ${draft.lead === "24h" ? 24 : 2} hours, so the briefing runs now.`
													: t`Runs once, on ${format(runAt, { weekday: "long", day: "numeric", month: "short" })} at ${plainTime(runAt)} (${timeZone}).`
										}
									/>
									<Field
										label={t`AI connection`}
										hint={
											providers.length > 0 ? t`A schedule never switches to another connection on its own.` : undefined
										}
									>
										{(props) =>
											providerState.isUnavailable ? (
												<AiProviderLoadState state={providerState} />
											) : providers.length === 0 ? (
												<SetUpAi />
											) : (
												<div className="relative">
													<Icon
														name="sparkle"
														size={18}
														className="pointer-events-none absolute inset-s-2.5 top-1/2 z-10 -translate-y-1/2 text-ink-2"
													/>
													<NativeSelect
														{...props}
														value={draft.aiProviderId}
														onChange={(event) => set({ aiProviderId: event.target.value })}
														className="ps-9 pointer-coarse:text-base"
													>
														{providers.map((provider) => (
															<option key={provider.id} value={provider.id}>
																{`${provider.label} · ${aiModelForTask(provider, "capable")}`}
															</option>
														))}
													</NativeSelect>
												</div>
											)
										}
									</Field>
									{form?.existing?.kind === "prepare" &&
										providers.length > 0 &&
										!providers.some((provider) => provider.id === form.existing?.aiProviderId) && (
											<p className="-mt-2 text-xs text-warn-text">
												<Trans>
													Its connection is unavailable. Choose and approve a connection before enabling this schedule.
												</Trans>
											</p>
										)}
									{providerLabel && (
										<div className="flex flex-col gap-2 rounded-lg bg-sunken p-3.5">
											<p className="text-[13px]/[18px] font-semibold">
												<Trans>What it sends to {providerLabel}</Trans>
											</p>
											<SentLine icon="briefcase">
												{interview ? (
													<Trans>
														The {interview.application.company} posting, your notes and the documents linked to it
													</Trans>
												) : (
													<Trans>The application's posting, your notes and the documents linked to it</Trans>
												)}
											</SentLine>
											<SentLine icon="books">
												<Trans>
													Knowledge that's switched on: <Plural value={active.length} one="# fact" other="# facts" />,{" "}
													<Plural value={stories.data?.length ?? 0} one="# story" other="# stories" /> and your
													preferences
												</Trans>
											</SentLine>
											<SentLine icon="coins">
												<Trans>Your provider may charge for the run.</Trans>
											</SentLine>
										</div>
									)}
								</>
							)}

							{draft.kind === "follow-up" && (
								<>
									<Field label={t`Application`} hint={open.length === 0 ? t`Add an application first` : undefined}>
										{(props) => (
											<NativeSelect
												{...props}
												disabled={!!form?.existing || open.length === 0}
												value={draft.applicationId}
												onChange={(event) => set({ applicationId: event.target.value })}
												className="pointer-coarse:text-base"
											>
												{open.map((application) => (
													<option key={application.id} value={application.id}>
														{`${application.company} · ${application.role}`}
													</option>
												))}
											</NativeSelect>
										)}
									</Field>
									<Field label={t`Follow-up note`}>
										{(props) => (
											<Input
												{...props}
												value={followUpNote}
												onChange={(event) => set({ followUpNote: event.target.value })}
											/>
										)}
									</Field>
									{prefill && detail.isError && (
										<CareerLoadError
											onRetry={() => {
												void detail.refetch();
											}}
										/>
									)}
								</>
							)}

							{draft.kind !== "prepare" && (
								<div className="grid gap-1.5">
									<div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
										<Field label={dateLabel}>
											{(props) => (
												<Input
													{...props}
													type="date"
													aria-invalid={Boolean(shownError("when")) || undefined}
													value={draft.date}
													onChange={(event) => set({ date: event.target.value })}
													onBlur={() => touch("when")}
													className="pointer-coarse:text-base"
												/>
											)}
										</Field>
										<Field label={t`Time · ${city}`}>
											{(props) => (
												<Input
													{...props}
													type="time"
													aria-invalid={Boolean(shownError("when")) || undefined}
													value={draft.time}
													onChange={(event) => set({ time: event.target.value })}
													onBlur={() => touch("when")}
													className="pointer-coarse:text-base"
												/>
											)}
										</Field>
									</div>
									<FieldError>{shownError("when")}</FieldError>
								</div>
							)}
							{draft.kind === "discovery" && (
								<p className="text-xs/4 text-ink-3">
									{searchService ? (
										<Trans>
											Searches through {searchService}, which may charge. Your resume and Knowledge are not sent.
											Results wait in Today; nothing is applied for or created.
										</Trans>
									) : (
										<Trans>
											Searches through your web search service, which may charge. Your resume and Knowledge are not
											sent. Results wait in Today; nothing is applied for or created.
										</Trans>
									)}
								</p>
							)}
						</Swap>

						<List cap>
							<ListRow
								title={t`Turn this schedule on`}
								subtitle={t`A paused schedule keeps its settings.`}
								trailing={
									<Switch
										aria-label={t`Turn this schedule on`}
										checked={draft.enabled}
										onCheckedChange={(enabled) => set({ enabled })}
									/>
								}
							/>
							{smtp ? (
								<ListRow
									title={t`Also email ${user?.email ?? ""}`}
									subtitle={
										!verified
											? t`Verify your email in Settings first`
											: draft.kind === "prepare"
												? t`The briefing always appears in Today.`
												: t`You always see results in Today.`
									}
									trailing={
										<Switch
											aria-label={t`Also email ${user?.email ?? ""}`}
											checked={verified && draft.email}
											disabled={!verified}
											onCheckedChange={(email) => set({ email })}
										/>
									}
								/>
							) : (
								<p className="py-3 text-xs/4 text-ink-3">
									<Trans>
										Email copies are unavailable on this server. In-app notifications still appear in Today.
									</Trans>
								</p>
							)}
						</List>
					</div>
				)}

				<SheetFooter className="relative pb-[max(16px,env(safe-area-inset-bottom))]">
					<Swap id={form?.discarding ? "discard" : "actions"} className="flex flex-1 flex-wrap items-center gap-2">
						{form?.discarding ? (
							<>
								<p role="status" className="me-auto text-sm font-semibold">
									<Trans>Discard changes?</Trans>
								</p>
								<Button
									variant="secondary"
									onClick={() => setForm((current) => current && { ...current, discarding: false })}
								>
									<Trans>Keep editing</Trans>
								</Button>
								<Button variant="danger" onClick={close}>
									<Trans>Discard</Trans>
								</Button>
							</>
						) : (
							<>
								{form?.existing && (
									<Button
										variant="danger-text"
										onClick={() => {
											if (form.existing) onDelete(form.existing.id);
											close();
										}}
									>
										<Trans>Delete</Trans>
									</Button>
								)}
								<span className="flex-1" />
								<Button variant="ghost" onClick={requestClose}>
									<Trans>Cancel</Trans>
								</Button>
								{needsWebSearch ? (
									<SetUpWebAccess />
								) : (
									<Button disabled={!form || blocked || prefillBlocked} loading={save.isPending} onClick={onSave}>
										<Trans>Save schedule</Trans>
									</Button>
								)}
							</>
						)}
					</Swap>
				</SheetFooter>
			</SheetContent>
		</Sheet>
	);
}

// ---- Parts ----

type FieldControlProps = { id: string; "aria-describedby"?: string; "aria-invalid"?: true };

type FieldProps = {
	label: string;
	hint?: string | undefined;
	error?: string | null;
	children: (props: FieldControlProps) => ReactNode;
};

/** One line of what a run sends, under its icon. */
function SentLine({ icon, children }: { icon: IconName; children: ReactNode }) {
	return (
		// The words are the paragraph's own text, so the line wraps beside the icon.
		<p className="flex items-start gap-2.5 text-sm/5">
			<Icon name={icon} size={18} className="mt-px shrink-0 text-ink-3" />
			{children}
		</p>
	);
}

const labelClassName = "text-[13px]/[18px] font-medium text-ink-2";
const hintClassName = "text-xs/4 text-ink-3";

/** Label 13/500 ink-2 6px above the control; a hint below, replaced by the error once there is one. */
function Field({ label, hint, error, children }: FieldProps) {
	const id = useId();
	const note = error ?? hint;
	return (
		<div className="grid gap-1.5">
			<label htmlFor={id} className={labelClassName}>
				{label}
			</label>
			{children({
				id,
				...(note ? { "aria-describedby": `${id}-note` } : {}),
				...(error ? { "aria-invalid": true as const } : {}),
			})}
			{error ? (
				<FieldError id={`${id}-note`}>{error}</FieldError>
			) : (
				hint && (
					<p id={`${id}-note`} className={hintClassName}>
						{hint}
					</p>
				)
			)}
		</div>
	);
}

function FieldError({ id, children }: { id?: string; children: string | null }) {
	if (!children) return null;
	return (
		<p id={id} className="flex items-center gap-1 text-xs text-danger-text">
			<Icon name="warning-circle" size={15} className="shrink-0" />
			{children}
		</p>
	);
}

type SegmentsProps = {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (value: string) => void;
	hint?: string | undefined;
};

/** A labelled segmented choice across the sheet's width, with one quiet line under it. */
function Segments({ label, value, options, onChange, hint }: SegmentsProps) {
	const id = useId();
	return (
		<div className="grid gap-1.5">
			<span id={id} className={labelClassName}>
				{label}
			</span>
			<SegmentedControl
				aria-labelledby={id}
				aria-describedby={hint ? `${id}-hint` : undefined}
				value={value}
				onValueChange={(next) => onChange(String(next))}
				className="flex w-full"
			>
				{options.map((option) => (
					<SegmentedControlItem key={option.value} value={option.value} className="flex-1">
						{option.label}
					</SegmentedControlItem>
				))}
			</SegmentedControl>
			{hint && (
				<p id={`${id}-hint`} className={hintClassName}>
					{hint}
				</p>
			)}
		</div>
	);
}
