import type { Application } from "../../types";
import type { ApplicationTimelineEntry, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { showInterviewCancellation } from "../../calendar";
import { dayKey, interviewKindOf, interviewTypeLabel } from "../../interviews";
import { getCategoryLane, getLaneLabel, isCurrentLaneEvent } from "../../lanes";
import { useInvalidateApplications } from "../../use-application-actions";
import { useApplicationLanes } from "../../use-application-lanes";
import { DateColumn } from "@/components/calm/list-row";
import { useCareerTime, useNow } from "@/features/career/shared";
import { useClosingValue } from "@/hooks/use-closing-value";
import { useConfirm } from "@/hooks/use-confirm";
import { getAccountGeneration } from "@/libs/auth/account-scope";
import { orpc } from "@/libs/orpc/client";

const byNewest = (a: ApplicationTimelineEntry, b: ApplicationTimelineEntry) =>
	new Date(b.at).getTime() - new Date(a.at).getTime();

const dateInputValue = (value: Date | string) => {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

type ActivityProps = {
	application: Application;
	onOpenInterview: (interview: InterviewTimelineEntry) => void;
	/** The heading, given whether the Log an update field shows and how to toggle it. Without it, the field always shows. */
	renderHeader?: (log: { open: boolean; toggle: () => void }) => ReactNode;
	/** More ways to log, beside the field's hint (Followed up). */
	logActions?: ReactNode;
	/** The workspace update form uses a weekday-over-day date column. */
	dateColumnWhenLogging?: boolean;
};

/**
 * The timeline (`.tl`): stage changes, notes and interviews, newest first, each by its date. Log an update opens a note
 * field (and Followed up). Each row's ⋯ edits its date (and a note's text) or deletes it; the entry that anchors the
 * current stage can't be deleted.
 */
export function Activity({
	application,
	onOpenInterview,
	renderHeader,
	logActions,
	dateColumnWhenLogging = false,
}: ActivityProps) {
	const { format, day, plainTime, locale, timeZone } = useCareerTime();
	const logId = useId();
	const now = useNow();
	const [logOpen, setLogOpen] = useState(!renderHeader);
	const invalidate = useInvalidateApplications();
	const confirm = useConfirm();
	const { lanes } = useApplicationLanes();
	const [note, setNote] = useState("");
	const [editing, setEditing] = useState<{
		entry: ApplicationTimelineEntry;
		field: "date" | "note";
		date: string;
		text: string;
	} | null>(null);
	// Closing keeps the entry's title and fields on screen until the dialog has faded out.
	const [shownEdit, onEditOpenChangeComplete] = useClosingValue(editing);

	const onError = () => toast.add({ type: "error", description: t`Couldn't update the timeline. Try again.` });
	const addNote = useMutation({
		...orpc.applications.addNote.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError,
	});
	const updateEntry = useMutation({
		...orpc.applications.updateTimelineEntry.mutationOptions(),
		onSuccess: () => {
			invalidate(application.id);
			setEditing(null);
		},
		onError,
	});
	const deleteEntry = useMutation({
		...orpc.applications.deleteTimelineEntry.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError,
	});

	const sorted = [...application.activity].sort(byNewest);
	const anchorId = sorted.find((entry) => isCurrentLaneEvent(entry, application))?.id;
	// Stage and note entries are whole days, stored at noon UTC; interviews and follow-ups are instants.
	const formatDay = (value: Date | string, instant: boolean) =>
		format(value, { weekday: "short", day: "numeric", month: "short", ...(instant ? {} : { timeZone: "UTC" }) });
	// "in 3 days", for an interview still to come.
	const fromToday = (value: Date | string) => {
		const days = Math.round(
			(Date.parse(dayKey(new Date(value), timeZone)) - Date.parse(dayKey(now, timeZone))) / 86_400_000,
		);
		return days >= 0 ? new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(days, "day") : null;
	};

	const describe = (entry: ApplicationTimelineEntry) => {
		if (entry.type === "stage") {
			// The lane as it's named now; else its name when the move happened; else the stage's default lane.
			const lane = lanes.find((item) => item.id === entry.laneId && item.category === entry.stage);
			const fallback = getCategoryLane(lanes, entry.stage);
			const label = lane ? getLaneLabel(lane) : (entry.laneLabel ?? getLaneLabel(fallback));
			return {
				dot: "var(--ink-3)",
				// The first entry is where the application started, not a move.
				text: entry.dateUnknown
					? `${t`Imported`} · ${label}`
					: entry.id === sorted.at(-1)?.id
						? label
						: t`Moved to ${label}`,
			};
		}
		if (entry.type === "note")
			return {
				dot: "var(--ink-3)",
				text: entry.followedUp
					? entry.followedUp.kind === "reply"
						? entry.text === "Replied" || entry.text === t`Replied`
							? t`Replied`
							: `${t`Replied`} · ${entry.text}`
						: entry.text === "Followed up" || entry.text === t`Followed up`
							? t`Followed up`
							: `${t`Followed up`} · ${entry.text}`
					: entry.text,
			};
		const kind = interviewKindOf(entry.kind);
		const upcoming = fromToday(entry.at);
		return {
			dot:
				getCategoryLane(lanes, entry.kind === "screening" ? "screening" : "interview").color ??
				(entry.kind === "screening" ? "var(--stage-screening)" : "var(--stage-interview)"),
			text: [t`${kind?.label ?? entry.kind} interview`, plainTime(entry.at), upcoming].filter(Boolean).join(" · "),
		};
	};

	const submit = () => {
		const text = note.trim();
		if (!text || addNote.isPending) return;
		addNote.mutate({ id: application.id, text }, { onSuccess: () => setNote("") });
	};

	return (
		<section aria-labelledby="application-activity" className={renderHeader ? "grid" : "grid gap-2"}>
			{renderHeader ? (
				renderHeader({ open: logOpen, toggle: () => setLogOpen((open) => !open) })
			) : (
				<h3 id="application-activity" className="t-label">
					<Trans>Timeline</Trans>
				</h3>
			)}
			{logOpen && (
				<div className={renderHeader ? "grid gap-1.5 pb-2" : "contents"}>
					<form
						className="flex gap-1.5"
						onSubmit={(event) => {
							event.preventDefault();
							submit();
						}}
					>
						<Input
							id={logId}
							aria-label={t`Log an update`}
							placeholder={t`Log an update…`}
							value={note}
							// oxlint-disable-next-line jsx-a11y/no-autofocus -- the field opens because Log an update was pressed
							autoFocus={!!renderHeader}
							disabled={addNote.isPending}
							onChange={(event) => setNote(event.target.value)}
							onKeyDown={(event) => {
								if (event.key !== "Escape" || !renderHeader) return;
								event.stopPropagation();
								setLogOpen(false);
							}}
						/>
						<Button type="submit" variant="secondary" disabled={!note.trim() || addNote.isPending}>
							<Trans>Log</Trans>
						</Button>
					</form>
					<p className="flex flex-wrap items-center gap-x-3 text-xs text-ink-3">
						<Trans>Dated updates. For things to remember and share with the coach, use Notes.</Trans>
						{logActions}
					</p>
				</div>
			)}

			<ol className="grid">
				{sorted.map((entry) => {
					const { dot, text } = describe(entry);
					const dateOptions =
						entry.type === "interview" || (entry.type === "note" && entry.followedUp) ? {} : { timeZone: "UTC" };
					return (
						<li
							key={entry.id}
							className={cn(
								"group relative grid items-center gap-2.5 text-[13px]/[18px]",
								dateColumnWhenLogging && logOpen
									? "min-h-[52px] grid-cols-[36px_8px_minmax(0,1fr)]"
									: "min-h-[28px] grid-cols-[76px_8px_minmax(0,1fr)]",
							)}
						>
							{entry.type === "stage" && entry.dateUnknown ? (
								<span className="text-ink-3">{t`Not recorded`}</span>
							) : dateColumnWhenLogging && logOpen ? (
								<DateColumn
									className="w-9 [&>span:last-child]:text-[18px]/[22px]"
									aria-label={formatDay(
										entry.at,
										entry.type === "interview" || (entry.type === "note" && !!entry.followedUp),
									)}
									label={format(entry.at, { weekday: "short", ...dateOptions })}
									day={format(entry.at, { day: "numeric", ...dateOptions })}
								/>
							) : (
								<span className="whitespace-nowrap text-ink-3">
									{formatDay(entry.at, entry.type === "interview" || (entry.type === "note" && !!entry.followedUp))}
								</span>
							)}
							<span aria-hidden="true" className="size-2 rounded-full" style={{ background: dot }} />
							{entry.type === "interview" ? (
								<button
									type="button"
									onClick={() => onOpenInterview(entry)}
									className="min-w-0 truncate text-start hover:underline"
								>
									{text}
								</button>
							) : (
								<span className="min-w-0 break-words whitespace-pre-wrap">{text}</span>
							)}
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											size="icon-xs"
											variant="ghost"
											aria-label={t`Options for this entry`}
											className="absolute inset-e-0 top-1/2 -translate-y-1/2 bg-raised text-ink-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
										/>
									}
								>
									<Icon name="dots-three" size={16} />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									{entry.type === "interview" ? (
										<DropdownMenuItem onClick={() => onOpenInterview(entry)}>
											<Icon name="pencil-simple" />
											<Trans>Edit interview…</Trans>
										</DropdownMenuItem>
									) : (
										<>
											{entry.type === "note" && (
												<DropdownMenuItem
													onClick={() =>
														setEditing({ entry, field: "note", date: dateInputValue(entry.at), text: entry.text })
													}
												>
													<Icon name="pencil-simple" />
													<Trans>Edit note…</Trans>
												</DropdownMenuItem>
											)}
											<DropdownMenuItem
												onClick={() =>
													setEditing({
														entry,
														field: "date",
														date: entry.type === "stage" && entry.dateUnknown ? "" : dateInputValue(entry.at),
														text: entry.type === "note" ? entry.text : "",
													})
												}
											>
												<Icon name="calendar-blank" />
												<Trans>Edit date…</Trans>
											</DropdownMenuItem>
										</>
									)}
									<DropdownMenuSeparator />
									<DropdownMenuItem
										variant="destructive"
										disabled={entry.id === anchorId}
										onClick={async () => {
											// An interview is named, and leaving the calendar too.
											const interview = entry.type === "interview" ? entry : null;
											const kind = interview ? interviewTypeLabel(interview.kind) : "";
											const date = interview ? day(new Date(interview.at)) : "";
											const generation = getAccountGeneration();
											const confirmed = await confirm(
												interview ? t`Delete the ${kind} interview on ${date}?` : t`Delete this entry?`,
												{
													description: interview
														? t`It's removed from this application. Download a cancellation afterward to update your calendar.`
														: t`It's removed from the timeline for good.`,
													confirmText: interview ? t`Delete interview` : t`Delete entry`,
												},
											);
											if (confirmed && generation === getAccountGeneration())
												deleteEntry.mutate(
													{ id: application.id, entryId: entry.id },
													{
														onSuccess: () => {
															if (interview) showInterviewCancellation(application, interview, generation);
														},
													},
												);
										}}
									>
										<Icon name="trash" />
										<Trans>Delete…</Trans>
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</li>
					);
				})}
			</ol>

			<Dialog
				open={editing !== null}
				onOpenChange={(open) => !open && setEditing(null)}
				onOpenChangeComplete={onEditOpenChangeComplete}
			>
				<DialogContent closeLabel={t`Close`} className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>
							{shownEdit?.field === "note" ? <Trans>Edit note</Trans> : <Trans>Edit date</Trans>}
						</DialogTitle>
						<DialogDescription className="sr-only">
							<Trans>Change this timeline entry.</Trans>
						</DialogDescription>
					</DialogHeader>
					{shownEdit && (
						<form
							id="timeline-entry-form"
							className="grid gap-3"
							onSubmit={(event) => {
								event.preventDefault();
								if (!editing) return;
								updateEntry.mutate({
									id: application.id,
									entryId: editing.entry.id,
									date: editing.date,
									...(editing.field === "note" && editing.text.trim() ? { text: editing.text.trim() } : {}),
								});
							}}
						>
							{shownEdit.field === "note" && (
								<Textarea
									aria-label={t`Note`}
									rows={3}
									value={shownEdit.text}
									onChange={(event) => {
										const text = event.target.value;
										setEditing((current) => current && { ...current, text });
									}}
								/>
							)}
							{shownEdit.field === "date" && (
								<Input
									type="date"
									aria-label={t`Date`}
									value={shownEdit.date}
									onChange={(event) => {
										const date = event.target.value;
										setEditing((current) => current && { ...current, date });
									}}
								/>
							)}
						</form>
					)}
					<DialogFooter>
						<Button variant="secondary" onClick={() => setEditing(null)}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" form="timeline-entry-form" disabled={!shownEdit?.date || updateEntry.isPending}>
							<Trans>Save</Trans>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</section>
	);
}
