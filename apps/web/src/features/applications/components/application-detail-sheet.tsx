import type { Application } from "../types";
import type { InterviewTimelineEntry } from "@reactive-resume/schema/applications/data";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Plural, Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { daysInStage } from "../next-step";
import { getClosedReasonLabel, getNextStage, getStageColor, getStageLabel, PIPELINE } from "../stages";
import { useApplicationActions, useInvalidateApplications } from "../use-application-actions";
import { ApplicationNotes } from "./application-notes";
import { Activity } from "./detail/activity";
import { CloseDialog } from "./detail/close-dialog";
import { Contacts } from "./detail/contacts";
import { NextStepCard } from "./detail/next-step-card";
import { SentDocuments } from "./detail/sent-documents";
import { InterviewDialog } from "./interview-dialog";
import { useDialogStore } from "@/dialogs/store";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { useClosingValue } from "@/hooks/use-closing-value";
import { useConfirm } from "@/hooks/use-confirm";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { isImeComposing } from "@/libs/keyboard";
import { orpc } from "@/libs/orpc/client";

type DetailSheetProps = {
	application: Application | null;
	onOpenChange: (open: boolean) => void;
	onEditDetails: (application: Application) => void;
};

/**
 * One application, 480px from the right (full screen on phones): the stage stepper with Move to next, the next
 * step, what was sent, the key facts, notes and activity. Close application… takes a reason; Delete is in ⋯.
 */
export function ApplicationDetailSheet({ application, onOpenChange, onEditDetails }: DetailSheetProps) {
	const phone = useBreakpoint() === "mobile";
	// Closing keeps the last application on screen until the sheet has slid away.
	const [shown, onOpenChangeComplete] = useClosingValue(application);
	const { data } = useQuery({
		...orpc.applications.getById.queryOptions({ input: { id: shown?.id ?? "" } }),
		// Fetch only while open; while closing, the cached copy keeps showing.
		enabled: Boolean(application),
		...(shown ? { placeholderData: shown } : {}),
	});
	const current = data ?? shown;

	return (
		<Sheet open={Boolean(application)} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
			<SheetContent
				side={phone ? "bottom" : "right"}
				closeLabel={t`Close`}
				className={cn("gap-0 overflow-y-auto", phone ? "h-svh" : "data-[side=right]:sm:max-w-[480px]")}
			>
				{current && (
					<Detail
						key={current.id}
						application={current}
						onEditDetails={onEditDetails}
						onDeleted={() => onOpenChange(false)}
					/>
				)}
			</SheetContent>
		</Sheet>
	);
}

type DetailProps = {
	application: Application;
	onEditDetails: (application: Application) => void;
	onDeleted: () => void;
};

