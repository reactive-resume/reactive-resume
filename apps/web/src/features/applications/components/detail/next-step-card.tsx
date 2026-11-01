import type { Application } from "../../types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useId, useState } from "react";
import { followUpInstant, isDateOnlyFollowUp } from "@reactive-resume/schema/applications/follow-up";
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
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { cn } from "@reactive-resume/utils/style";
import { fromZonedDateTime } from "@reactive-resume/utils/timezone";
import { buildIcs } from "../../ics";
import { dayKey } from "../../interviews";
import { describeNextStep, getNextStep } from "../../next-step";
import { useInvalidateApplications } from "../../use-application-actions";
import { useCareerTime } from "@/features/career/shared";
import { orpc } from "@/libs/orpc/client";

type NextStepCardProps = {
	application: Application;
	onScheduleInterview: (interview: InterviewTimelineEntry | null) => void;
};

/**
 * NEXT STEP: what the application needs, with Edit (schedule an interview or set the follow-up). Dated steps can go
 * to a calendar as an .ics file. Overdue steps are in warn.
 */
export function NextStepCard({ application, onScheduleInterview }: NextStepCardProps) {
	const { locale, timeZone } = useCareerTime();
	const [followUpOpen, setFollowUpOpen] = useState(false);
	const step = getNextStep(application, undefined, timeZone);
	const text = describeNextStep(step, application, locale, timeZone);

	const addToCalendar = () => {
		if (step.kind !== "interview" && step.kind !== "follow-up") return;
		const start = step.kind === "follow-up" ? (followUpInstant(application, timeZone) ?? step.at) : step.at;
		const minutes = step.kind === "interview" ? step.interview.durationMinutes : 30;
		const ics = buildIcs({
			uid: step.kind === "interview" ? step.interview.id : `follow-up-${application.id}`,
			title: `${text.title} · ${application.role}, ${application.company}`,
			start,
			end: new Date(start.getTime() + minutes * 60_000),
			...(step.kind === "interview" && step.interview.location ? { location: step.interview.location } : {}),
			...(step.kind === "interview" && step.interview.notes ? { description: step.interview.notes } : {}),
		});
		const blob = new Blob([ics], { type: "text/calendar" });
		const date = dayKey(start, timeZone);
		downloadWithAnchor(blob, `${application.company}-${date}.ics`.replace(/[^\w.-]+/g, "-"));
	};

	return (
		<section aria-labelledby="application-next-step" className="grid gap-2">
			<h3 id="application-next-step" className="text-xs font-semibold text-ink-3">
				<Trans>Next step</Trans>
			</h3>
			<div
				className={cn(
					"grid gap-2 rounded-xl border p-3",
					text.tone === "warn" ? "border-warn bg-warn-soft" : "border-line",
				)}
			>
				<div className="flex items-start gap-2.5">
					<Icon
						name={text.icon}
						className={cn("mt-0.5 shrink-0", text.tone === "warn" ? "text-warn-text" : "text-ink-2")}
					/>
					<div className="grid min-w-0 flex-1">
						<strong className="text-sm font-semibold">{text.title}</strong>
						{text.sub && <span className="text-xs leading-[17px] text-ink-2">{text.sub}</span>}
					</div>
					{step.kind !== "closed" && (
						<DropdownMenu>
							<DropdownMenuTrigger render={<Button size="sm" variant="secondary" />}>
								<Trans>Edit</Trans>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{step.kind === "interview" && (
									<DropdownMenuItem onClick={() => onScheduleInterview(step.interview)}>
										<Trans>Edit this interview…</Trans>
									</DropdownMenuItem>
								)}
								<DropdownMenuItem onClick={() => onScheduleInterview(null)}>
									<Trans>Schedule an interview…</Trans>
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => setFollowUpOpen(true)}>
									{application.followUpAt ? <Trans>Change the follow-up…</Trans> : <Trans>Set a follow-up…</Trans>}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
				{(step.kind === "interview" || step.kind === "follow-up") && (
					<Button size="sm" variant="ghost" className="ms-7 w-fit" onClick={addToCalendar}>
						<Icon name="calendar-dots" size={16} />
						<Trans>Add to calendar</Trans>
					</Button>
				)}
			</div>

			<FollowUpDialog application={application} open={followUpOpen} onOpenChange={setFollowUpOpen} />
		</section>
	);
}

type FollowUpDialogProps = { application: Application; open: boolean; onOpenChange: (open: boolean) => void };

/** The follow-up: a date and a note, or cleared. */
function FollowUpDialog({ application, open, onOpenChange }: FollowUpDialogProps) {
	const id = useId();
	const { timeZone } = useCareerTime();
	const invalidate = useInvalidateApplications();
	const [date, setDate] = useState("");
	const [time, setTime] = useState("09:00");
	const [note, setNote] = useState("");
	const [wasOpen, setWasOpen] = useState(false);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (open) {
			setDate(
				application.followUpAt
					? dayKey(followUpInstant(application, timeZone) ?? new Date(application.followUpAt), timeZone)
					: "",
			);
			const existing = followUpInstant(application, timeZone);
			setTime(
				existing
					? new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
							existing,
						)
					: "09:00",
			);
			setNote(application.followUpNote ?? "");
		}
	}
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => {
			invalidate(application.id);
			onOpenChange(false);
		},
		onError: () => toast.add({ type: "error", description: t`Couldn't save the follow-up. Try again.` }),
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>
						<Trans>Follow-up</Trans>
					</DialogTitle>
					<DialogDescription>
						<Trans>A reminder to check in, shown as the next step until you do.</Trans>
					</DialogDescription>
				</DialogHeader>
				<form
					id={`${id}-form`}
					className="grid gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						const existing = followUpInstant(application, timeZone);
						const originalTime = existing
							? new Intl.DateTimeFormat("en-GB", {
									timeZone,
									hour: "2-digit",
									minute: "2-digit",
									hourCycle: "h23",
								}).format(existing)
							: "09:00";
						const unchanged = !!existing && date === dayKey(existing, timeZone) && time === originalTime;

						const at =
							unchanged && application.followUpAt
								? new Date(application.followUpAt)
								: fromZonedDateTime(date, time, timeZone);
						if (!at) {
							toast.add({
								type: "error",
								description: t`This date or time does not exist in your timezone. Choose another time.`,
							});
							return;
						}
						update.mutate({
							id: application.id,
							followUpAt: at,
							followUpDateOnly: unchanged && isDateOnlyFollowUp(application),
							followUpNote: note.trim() || null,
						});
					}}
				>
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-date`}>
							<Trans>Date</Trans>
						</Label>
						<Input id={`${id}-date`} type="date" value={date} onChange={(event) => setDate(event.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-time`}>
							<Trans>Time</Trans>
						</Label>
						<Input id={`${id}-time`} type="time" value={time} onChange={(event) => setTime(event.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor={`${id}-note`}>
							<Trans>What to do</Trans>
						</Label>
						<Input
							id={`${id}-note`}
							value={note}
							placeholder={t`Email the recruiter`}
							onChange={(event) => setNote(event.target.value)}
						/>
					</div>
				</form>
				<DialogFooter>
					{application.followUpAt && (
						<Button
							variant="ghost"
							className="me-auto"
							onClick={() => update.mutate({ id: application.id, followUpAt: null, followUpNote: null })}
						>
							<Trans>Clear</Trans>
						</Button>
					)}
					<Button type="submit" form={`${id}-form`} disabled={!date || update.isPending}>
						<Trans>Save</Trans>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
