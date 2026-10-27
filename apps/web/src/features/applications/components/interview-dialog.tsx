import type { ApplicationSummary } from "../types";
import type { InterviewKind, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { m } from "motion/react";
import { useId, useMemo, useState } from "react";
import { interviewDetailsSchema } from "@reactive-resume/schema/applications/data";
import { Button } from "@reactive-resume/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { generateId } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { fromZonedDateTime } from "@reactive-resume/utils/timezone";
import { dayKey } from "../interviews";
import { applicationsListQueryKey } from "../queries";
import { Combobox } from "@/components/ui/combobox";
import { useCareerTime, withUndo } from "@/features/career/shared";
import { useClosingValue } from "@/hooks/use-closing-value";
import { D2, EASE } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

/** "Screening", "Behavioral": interview types in the interface language. */
export const interviewTypeLabel = (kind: InterviewKind) =>
	({
		screening: t`Screening`,
		technical: t`Technical`,
		behavioral: t`Behavioral`,
		onsite: t`Onsite`,
		other: t`Other`,
	})[kind];

const KINDS: InterviewKind[] = ["screening", "technical", "behavioral", "onsite", "other"];
const LENGTHS = [30, 45, 60, 90];

// ---- Wall-clock time in a named timezone ----

const zoneFormatter = (timeZone: string) =>
	new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	});

/** An instant as the date ("2026-10-08") and time ("17:58") on a clock in `timeZone`. */
function zonedParts(instant: Date | string, timeZone: string) {
	const parts = Object.fromEntries(
		zoneFormatter(timeZone)
			.formatToParts(new Date(instant))
			.map(({ type, value }) => [type, value]),
	);
	return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const isTimeZone = (value: string) => {
	try {
		new Intl.DateTimeFormat("en", { timeZone: value });
		return true;
	} catch {
		return false;
	}
};

type Draft = {
	applicationId: string;
	kind: InterviewKind;
	date: string;
	time: string;
	durationMinutes: number;
	location: string;
	notes: string;
	/** Not shown any more; kept so saving doesn't reset it. */
	audience: InterviewTimelineEntry["audience"];
	timezone: string;
	participants: { id: string; name: string; role: string; profileUrl: string }[];
};

// New interviews default to the given day (or tomorrow) at 09:00 in the timezone, or the next full hour if that's past.
function emptyDraft(applicationId: string, timezone: string, day?: Date | null): Draft {
	const now = new Date();
	const date = dayKey(day ?? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
	let at = fromZonedDateTime(date, "09:00", timezone) ?? now;
	if (at <= now) at = new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000);
	return {
		applicationId,
		kind: "screening",
		...zonedParts(at, timezone),
		durationMinutes: 60,
		location: "",
		notes: "",
		audience: "other",
		timezone,
		participants: [],
	};
}

const draftFrom = (applicationId: string, interview: InterviewTimelineEntry, fallbackZone: string): Draft => {
	const timezone = interview.timezone && isTimeZone(interview.timezone) ? interview.timezone : fallbackZone;
	return {
		applicationId,
		kind: interview.kind,
		...zonedParts(interview.at, timezone),
		durationMinutes: interview.durationMinutes,
		location: interview.location,
		notes: interview.notes,
		audience: interview.audience ?? "other",
		timezone,
		participants: (interview.participants ?? []).map((participant) => ({
			id: generateId(),
			name: participant.name,
			role: participant.role,
			profileUrl: participant.profileUrl ?? "",
		})),
	};
};

type InterviewDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// The application the interview belongs to. When omitted, an application picker is shown
	// (used by the calendar, where no application is selected yet).
	application?: ApplicationSummary | null;
	// Applications offered by the picker when `application` is omitted.
	applications?: ApplicationSummary[];
	// Set when editing an existing interview.
	interview?: InterviewTimelineEntry | null;
	// Pre-selects this day when scheduling (e.g. a day clicked on the calendar).
	day?: Date | null;
};

const FULL_SCREEN_ON_PHONES =
	"max-sm:inset-s-0 max-sm:top-0 max-sm:h-dvh max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none";