function Detail({ application, onEditDetails, onDeleted }: DetailProps) {
	const { i18n } = useLingui();
	const confirm = useConfirm();
	const { moveTo, close, remove } = useApplicationActions();
	const [interview, setInterview] = useState<{ open: boolean; entry: InterviewTimelineEntry | null }>({
		open: false,
		entry: null,
	});
	const [closing, setClosing] = useState(false);
	const [postingOpen, setPostingOpen] = useState(false);
	const [applying, setApplying] = useState(false);

	const next = getNextStage(application.status);
	const reached = PIPELINE.indexOf(application.status);
	const since = daysInStage(application);
	const closed = application.status === "closed";

	const onDelete = async () => {
		const confirmed = await confirm(t`Delete this application?`, {
			description: t`“${application.role} · ${application.company}” and its timeline are deleted permanently. This can't be undone.`,
			confirmText: t`Delete`,
		});
		if (!confirmed) return;
		remove.mutate({ id: application.id }, { onSuccess: onDeleted });
	};

	return (
		<>
			<header className="grid gap-4 border-b border-line px-5 pt-5 pb-4">
				<div className="flex items-start gap-3 pe-8">
					<span
						aria-hidden="true"
						className="grid size-10 shrink-0 place-items-center rounded-[9px] bg-sunken font-semibold text-ink-2"
					>
						{application.company.slice(0, 1).toUpperCase()}
					</span>
					<div className="grid min-w-0 flex-1 gap-0.5">
						<SheetTitle className="font-display text-[22px] leading-7 font-medium">{application.role}</SheetTitle>
						<SheetDescription className="flex flex-wrap items-center gap-x-1.5 text-sm text-ink-2">
							<span>{[application.company, application.location].filter(Boolean).join(" · ")}</span>
							{(application.sourceUrl || application.jobDescription) && (
								<>
									<span aria-hidden="true">·</span>
									{application.sourceUrl && !application.jobDescription ? (
										<a
											href={application.sourceUrl}
											target="_blank"
											rel="noreferrer"
											className="font-medium text-accent-text hover:underline"
										>
											<Trans>View posting</Trans>
										</a>
									) : (
										<button
											type="button"
											onClick={() => setPostingOpen(true)}
											className="font-medium text-accent-text hover:underline"
										>
											<Trans>View posting</Trans>
										</button>
									)}
								</>
							)}
						</SheetDescription>
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button size="icon-sm" variant="ghost" aria-label={t`Application options`} className="text-ink-3" />
							}
						>
							<Icon name="more_horiz" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => onEditDetails(application)}>
								<Icon name="edit" size={18} />
								<Trans>Edit details…</Trans>
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive" onClick={onDelete}>
								<Icon name="delete" size={18} />
								<Trans>Delete…</Trans>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<div className="grid gap-2.5">
					<ol aria-label={t`Stages`} className="grid grid-cols-5 gap-1.5">
						{PIPELINE.map((stage, index) => (
							<li key={stage}>
								<button
									type="button"
									aria-current={stage === application.status ? "step" : undefined}
									onClick={() => {
										if (stage === application.status) return;
										if (application.status === "saved" && stage === "applied") setApplying(true);
										else moveTo(application, stage);
									}}
									className="grid w-full gap-1.5 text-start"
								>
									<span
										className="h-1.5 rounded-full transition-colors duration-standard"
										style={{
											background: !closed && index <= reached ? getStageColor(stage) : "var(--line)",
										}}
									/>
									<span
										className={cn(
											"truncate text-[11px]",
											stage === application.status ? "font-semibold text-ink" : "text-ink-3",
										)}
									>
										{getStageLabel(stage)}
									</span>
								</button>
							</li>
						))}
					</ol>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<span className="flex items-center gap-1.5 text-sm">
							<span
								aria-hidden="true"
								className="size-2 rounded-full"
								style={{ background: getStageColor(application.status) }}
							/>
							<strong className="font-semibold">{getStageLabel(application.status)}</strong>
							<span className="text-ink-3">
								{closed && application.closedReason ? (
									<>· {getClosedReasonLabel(application.closedReason)}</>
								) : (
									<>
										· <Plural value={since} _0="since today" one="for # day" other="for # days" />
									</>
								)}
							</span>
						</span>
						{next && !closed && (
							<Button
								size="sm"
								variant="secondary"
								onClick={() => (application.status === "saved" ? setApplying(true) : moveTo(application, next))}
							>
								{application.status === "saved" ? (
									<Trans>Mark as applied</Trans>
								) : (
									<Trans>Move to {getStageLabel(next)}</Trans>
								)}
								<Icon name="arrow_forward" size={16} />
							</Button>
						)}
					</div>
				</div>
			</header>

			<div className="grid gap-6 p-5">
				<NextStepCard application={application} onScheduleInterview={(entry) => setInterview({ open: true, entry })} />
				<SentDocuments application={application} disabled={remove.isPending} />
				<Facts application={application} locale={i18n.locale} />
				<Tags application={application} />
				<ApplicationNotes application={application} />
				<Activity application={application} onOpenInterview={(entry) => setInterview({ open: true, entry })} />
			</div>

			<footer className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-line bg-surface px-5 py-3">
				{!closed ? (
					<>
						<Button variant="secondary" onClick={() => setClosing(true)}>
							<Trans>Close application…</Trans>
						</Button>
						<PrepareButton application={application} />
						{application.sourceUrl && (
							<a
								href={application.sourceUrl}
								target="_blank"
								rel="noreferrer"
								className="text-sm text-accent-text hover:underline"
							>
								<Trans>Open application</Trans>
							</a>
						)}
					</>
				) : (
					<Button variant="secondary" onClick={() => moveTo(application, "applied")}>
						<Trans>Reopen</Trans>
					</Button>
				)}
			</footer>

			<CloseDialog open={closing} onOpenChange={setClosing} onClose={(reason) => close(application, reason)} />
			<InterviewDialog
				application={application}
				interview={interview.entry}
				open={interview.open}
				onOpenChange={(open) => setInterview((currentValue) => ({ ...currentValue, open }))}
			/>
			<PostingDialog application={application} open={postingOpen} onOpenChange={setPostingOpen} />
			{applying && <MarkAppliedDialog application={application} onClose={() => setApplying(false)} />}
		</>
	);
}

