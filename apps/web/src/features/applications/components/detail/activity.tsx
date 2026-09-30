import type { Application } from "../../types";
import type { ApplicationTimelineEntry, InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
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
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { toast } from "@reactive-resume/ui/components/toast";
import { interviewKindOf } from "../../interviews";
import { getStageColor, getStageLabel } from "../../stages";
import { useInvalidateApplications } from "../../use-application-actions";
import { useClosingValue } from "@/hooks/use-closing-value";
import { useConfirm } from "@/hooks/use-confirm";
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
};

/**
 * The timeline: stage changes, notes and interviews, newest first, with a note field on top. Each row's ⋯ edits its
 * date (and a note's text) or deletes it; the entry that anchors the current stage can't be deleted.
 */
export function Activity({ application, onOpenInterview }: ActivityProps) {
	const { i18n } = useLingui();
	const invalidate = useInvalidateApplications();
	const confirm = useConfirm();
	const [note, setNote] = useState("");
	const [editing, setEditing] = useState<{ entry: ApplicationTimelineEntry; date: string; text: string } | null>(null);
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
	const anchorId = sorted.find((entry) => entry.type === "stage" && entry.stage === application.status)?.id;
	const formatDate = (value: Date | string, withTime: boolean) =>
		new Date(value).toLocaleDateString(i18n.locale, {
			month: "short",
			day: "numeric",
			// Stage and note entries are whole days, stored at noon UTC.
			...(withTime ? { hour: "2-digit", minute: "2-digit" } : { timeZone: "UTC" }),
		});

	const describe = (entry: ApplicationTimelineEntry) => {
		if (entry.type === "stage")
			return { dot: getStageColor(entry.stage), text: t`Moved to ${getStageLabel(entry.stage)}` };
		if (entry.type === "note") return { dot: "var(--ink-3)", text: entry.text };
		const kind = interviewKindOf(entry.kind);
		return { dot: kind?.color ?? "var(--ink-3)", text: t`${kind?.label ?? entry.kind} interview` };
	};

	const submit = () => {
		const text = note.trim();
		if (!text || addNote.isPending) return;
		addNote.mutate({ id: application.id, text }, { onSuccess: () => setNote("") });
	};

	return (
		<section aria-labelledby="application-activity" className="grid gap-2">
			<h3 id="application-activity" className="text-xs font-semibold text-ink-3 uppercase">
				<Trans>Activity</Trans>
			</h3>
			<form
				className="flex gap-1.5"
				onSubmit={(event) => {
					event.preventDefault();
					submit();
				}}
			>
				<Input
					aria-label={t`Add a note`}
					placeholder={t`Add a note…`}
					value={note}
					disabled={addNote.isPending}
					onChange={(event) => setNote(event.target.value)}
				/>
				<Button type="submit" variant="secondary" disabled={!note.trim() || addNote.isPending}>
					<Trans>Add</Trans>
				</Button>
			</form>

			<ol className="grid">
				{sorted.map((entry) => {
					const { dot, text } = describe(entry);
					return (
						<li key={entry.id} className="group flex items-start gap-2.5 py-1.5 text-sm">
							<span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: dot }} />
							{entry.type === "interview" ? (
								<button
									type="button"
									onClick={() => onOpenInterview(entry)}
									className="min-w-0 flex-1 text-start hover:underline"
								>
									{text}
									{entry.location ? <span className="text-ink-3"> · {entry.location}</span> : null}
								</button>
							) : (
								<span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{text}</span>
							)}
							<span className="shrink-0 text-xs leading-5 text-ink-3">
								{formatDate(entry.at, entry.type === "interview")}
							</span>
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											size="icon-xs"
											variant="ghost"
											aria-label={t`Options for this entry`}
											className="-my-1 text-ink-3 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
										/>
									}
								>
									<Icon name="more_horiz" size={16} />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									{entry.type === "interview" ? (
										<DropdownMenuItem onClick={() => onOpenInterview(entry)}>
											<Trans>Edit interview…</Trans>
										</DropdownMenuItem>
									) : (
										<DropdownMenuItem
											onClick={() =>
												setEditing({
													entry,
													date: dateInputValue(entry.at),
													text: entry.type === "note" ? entry.text : "",
												})
											}
										>
											<Trans>Edit…</Trans>
										</DropdownMenuItem>
									)}
									<DropdownMenuItem
										variant="destructive"
										disabled={entry.id === anchorId}
										onClick={async () => {
											const confirmed = await confirm(t`Delete this entry?`, {
												description: t`It's removed from the timeline for good.`,
												confirmText: t`Delete`,
											});
											if (confirmed) deleteEntry.mutate({ id: application.id, entryId: entry.id });
										}}
									>
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
				<DialogContent className="sm:max-w-sm">
					<DialogHeader>
						<DialogTitle>
							{shownEdit?.entry.type === "note" ? <Trans>Edit note</Trans> : <Trans>Edit date</Trans>}
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
									...(editing.entry.type === "note" && editing.text.trim() ? { text: editing.text.trim() } : {}),
								});
							}}
						>
							{shownEdit.entry.type === "note" && (
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
							<Input
								type="date"
								aria-label={t`Date`}
								value={shownEdit.date}
								onChange={(event) => {
									const date = event.target.value;
									setEditing((current) => current && { ...current, date });
								}}
							/>
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