/** W20: type, time, length, people and what they asked for. Date and time are wall-clock in the interview's timezone. */
export function InterviewDialog({
	open,
	onOpenChange,
	application,
	applications = [],
	interview,
	day,
}: InterviewDialogProps) {
	const queryClient = useQueryClient();
	const { when, timeZone: preferredZone } = useCareerTime();
	const id = useId();
	// Held through the closing animation, so the title and Delete don't flip while it fades.
	const [editing, onOpenChangeComplete] = useClosingValue(interview ?? null);
	const [draft, setDraft] = useState<Draft>(() =>
		interview
			? draftFrom(application?.id ?? "", interview, preferredZone)
			: emptyDraft(application?.id ?? "", preferredZone, day),
	);
	const [otherZone, setOtherZone] = useState(false);

	// A fresh draft each time the dialog opens, adjusted during render so the first frame is never stale.
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			const applicationId = application?.id ?? "";
			setDraft(
				interview ? draftFrom(applicationId, interview, preferredZone) : emptyDraft(applicationId, preferredZone, day),
			);
			setOtherZone(false);
		}
	}

	const invalidate = (applicationId: string) => {
		void queryClient.invalidateQueries({ queryKey: applicationsListQueryKey() });
		void queryClient.invalidateQueries({
			queryKey: orpc.applications.getById.queryKey({ input: { id: applicationId } }),
		});
	};

	const add = useMutation(
		orpc.applications.addInterview.mutationOptions({
			onError: () => toast.add({ type: "error", description: t`Couldn't schedule the interview. Try again.` }),
		}),
	);
	const update = useMutation(
		orpc.applications.updateInterview.mutationOptions({
			onError: () => toast.add({ type: "error", description: t`Couldn't update the interview. Try again.` }),
		}),
	);
	const remove = useMutation(
		orpc.applications.deleteTimelineEntry.mutationOptions({
			onSettled: (_data, _error, variables) => invalidate(variables.id),
			onError: () => toast.add({ type: "error", description: t`Couldn't delete the interview. Try again.` }),
		}),
	);

	const zones = useMemo(() => {
		const all = Intl.supportedValuesOf("timeZone");
		return all.includes(draft.timezone) ? all : [draft.timezone, ...all];
	}, [draft.timezone]);

	const pending = add.isPending || update.isPending;
	const original = editing ? zonedParts(editing.at, draft.timezone) : null;
	// Keep the exact stored instant when the clock time is unchanged, including during a DST overlap.
	const at =
		editing && original?.date === draft.date && original.time === draft.time
			? new Date(editing.at)
			: draft.date && draft.time
				? fromZonedDateTime(draft.date, draft.time, draft.timezone)
				: null;
	const details = interviewDetailsSchema.safeParse({
		...draft,
		participants: draft.participants
			.filter(({ name }) => name.trim())
			.map(({ name, role, profileUrl }) => ({
				name,
				role,
				...(profileUrl.trim() ? { profileUrl: profileUrl.trim() } : {}),
			})),
	});
	const participantsInvalid = details.error?.issues.some((issue) => issue.path[0] === "participants") ?? false;
	const canSave = !!at && !!draft.applicationId && details.success && !pending;
	const showZone = otherZone || draft.timezone !== preferredZone;
	const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));
	const setParticipant = (participantId: string, patch: Partial<Draft["participants"][number]>) =>
		setDraft((prev) => ({
			...prev,
			participants: prev.participants.map((participant) =>
				participant.id === participantId ? { ...participant, ...patch } : participant,
			),
		}));

	const save = async () => {
		if (!at || !canSave || !details.success) return;
		const input = { id: draft.applicationId, at: at.toISOString(), ...details.data };
		try {
			if (editing) await update.mutateAsync({ ...input, entryId: editing.id });
			else await add.mutateAsync(input);
		} catch {
			return;
		}
		invalidate(draft.applicationId);
		onOpenChange(false);
		// The server moves this interview's briefing schedule with it; say where it went.
		const schedules = editing
			? await queryClient
					.fetchQuery({ ...orpc.career.schedules.queryOptions({ input: {} }), staleTime: 0 })
					.catch(() => [])
			: [];
		const schedule = schedules.find(
			(item) => item.kind === "prepare" && item.interviewId === editing?.id && item.enabled,
		);
		toast.add({
			type: "success",
			description: schedule ? t`Interview saved · briefing moves to ${when(schedule.nextRunAt)}` : t`Interview saved`,
		});
	};

	// Commit after Undo closes so a restored round retains its identity, history and briefing schedules.
	const deleteInterview = () => {
		if (!editing) return;
		const applicationId = draft.applicationId;
		const drop = <T extends Pick<ApplicationSummary, "id" | "activity">>(item: T) =>
			item.id === applicationId
				? { ...item, activity: item.activity.filter((entry) => entry.id !== editing.id) }
				: item;
		queryClient.setQueryData(applicationsListQueryKey(), (list) => list?.map(drop));
		queryClient.setQueryData(
			orpc.applications.getById.queryKey({ input: { id: applicationId } }),
			(item) => item && drop(item),
		);
		onOpenChange(false);
		withUndo({
			description: t`Interview deleted`,
			onUndo: () => invalidate(applicationId),
			commit: () => {
				void remove
					.mutateAsync({ id: applicationId, entryId: editing.id })
					.catch(() => undefined)
					.finally(() => invalidate(applicationId));
			},
		});
	};

	const lengths = LENGTHS.includes(draft.durationMinutes)
		? LENGTHS
		: [...LENGTHS, draft.durationMinutes].sort((a, b) => a - b);
	const pickable = applications.filter((item) => item.status !== "closed");

	return (
		<Dialog open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
			<DialogContent
				closeLabel={t`Close`}
				className={cn(
					"flex max-h-[min(820px,calc(100svh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]",
					FULL_SCREEN_ON_PHONES,
				)}
			>
				<div className="grid gap-0.5 ps-6 pe-14 pt-5">
					<DialogTitle className="text-2xl leading-8">
						{editing ? <Trans>Edit interview</Trans> : <Trans>Schedule an interview</Trans>}
					</DialogTitle>
					<DialogDescription className="text-[13px] leading-[18px]">
						{application ? (
							<>
								{application.role} · {application.company}
							</>
						) : (
							<Trans>It will show on the application's timeline and on the calendar.</Trans>
						)}
					</DialogDescription>
				</div>

				<div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto overscroll-contain px-6 py-[18px]">
					{!application && (
						<Field label={t`Application`} htmlFor={`${id}-application`}>
							<Combobox
								id={`${id}-application`}
								className="w-full"
								value={draft.applicationId || null}
								placeholder={t`Choose an application…`}
								emptyMessage={t`No active applications.`}
								options={pickable.map((item) => ({
									value: item.id,
									label: `${item.company} — ${item.role}`,
									keywords: [item.company, item.role],
								}))}
								onValueChange={(value) => set("applicationId", value ?? "")}
							/>
						</Field>
					)}

					<Field label={t`Type`}>
						<Segments
							label={t`Type`}
							value={draft.kind}
							options={KINDS.map((kind) => ({ value: kind, label: interviewTypeLabel(kind) }))}
							onChange={(kind) => set("kind", kind)}
							className="h-auto flex-wrap sm:h-9 sm:flex-nowrap"
						/>
					</Field>

					<div className="grid gap-2.5 sm:grid-cols-3">
						<Field label={t`Date`} htmlFor={`${id}-date`}>
							<Input
								id={`${id}-date`}
								type="date"
								required
								aria-invalid={!draft.date}
								value={draft.date}
								onChange={(event) => set("date", event.target.value)}
							/>
						</Field>
						<Field label={t`Time · ${draft.timezone}`} htmlFor={`${id}-time`}>
							<Input
								id={`${id}-time`}
								type="time"
								required
								aria-invalid={!draft.time || (!!draft.date && !at)}
								aria-describedby={draft.date && draft.time && !at ? `${id}-time-error` : undefined}
								value={draft.time}
								onChange={(event) => set("time", event.target.value)}
							/>
						</Field>
						<Field label={t`Length · minutes`}>
							<Segments
								label={t`Length in minutes`}
								value={draft.durationMinutes}
								options={lengths.map((minutes) => ({ value: minutes, label: String(minutes) }))}
								onChange={(minutes) => set("durationMinutes", minutes)}
							/>
						</Field>
					</div>

					{draft.date && draft.time && !at && (
						<p id={`${id}-time-error`} role="alert" className="text-xs text-danger-text">
							<Trans>This time does not exist in the selected timezone. Choose another time.</Trans>
						</p>
					)}

					{showZone ? (
						<div className="-mt-1 grid gap-1.5">
							<Field label={t`Interview timezone`} htmlFor={`${id}-timezone`}>
								<Combobox
									id={`${id}-timezone`}
									className="w-full"
									value={draft.timezone}
									options={zones.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") }))}
									onValueChange={(value) => value && set("timezone", value)}
								/>
							</Field>
							{at && draft.timezone !== preferredZone && (
								<p className="text-xs text-ink-3">
									<Trans>
										{draft.time} in {draft.timezone} is {when(at)} in your timezone ({preferredZone}).
									</Trans>
								</p>
							)}
						</div>
					) : (
						<p className="-mt-2 text-xs text-ink-3">
							<Trans>Shown in your timezone.</Trans>{" "}
							<button
								type="button"
								className="underline underline-offset-2 transition-colors duration-quick hover:text-ink-2"
								onClick={() => setOtherZone(true)}
							>
								<Trans>Interview is in another timezone</Trans>
							</button>
						</p>
					)}

					<Field label={t`Location`} htmlFor={`${id}-location`}>
						<Input
							id={`${id}-location`}
							value={draft.location}
							maxLength={500}
							placeholder={t`Video link, office address, or phone number`}
							onChange={(event) => set("location", event.target.value)}
						/>
					</Field>

					<fieldset className="grid gap-2">
						<legend className="mb-1.5 text-xs font-medium text-ink-2">
							<Trans>Who you'll meet</Trans>
						</legend>
						{draft.participants.map((participant, index) => (
							<div key={participant.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px] gap-2">
								<Input
									aria-label={t`Name of person ${index + 1}`}
									placeholder={t`Name`}
									value={participant.name}
									maxLength={200}
									onChange={(event) => setParticipant(participant.id, { name: event.target.value })}
								/>
								<Input
									aria-label={t`Role of person ${index + 1}`}
									placeholder={t`Role`}
									value={participant.role}
									maxLength={200}
									onChange={(event) => setParticipant(participant.id, { role: event.target.value })}
								/>
								<IconButton
									icon="x"
									iconSize={18}
									label={t`Remove person ${index + 1}`}
									className="h-9 w-8 text-ink-2"
									onClick={() =>
										set(
											"participants",
											draft.participants.filter((item) => item.id !== participant.id),
										)
									}
								/>
								<Input
									type="url"
									aria-label={t`Profile link of person ${index + 1}`}
									placeholder={t`Profile link (optional)`}
									className="col-span-2"
									value={participant.profileUrl}
									maxLength={2048}
									onChange={(event) => setParticipant(participant.id, { profileUrl: event.target.value })}
								/>
							</div>
						))}
						{participantsInvalid && (
							<p role="status" className="text-xs text-danger-text">
								<Trans>Profile links must be public HTTPS addresses.</Trans>
							</p>
						)}
						<Button
							size="sm"
							variant="ghost"
							className="w-fit text-ink-2"
							disabled={draft.participants.length >= 20}
							onClick={() =>
								set("participants", [...draft.participants, { id: generateId(), name: "", role: "", profileUrl: "" }])
							}
						>
							<Icon name="user-plus" size={18} />
							<Trans>Add a person</Trans>
						</Button>
						<p className="text-xs text-ink-3">
							<Trans>Public profile links are optional and only used if Web research is on.</Trans>
						</p>
					</fieldset>

					<Field label={t`What they asked you to prepare`} htmlFor={`${id}-notes`}>
						<Textarea
							id={`${id}-notes`}
							rows={2}
							value={draft.notes}
							maxLength={5000}
							onChange={(event) => set("notes", event.target.value)}
						/>
					</Field>
				</div>

				<div className="flex items-center gap-2 border-t border-line px-6 py-3.5 pb-[max(14px,env(safe-area-inset-bottom))]">
					{editing && (
						<Button variant="ghost" className="text-danger-text" disabled={pending} onClick={deleteInterview}>
							<Icon name="trash" size={18} />
							<Trans>Delete</Trans>
						</Button>
					)}
					<span className="flex-1" />
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						<Trans>Cancel</Trans>
					</Button>
					<Button loading={pending} disabled={!canSave} onClick={() => void save()}>
						<Trans>Save interview</Trans>
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

type SegmentsProps<T extends string | number> = {
	label: string;
	value: T;
	options: { value: T; label: string }[];
	onChange: (value: T) => void;
	className?: string;
};

/** A segmented control whose raised thumb slides between choices. */
function Segments<T extends string | number>({ label, value, options, onChange, className }: SegmentsProps<T>) {
	const id = useId();
	return (
		<SegmentedControl
			aria-label={label}
			value={value}
			onValueChange={(next) => onChange(next as T)}
			className={cn("flex w-full", className)}
		>
			{options.map((option) => (
				<SegmentedControlItem
					key={option.value}
					value={option.value}
					className="relative min-h-[30px] min-w-fit px-2 pointer-coarse:min-w-fit data-checked:bg-transparent data-checked:shadow-none"
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
	);
}

type FieldProps = { label: string; htmlFor?: string; children: React.ReactNode };

function Field({ label, htmlFor, children }: FieldProps) {
	return (
		<div className="grid content-start gap-1.5">
			<Label htmlFor={htmlFor} className="text-xs font-medium text-ink-2">
				{label}
			</Label>
			{children}
		</div>
	);
}