/** Salary, Source, Applied and Contact. Salary and source edit in place. */
function Facts({ application, locale }: { application: Application; locale: string }) {
	const invalidate = useInvalidateApplications();
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: () => toast.add({ type: "error", description: t`Couldn't save.` }),
	});
	const applied = new Date(application.appliedAt).toLocaleDateString(locale, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});

	return (
		<dl className="grid grid-cols-2 gap-x-4 gap-y-3">
			<InlineFact
				label={t`Salary`}
				value={application.salary}
				onSave={(salary) => update.mutate({ id: application.id, salary })}
			/>
			<InlineFact
				label={t`Source`}
				value={application.source}
				onSave={(source) => update.mutate({ id: application.id, source })}
			/>
			<div className="grid gap-0.5">
				<dt className="text-xs font-semibold text-ink-3 uppercase">
					<Trans>Applied</Trans>
				</dt>
				<dd className="text-sm font-medium">{application.status === "saved" ? "—" : applied}</dd>
			</div>
			<div className="grid gap-0.5">
				<dt className="text-xs font-semibold text-ink-3 uppercase">
					<Trans>Contact</Trans>
				</dt>
				<dd className="min-w-0">
					<Contacts
						contacts={application.contacts}
						disabled={update.isPending}
						onChange={(contacts) => update.mutate({ id: application.id, contacts })}
					/>
				</dd>
			</div>
		</dl>
	);
}

type InlineFactProps = { label: string; value: string | null; onSave: (value: string | null) => void };

/** A fact that edits in place: click to type, Enter or leaving saves, Esc cancels. */
function InlineFact({ label, value, onSave }: InlineFactProps) {
	const id = useId();
	const [draft, setDraft] = useState<string | null>(null);

	const commit = () => {
		if (draft === null) return;
		const next = draft.trim() || null;
		if (next !== (value ?? null)) onSave(next);
		setDraft(null);
	};

	return (
		<div className="grid gap-0.5">
			<dt className="text-xs font-semibold text-ink-3 uppercase">
				<label htmlFor={id}>{label}</label>
			</dt>
			<dd>
				{draft === null ? (
					<button
						id={id}
						type="button"
						onClick={() => setDraft(value ?? "")}
						className="w-full truncate rounded-md text-start text-sm font-medium hover:bg-hover"
					>
						{value || "—"}
					</button>
				) : (
					<Input
						id={id}
						autoFocus
						value={draft}
						className="h-8"
						onChange={(event) => setDraft(event.target.value)}
						onBlur={commit}
						onKeyDown={(event) => {
							if (isImeComposing(event)) return;
							if (event.key === "Enter") commit();
							if (event.key === "Escape") {
								event.stopPropagation();
								setDraft(null);
							}
						}}
					/>
				)}
			</dd>
		</div>
	);
}

