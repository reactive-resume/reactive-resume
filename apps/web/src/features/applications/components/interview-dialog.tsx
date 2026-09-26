import type { InterviewKind, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import type { Application } from "../types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { INTERVIEW_KINDS } from "@reactive-resume/schema/applications/data";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { Combobox } from "@/components/ui/combobox";
import { useConfirm } from "@/hooks/use-confirm";
import { orpc } from "@/libs/orpc/client";
import { formatDuration, fromDateTimeLocal, toDateTimeLocal } from "../interviews";
import { applicationsListQueryKey } from "../queries";

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240];

type Draft = {
	applicationId: string;
	kind: InterviewKind;
	at: string;
	durationMinutes: number;
	location: string;
	notes: string;
};

// New interviews default to the given day (or tomorrow) at 9:00, or the next full hour if that day is today.
const defaultAt = (day?: Date | null) => {
	const now = new Date();
	const at = day ? new Date(day) : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
	at.setHours(9, 0, 0, 0);
	if (at.getTime() <= now.getTime()) at.setHours(now.getHours() + 1, 0, 0, 0);
	return toDateTimeLocal(at);
};

const emptyDraft = (applicationId: string, day?: Date | null): Draft => ({
	applicationId,
	kind: "screening",
	at: defaultAt(day),
	durationMinutes: 60,
	location: "",
	notes: "",
});

const draftFrom = (applicationId: string, interview: InterviewTimelineEntry): Draft => ({
	applicationId,
	kind: interview.kind,
	at: toDateTimeLocal(interview.at),
	durationMinutes: interview.durationMinutes,
	location: interview.location,
	notes: interview.notes,
});

type InterviewDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	// The application the interview belongs to. When omitted, an application picker is shown
	// (used by the calendar, where no application is selected yet).
	application?: Application | null;
	// Applications offered by the picker when `application` is omitted.
	applications?: Application[];
	// Set when editing an existing interview.
	interview?: InterviewTimelineEntry | null;
	// Pre-selects this day when scheduling (e.g. a day clicked on the calendar).
	day?: Date | null;
};

