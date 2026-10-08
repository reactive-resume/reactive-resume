import type { RouterOutput } from "@/libs/orpc/client";
import type { careerScheduleInputSchema } from "@reactive-resume/schema/career";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import type z from "zod";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { m } from "motion/react";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { fromZonedDateTime } from "@reactive-resume/utils/timezone";
import { PrivacyLine, Swap, useCareerTime, useNow } from "./shared";
import { collectInterviews, interviewKindOf } from "@/features/applications/interviews";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { AiProviderLoadState } from "@/features/settings/integrations/ai-provider-load-state";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { useClosingValue } from "@/hooks/use-closing-value";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { D2, EASE } from "@/libs/motion";
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
	return { icon: "globe-simple", title: t`Opportunity discovery` };
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
const prepareRunAt = (start: Date, lead: Lead, timeZone: string) =>
	lead === "morning"
		? fromZoned(toZoned(start, timeZone).date, "08:00", timeZone)
		: new Date(start.getTime() - (lead === "24h" ? 24 : 2) * 3_600_000);

// ---- The sheet ----

type Draft = {
	kind: Kind;
	query: string;
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
	const { when, timeZone, locale } = useCareerTime();
	const context = useRouteContext({ strict: false });
	const user = context.session?.user;
	const { data: schedules } = useQuery(orpc.career.schedules.queryOptions({ input: {} }));
	const { data: profile } = useQuery(orpc.career.profile.queryOptions());
	const { data: applications } = useQuery(applicationsListQueryOptions());
	const { data: webAccess } = useQuery(orpc.webAccess.status.queryOptions());
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
			query: existing?.query || [...profile.targetRoles, ...profile.locations].join(" · "),
			every: String(existing?.intervalDays ?? 1),
			...toZoned(at, timeZone),
			interviewId: existing?.interviewId ?? upcoming[0]?.interview.id ?? "",
			lead: (existing?.lead as Lead | null) ?? "24h",
			aiProviderId: providers.find((provider) => provider.id === existing?.aiProviderId)?.id ?? providers[0]?.id ?? "",
			applicationId: existing?.applicationId ?? applicationId ?? open[0]?.id ?? "",
			enabled: existing?.enabled ?? true,
			email: existing?.email ?? false,
		};
		setForm({ target: shown, existing, initial, draft: initial, touched: {}, submitted: false, discarding: false });
	}

	const draft = form?.draft;
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
	const enteredAt = draft ? fromZoned(draft.date, draft.time, timeZone) : null;
	const errors = {
		query: draft?.kind === "discovery" && draft.query.trim().length < 3 ? t`Add a role or company to look for.` : null,
		when:
			draft && draft.kind !== "prepare" && enteredAt && !(enteredAt > now)
				? Number.isNaN(enteredAt.getTime())
					? t`This time does not exist in your timezone. Choose another time.`
					: t`Pick a time after now.`
				: null,
	};
	const shownError = (field: keyof typeof errors) =>
		(form?.submitted || form?.touched[field]) && errors[field] ? errors[field] : null;
	const smtp = context.flags?.smtpEnabled ?? false;
	const verified = Boolean(user?.emailVerified);
	const blocked =
		(draft?.kind === "prepare" && (!interview || providers.length === 0)) ||
		(draft?.kind === "follow-up" && open.length === 0);
	const needsWebSearch = draft?.kind === "discovery" && webAccess?.search === false;

	const onSave = () => {
		if (!form || !draft) return;
		setForm({ ...form, submitted: true });
		if (errors.query || errors.when || blocked) return;
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
				query: draft.kind === "discovery" ? draft.query.trim() : "",
				interviewId: draft.kind === "prepare" ? draft.interviewId || null : null,
				lead: draft.kind === "prepare" ? draft.lead : null,
				enabled: draft.enabled,
				email: smtp && verified && draft.email,
				nextRunAt: runAt ?? fromZoned(draft.date, draft.time, timeZone),
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
				onError: (error) =>
					toast.add({
						type: "error",
						description: getOrpcErrorMessage(error, {
							fallback: t`Couldn't save this schedule.`,
							allowServerMessage: true,
						}),
					}),
			},
		);
	};

	const dateLabel = draft?.kind === "follow-up" ? t`Remind me on` : t`First run`;

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
			<SheetContent
				side={phone ? "bottom" : "right"}
				showCloseButton={false}
				className="gap-0 data-[side=right]:border-s data-[side=right]:border-line data-[side=right]:sm:max-w-[480px]"
			>
				<div className="flex items-center gap-3 border-b border-line ps-[22px] pe-3 pt-[18px] pb-3.5">
					<SheetTitle className="flex-1">
						{form?.existing ? <Trans>Edit schedule</Trans> : <Trans>New schedule</Trans>}
					</SheetTitle>
					<SheetClose aria-label={t`Close`} render={<Button variant="ghost" size="icon" className="text-ink-2" />}>
						<Icon name="x" />
					</SheetClose>
				</div>

				{!form || !draft ? (
					<div className="grid min-h-40 flex-1 place-items-center">
						<Spinner />
					</div>
				) : (
					<div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[22px] py-5">
						<Segments
							label={t`What should run`}
							value={draft.kind}
							onChange={(kind) => set({ kind: kind as Kind })}
							options={[
								{ value: "discovery", label: t`Find roles` },
								{ value: "prepare", label: t`Prepare` },
								{ value: "follow-up", label: t`Remind me` },
							]}
						/>

						<Swap id={draft.kind} className="flex flex-col gap-[18px]">
							{draft.kind === "discovery" && (
								<>
									<Field
										label={t`Look for`}
										hint={t`Roles, places and companies. Starts from your preferences.`}
										error={shownError("query")}
									>
										{(props) => (
											<Input
												{...props}
												value={draft.query}
												maxLength={500}
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
									<p className="flex gap-2.5 rounded-lg bg-info-soft px-3 py-2.5 text-[13px] leading-[19px] text-ink">
										<Icon name="globe-simple" size={18} className="mt-px shrink-0 text-info-text" />
										<Trans>
											Uses the web search service set up in Settings. Results wait in Today for your review;
											applications and documents are never created for you.
										</Trans>
									</p>
								</>
							)}

							{draft.kind === "prepare" && (
								<>
									<Field
										label={t`Interview`}
										hint={
											choices.length === 0
												? t`Add an interview in an application first`
												: runAt && runAt <= now
													? draft.lead === "morning"
														? t`The morning of the interview has passed, so the briefing runs now.`
														: t`Starts in under ${draft.lead === "24h" ? 24 : 2} hours, so the briefing runs now.`
													: undefined
										}
									>
										{(props) => (
											<NativeSelect
												{...props}
												disabled={choices.length === 0}
												value={draft.interviewId}
												onChange={(event) => set({ interviewId: event.target.value })}
												className="pointer-coarse:text-base"
											>
												{choices.map((item) => (
													<option key={item.interview.id} value={item.interview.id}>
														{[
															item.application.company,
															interviewKindOf(item.interview.kind)?.label ?? item.interview.kind,
															when(item.start),
														].join(" · ")}
													</option>
												))}
											</NativeSelect>
										)}
									</Field>
									<Segments
										label={t`Prepare a briefing`}
										value={draft.lead}
										onChange={(lead) => set({ lead: lead as Lead })}
										options={[
											{ value: "24h", label: t`24 hours before` },
											{ value: "2h", label: t`2 hours before` },
											{ value: "morning", label: t`Morning of` },
										]}
									/>
									<Field label={t`AI connection`}>
										{(props) =>
											providerState.isUnavailable ? (
												<AiProviderLoadState state={providerState} />
											) : providers.length === 0 ? (
												<Button
													variant="link"
													nativeButton={false}
													className="w-fit"
													render={<Link to="/dashboard/settings/ai" />}
												>
													<Trans>Connect an AI provider in Settings</Trans>
												</Button>
											) : (
												<NativeSelect
													{...props}
													value={draft.aiProviderId}
													onChange={(event) => set({ aiProviderId: event.target.value })}
													className="pointer-coarse:text-base"
												>
													{providers.map((provider) => (
														<option key={provider.id} value={provider.id}>
															{provider.label}
														</option>
													))}
												</NativeSelect>
											)
										}
									</Field>
									{/* The run itself falls back to the default the same way, so this says what will happen. */}
									{form?.existing?.kind === "prepare" &&
										providers.length > 0 &&
										!providers.some((provider) => provider.id === form.existing?.aiProviderId) && (
											<p className="-mt-2 text-xs text-warn-text">
												{t`Its connection was switched off or removed, so it runs on ${providers[0]?.label ?? ""} until you choose another.`}
											</p>
										)}
									<PrivacyLine cost>
										<Trans>
											Sends this application's posting, notes and documents, plus Knowledge that's switched on, to this
											connection. Your provider may charge for it.
										</Trans>
									</PrivacyLine>
								</>
							)}

							{draft.kind === "follow-up" && (
								<Field label={t`Application`} hint={open.length === 0 ? t`Add an application first` : undefined}>
									{(props) => (
										<NativeSelect
											{...props}
											disabled={open.length === 0}
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
							)}

							{draft.kind !== "prepare" && (
								<div className="grid gap-1.5">
									<div className="grid grid-cols-2 gap-3">
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
										<Field label={t`Time · ${timeZone}`}>
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
						</Swap>

						<div className="flex flex-col border-t border-line">
							<SwitchRow
								checked={draft.enabled}
								onCheckedChange={(enabled) => set({ enabled })}
								label={<span className="font-semibold">{t`Turn this schedule on`}</span>}
								description={t`Paused schedules keep their settings.`}
								className="rounded-none border-b border-line py-3.5"
							/>
							{smtp && (
								<SwitchRow
									checked={verified && draft.email}
									disabled={!verified}
									onCheckedChange={(email) => set({ email })}
									label={<span className="font-semibold">{t`Also email ${user?.email ?? ""}`}</span>}
									description={
										verified
											? t`You'll always see it in Today. Email depends on your server's mail setup.`
											: t`Verify your email in Settings first`
									}
									className="rounded-none border-b border-line py-3.5"
								/>
							)}
						</div>
					</div>
				)}

				<div className="relative border-t border-line px-[22px] py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
					<Swap id={form?.discarding ? "discard" : "actions"} className="flex flex-wrap items-center gap-2">
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
										variant="ghost"
										className="text-danger-text"
										onClick={() => {
											if (form.existing) onDelete(form.existing.id);
											close();
										}}
									>
										<Trans>Delete</Trans>
									</Button>
								)}
								<span className="flex-1" />
								<Button variant="secondary" onClick={requestClose}>
									<Trans>Cancel</Trans>
								</Button>
								{needsWebSearch ? (
									<Button variant="secondary" nativeButton={false} render={<Link to="/dashboard/settings/ai" />}>
										<Trans>Set up web search in Settings</Trans>
									</Button>
								) : (
									<Button disabled={!form || blocked} loading={save.isPending} onClick={onSave}>
										<Trans>Save schedule</Trans>
									</Button>
								)}
							</>
						)}
					</Swap>
				</div>
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

/** Label 12/500 ink-2 6px above the control; a hint below, replaced by the error once there is one. */
function Field({ label, hint, error, children }: FieldProps) {
	const id = useId();
	const note = error ?? hint;
	return (
		<div className="grid gap-1.5">
			<label htmlFor={id} className="text-xs font-medium text-ink-2">
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
					<p id={`${id}-note`} className="text-xs text-ink-3">
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
};

/** A labelled segmented choice whose raised thumb slides to the chosen option. */
function Segments({ label, value, options, onChange }: SegmentsProps) {
	const id = useId();
	return (
		<div className="grid gap-1.5">
			<span id={id} className="text-xs font-medium text-ink-2">
				{label}
			</span>
			<SegmentedControl
				aria-labelledby={id}
				value={value}
				onValueChange={(next) => onChange(String(next))}
				className="flex w-full"
			>
				{options.map((option) => (
					<SegmentedControlItem
						key={option.value}
						value={option.value}
						className="relative data-checked:bg-transparent data-checked:shadow-none"
					>
						{option.value === value && (
							<m.span
								layoutId={`${id}-thumb`}
								transition={{ duration: D2, ease: EASE }}
								className="absolute inset-0 rounded-sm bg-raised shadow-e1"
							/>
						)}
						<span className="relative">{option.label}</span>
					</SegmentedControlItem>
				))}
			</SegmentedControl>
		</div>
	);
}