function Tags({ application }: { application: Application }) {
	const invalidate = useInvalidateApplications();
	const [tag, setTag] = useState("");
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: () => toast.add({ type: "error", description: t`Couldn't save the tags.` }),
	});
	const save = (tags: string[]) => update.mutate({ id: application.id, tags });

	return (
		<section aria-labelledby="application-tags" className="grid gap-2">
			<h3 id="application-tags" className="text-xs font-semibold text-ink-3 uppercase">
				<Trans>Tags</Trans>
			</h3>
			<div className="flex flex-wrap items-center gap-1.5">
				{application.tags.map((value) => (
					<span key={value} className="flex h-7 items-center gap-1 rounded-md bg-sunken ps-2 text-xs">
						{value}
						<button
							type="button"
							aria-label={t`Remove ${value}`}
							onClick={() => save(application.tags.filter((item) => item !== value))}
							className="grid size-6 place-items-center rounded text-ink-3 hover:text-ink"
						>
							<Icon name="close" size={14} />
						</button>
					</span>
				))}
				<form
					onSubmit={(event) => {
						event.preventDefault();
						const value = tag.trim();
						if (!value || application.tags.includes(value)) return setTag("");
						save([...application.tags, value]);
						setTag("");
					}}
				>
					<Input
						aria-label={t`Add a tag`}
						placeholder={t`Add a tag`}
						value={tag}
						className="h-7 w-28 text-xs"
						onChange={(event) => setTag(event.target.value)}
					/>
				</form>
			</div>
		</section>
	);
}

type PostingDialogProps = { application: Application; open: boolean; onOpenChange: (open: boolean) => void };

type MarkAppliedDialogProps = { application: Application; onClose: () => void };

function MarkAppliedDialog({ application, onClose }: MarkAppliedDialogProps) {
	const id = useId();
	const invalidate = useInvalidateApplications();
	const [date, setDate] = useState(() => new Date().toLocaleDateString("en-CA"));
	const [resumeId, setResumeId] = useState(application.resumeId ?? "");
	const [coverLetterId, setCoverLetterId] = useState(application.coverLetterId ?? "");
	const [resumeFileSent, setResumeFileSent] = useState(true);
	const [letterFileSent, setLetterFileSent] = useState(true);
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => {
			invalidate(application.id);
			onClose();
		},
	});
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						update.mutate({
							id: application.id,
							status: "applied",
							stageEnteredAt: date,
							resumeId: resumeId || null,
							coverLetterId: coverLetterId || null,
							...(!resumeFileSent ? { resumeFileUrl: null, resumeFileName: null } : {}),
							...(!letterFileSent ? { coverLetterUrl: null, coverLetterName: null } : {}),
						});
					}}
				>
					<DialogHeader>
						<DialogTitle>
							<Trans>Mark as applied</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>
								Confirm submission and choose the documents you actually sent. Their current versions will be saved.
							</Trans>
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-1.5">
						<label htmlFor={`${id}-date`}>
							<Trans>Application date</Trans>
						</label>
						<Input
							id={`${id}-date`}
							type="date"
							required
							value={date}
							onChange={(event) => setDate(event.target.value)}
						/>
					</div>
					<div className="grid gap-1.5">
						<label htmlFor={`${id}-resume`}>
							<Trans>Resume submitted (optional)</Trans>
						</label>
						<select
							id={`${id}-resume`}
							value={resumeId}
							onChange={(event) => setResumeId(event.target.value)}
							className="h-9 rounded-md border border-line bg-surface px-2 text-sm"
						>
							<option value="">{t`None`}</option>
							{documents
								?.filter((document) => document.type === "resume")
								.map((document) => (
									<option key={document.id} value={document.id}>
										{document.name}
									</option>
								))}
						</select>
					</div>
					<div className="grid gap-1.5">
						<label htmlFor={`${id}-letter`}>
							<Trans>Cover letter submitted (optional)</Trans>
						</label>
						<select
							id={`${id}-letter`}
							value={coverLetterId}
							onChange={(event) => setCoverLetterId(event.target.value)}
							className="h-9 rounded-md border border-line bg-surface px-2 text-sm"
						>
							<option value="">{t`None`}</option>
							{documents
								?.filter((document) => document.type === "letter")
								.map((document) => (
									<option key={document.id} value={document.id}>
										{document.name}
									</option>
								))}
						</select>
					</div>
					{application.resumeFileUrl && (
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={resumeFileSent}
								onChange={(event) => setResumeFileSent(event.target.checked)}
							/>
							<Trans>Submitted attached resume: {application.resumeFileName ?? "PDF"}</Trans>
						</label>
					)}
					{application.coverLetterUrl && (
						<label className="flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								checked={letterFileSent}
								onChange={(event) => setLetterFileSent(event.target.checked)}
							/>
							<Trans>Submitted attached cover letter: {application.coverLetterName ?? "PDF"}</Trans>
						</label>
					)}
					{update.error && (
						<p role="alert" className="text-sm text-danger-text">
							{getOrpcErrorMessage(update.error, { fallback: t`Couldn't record submission. Try again.` })}
						</p>
					)}
					<Button type="submit" disabled={!date || update.isPending}>
						<Trans>Confirm applied</Trans>
					</Button>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/** The saved posting: its link, what it asks for, and its text. */