export function InterviewDialog({
	open,
	onOpenChange,
	application,
	applications = [],
	interview,
	day,
}: InterviewDialogProps) {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const [draft, setDraft] = useState<Draft>(() => emptyDraft(application?.id ?? ""));
	const isEditing = !!interview;

	useEffect(() => {
		if (!open) return;
		const applicationId = application?.id ?? "";
		setDraft(interview ? draftFrom(applicationId, interview) : emptyDraft(applicationId, day));
	}, [open, interview, application?.id, day]);

	const onSuccess = (_data: unknown, variables: { id: string }) => {
		void queryClient.invalidateQueries({ queryKey: applicationsListQueryKey() });
		void queryClient.invalidateQueries({
			queryKey: orpc.applications.getById.queryKey({ input: { id: variables.id } }),
		});
		onOpenChange(false);
	};

	const add = useMutation(
		orpc.applications.addInterview.mutationOptions({
			onSuccess: (data, variables) => {
				onSuccess(data, variables);
				toast.add({ type: "success", description: t`Interview scheduled.` });
			},
			onError: () => toast.add({ type: "error", description: t`Couldn't schedule the interview.` }),
		}),
	);

	const update = useMutation(
		orpc.applications.updateInterview.mutationOptions({
			onSuccess,
			onError: () => toast.add({ type: "error", description: t`Couldn't update the interview.` }),
		}),
	);

	const remove = useMutation(
		orpc.applications.deleteTimelineEntry.mutationOptions({
			onSuccess,
			onError: () => toast.add({ type: "error", description: t`Couldn't delete the interview.` }),
		}),
	);

	const pending = add.isPending || update.isPending || remove.isPending;
	const at = fromDateTimeLocal(draft.at);
	const canSave = !!at && !!draft.applicationId && !pending;
	const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

	const save = () => {
		if (!at || !canSave) return;
		const details = {
			kind: draft.kind,
			at,
			durationMinutes: draft.durationMinutes,
			location: draft.location.trim(),
			notes: draft.notes.trim(),
		};
		if (interview) update.mutate({ id: draft.applicationId, entryId: interview.id, ...details });
		else add.mutate({ id: draft.applicationId, ...details });
	};

	const durations = DURATION_OPTIONS.includes(draft.durationMinutes)
		? DURATION_OPTIONS
		: [...DURATION_OPTIONS, draft.durationMinutes].sort((a, b) => a - b);

	const pickable = applications.filter((item) => !item.archived);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{isEditing ? <Trans>Edit interview</Trans> : <Trans>Schedule an interview</Trans>}</DialogTitle>
					<DialogDescription>
						{application ? (
							<>
								{application.role} · {application.company}
							</>
						) : (
							<Trans>It will show on the application's timeline and on the calendar.</Trans>
						)}
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4">
					{!application && (
						<Field label={t`Application`} required>
							<Combobox
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

					<Field label={t`Interview type`}>
						<div className="flex flex-wrap gap-1.5">
							{INTERVIEW_KINDS.map((kind) => {
								const selected = draft.kind === kind.value;
								return (
									<button
										key={kind.value}
										type="button"
										aria-pressed={selected}
										className={cn(
											"flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors",
											selected
												? "border-foreground bg-foreground text-background"
												: "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
										)}
										onClick={() => set("kind", kind.value)}
									>
										<span className="size-2 rounded-full" style={{ background: kind.color }} />
										{kind.label}
									</button>
								);
							})}
						</div>
					</Field>

					<div className="grid grid-cols-[1fr_auto] gap-3">
						<Field label={t`Date & time`} required>
							<Input
								type="datetime-local"
								value={draft.at}
								onInput={(event) => set("at", event.currentTarget.value)}
								onChange={(event) => set("at", event.target.value)}
							/>
						</Field>
						<Field label={t`Duration`}>
							<Combobox
								className="w-32"
								value={draft.durationMinutes}
								options={durations.map((minutes) => ({ value: minutes, label: formatDuration(minutes) }))}
								onValueChange={(value) => value && set("durationMinutes", value)}
							/>
						</Field>
					</div>

					<Field label={t`Where`}>
						<Input
							value={draft.location}
							placeholder={t`Video link, office address, or phone number`}
							onChange={(event) => set("location", event.target.value)}
						/>
					</Field>

					<Field label={t`Notes`}>
						<Textarea
							rows={3}
							value={draft.notes}
							placeholder={t`Who you're meeting, what to prepare…`}
							onChange={(event) => set("notes", event.target.value)}
						/>
					</Field>
				</div>

				<DialogFooter className="sm:justify-between">
					{interview ? (
						<Button
							type="button"
							variant="ghost"
							className="text-destructive"
							disabled={pending}
							onClick={async () => {
								const confirmed = await confirm(t`Delete this interview?`, {
									description: t`It will be removed from the timeline and calendar. This can't be undone.`,
									confirmText: t`Delete`,
								});
								if (confirmed) remove.mutate({ id: draft.applicationId, entryId: interview.id });
							}}
						>
							<TrashIcon />
							<Trans>Delete</Trans>
						</Button>
					) : (
						<span />
					)}
					<div className="flex gap-2">
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="button" disabled={!canSave} onClick={save}>
							{isEditing ? <Trans>Save changes</Trans> : <Trans>Schedule</Trans>}
						</Button>
					</div>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

type FieldProps = { label: string; required?: boolean; children: React.ReactNode };

function Field({ label, required, children }: FieldProps) {
	return (
		<div className="grid gap-1.5">
			<Label className="text-muted-foreground text-xs">
				{label}
				{required && <span className="text-destructive"> *</span>}
			</Label>
			{children}
		</div>
	);
}