function PostingDialog({ application, open, onOpenChange }: PostingDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>
						{application.role} · {application.company}
					</DialogTitle>
					<DialogDescription>
						{application.sourceUrl ? (
							<a
								href={application.sourceUrl}
								target="_blank"
								rel="noreferrer"
								className="text-accent-text hover:underline"
							>
								{application.sourceUrl}
							</a>
						) : (
							<Trans>The posting saved with this application.</Trans>
						)}
					</DialogDescription>
				</DialogHeader>
				{application.postingSource && (
					<p className="text-xs text-ink-3">
						{application.postingSource.method === "paste" ? (
							<Trans>Pasted description</Trans>
						) : (
							<Trans>
								Retrieved {application.postingSource.retrievedAt} using {application.postingSource.method}. Retrieval
								time does not establish origin freshness.
							</Trans>
						)}
					</p>
				)}
				{(application.postingSource?.truncated || application.postingSource?.completeness === "incomplete") && (
					<p className="text-xs text-warn-text" role="alert">
						<Trans>This saved description is clipped or incomplete. Review before preparing documents.</Trans>
					</p>
				)}
				{application.requirements.length > 0 && (
					<section aria-labelledby="posting-requirements" className="grid gap-2">
						<h3 id="posting-requirements" className="text-xs font-semibold text-ink-3 uppercase">
							<Trans>What it asks for</Trans>
						</h3>
						<ul className="flex flex-wrap gap-1.5">
							{application.requirements.map((requirement) => (
								<li key={requirement} className="rounded-md bg-sunken px-2 py-1 text-xs">
									{requirement}
								</li>
							))}
						</ul>
					</section>
				)}
				{application.jobDescription && (
					<p className="text-sm leading-6 whitespace-pre-wrap text-ink-2">{application.jobDescription}</p>
				)}
			</DialogContent>
		</Dialog>
	);
}

/**
 * Prepare for next step: the assistant on what was sent (the resume, or the letter), with the posting and the
 * application's notes, and suggestions for the fit, a follow-up and the interview.
 */
function PrepareButton({ application }: { application: Application }) {
	const navigate = useNavigate();
	const openDialog = useDialogStore((state) => state.openDialog);
	const { hasUsableProvider } = useHasUsableAiProvider();
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const target = application.resumeId
		? ({ kind: "resume", id: application.resumeId } as const)
		: application.coverLetterId
			? ({ kind: "letter", id: application.coverLetterId } as const)
			: null;

	return (
		<Button
			className="ms-auto bg-accent-soft text-accent-text hover:bg-accent-soft hover:brightness-95"
			onClick={() => {
				if (!target) return openDialog("document.new", { step: "copy", applicationId: application.id });
				if (
					application.status === "saved" &&
					target.kind === "resume" &&
					documents?.find((document) => document.type === "resume" && document.id === target.id)?.application?.id !==
						application.id
				)
					return openDialog("document.new", { step: "copy", applicationId: application.id, sourceResumeId: target.id });
				if (target?.kind === "resume")
					void navigate({
						to: "/builder/$resumeId",
						params: { resumeId: target.id },
						search: hasUsableProvider ? { assistant: "prepare", applicationId: application.id } : {},
					});
				else if (target)
					void navigate({
						to: "/builder/letter/$coverLetterId",
						params: { coverLetterId: target.id },
						search: hasUsableProvider ? { assistant: "prepare", applicationId: application.id } : {},
					});
			}}
		>
			<Icon name="description" size={18} />
			{application.status === "saved" ? <Trans>Prepare resume</Trans> : <Trans>Prepare for next step</Trans>}
		</Button>
	);
}
