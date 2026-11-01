import type { ApplicationLane } from "../lanes";
import type { Application, ApplicationSummary } from "../types";
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
import { getCategoryLane, getDisplayLane, getLaneLabel, getNextLane, getStageDisplay, laneMoveInput } from "../lanes";
import { daysInLane } from "../next-step";
import { applicationDetailQueryOptions, getInitialApplicationDetail } from "../queries";
import { getClosedReasonLabel } from "../stages";
import { useApplicationActions, useInvalidateApplications } from "../use-application-actions";
import { useApplicationLanes } from "../use-application-lanes";
import { ApplicationNotes } from "./application-notes";
import { Activity } from "./detail/activity";
import { CloseDialog } from "./detail/close-dialog";
import { Contacts } from "./detail/contacts";
import { NextStepCard } from "./detail/next-step-card";
import { SentDocuments } from "./detail/sent-documents";
import { InterviewDialog } from "./interview-dialog";
import { PriorNoResponseNotice } from "./prior-no-response-notice";
import { useClosingValue } from "@/hooks/use-closing-value";
import { useConfirm } from "@/hooks/use-confirm";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { isImeComposing } from "@/libs/keyboard";
import { orpc } from "@/libs/orpc/client";

type DetailSheetProps = {
	application: ApplicationSummary | null;
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
	const initialDetail = getInitialApplicationDetail(shown);
	const { data, isError, isFetching, isPending, refetch } = useQuery({
		...applicationDetailQueryOptions(shown?.id ?? ""),
		// Fetch only while open; while closing, the cached copy keeps showing.
		enabled: Boolean(application),
		initialData: initialDetail,
		initialDataUpdatedAt: 0,
	});
	const current = data;

	return (
		<Sheet open={Boolean(application)} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
			<SheetContent
				side={phone ? "bottom" : "right"}
				closeLabel={t`Close`}
				className={cn("gap-0", phone ? "h-svh" : "data-[side=right]:sm:max-w-[480px]")}
			>
				{current ? (
					<Detail
						key={current.id}
						application={current}
						onEditDetails={onEditDetails}
						onDeleted={() => onOpenChange(false)}
					/>
				) : (
					<div className="grid gap-2 p-5">
						<SheetTitle>{shown?.role}</SheetTitle>
						<SheetDescription aria-live="polite">
							{isError ? t`Couldn't load this. Your saved data hasn't changed.` : t`Loading…`}
						</SheetDescription>
						{isError && (
							<Button variant="secondary" disabled={isFetching || isPending} onClick={() => void refetch()}>
								<Trans>Try again</Trans>
							</Button>
						)}
					</div>
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
	const { lanes, active } = useApplicationLanes();
	const [interview, setInterview] = useState<{ open: boolean; entry: InterviewTimelineEntry | null }>({
		open: false,
		entry: null,
	});
	const [closing, setClosing] = useState(false);
	const [postingOpen, setPostingOpen] = useState(false);
	const [applying, setApplying] = useState<ApplicationLane | null>(null);

	const current = getDisplayLane(lanes, application);
	const steps = active.filter((lane) => lane.category !== "closed");
	const next = getNextLane(lanes, current);
	const stage = getStageDisplay(lanes, application);
	const closed = application.status === "closed";
	// An accepted offer keeps its pipeline filled through Offer: it was won, not lost.
	const reached = stage.accepted
		? steps.findLastIndex((lane) => lane.category === "offer")
		: steps.findIndex((lane) => lane.id === current.id);
	const since = daysInLane(application);
	// Leaving Saved for Applied records the submission first.
	const goTo = (lane: ApplicationLane) => {
		if (lane.id === current.id) return;
		if (application.status === "saved" && lane.category === "applied") setApplying(lane);
		else moveTo(application, lane);
	};

	const onDelete = async () => {
		const confirmed = await confirm(t`Delete this application?`, {
			description: t`“${application.role} · ${application.company}” and its timeline are deleted permanently. This can't be undone.`,
			confirmText: t`Delete application`,
		});
		if (!confirmed) return;
		remove.mutate({ id: application.id }, { onSuccess: onDeleted });
	};

	return (
		<>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<header className="grid gap-4 border-b border-line px-5 pt-5 pb-4">
					<div className="flex items-start gap-3 pe-8">
						<span
							aria-hidden="true"
							className="grid size-10 shrink-0 place-items-center rounded-lg bg-sunken font-semibold text-ink-2"
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
								<Icon name="dots-three" />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onClick={() => onEditDetails(application)}>
									<Icon name="pencil-simple" size={18} />
									<Trans>Edit details…</Trans>
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem variant="destructive" onClick={onDelete}>
									<Icon name="trash" size={18} />
									<Trans>Delete…</Trans>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>

					<div className="grid gap-2.5">
						{/* Equal columns while they fit (five by default); more lanes scroll sideways. */}
						<ol
							aria-label={t`Stages`}
							className="-mx-1 grid auto-cols-[minmax(64px,1fr)] grid-flow-col gap-1.5 overflow-x-auto px-1 pb-1"
						>
							{steps.map((lane, index) => {
								const label = getLaneLabel(lane);
								return (
									<li key={lane.id} className="min-w-0">
										<button
											type="button"
											title={label}
											aria-current={lane.id === current.id ? "step" : undefined}
											onClick={() => goTo(lane)}
											className="grid w-full gap-1.5 text-start"
										>
											<span
												className="h-1.5 rounded-sm transition-colors duration-standard"
												style={{
													background: (!closed || stage.accepted) && index <= reached ? lane.color : "var(--line)",
												}}
											/>
											<span
												className={cn(
													"truncate text-[11px]",
													lane.id === current.id ? "font-semibold text-ink" : "text-ink-3",
												)}
											>
												{label}
											</span>
										</button>
									</li>
								);
							})}
						</ol>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span className="flex min-w-0 items-center gap-1.5 text-sm">
								<span aria-hidden="true" className="size-2 shrink-0 rounded-sm" style={{ background: stage.color }} />
								{stage.accepted && <Icon name="check" size={16} className="shrink-0 text-accent-text" />}
								<strong className="truncate font-semibold">{stage.label}</strong>
								<span className="shrink-0 text-ink-3">
									{stage.accepted ? null : closed && application.closedReason ? (
										<>· {getClosedReasonLabel(application.closedReason)}</>
									) : (
										<>
											· <Plural value={since} _0="since today" one="for # day" other="for # days" />
										</>
									)}
								</span>
							</span>
							{next && !closed && (
								<Button size="sm" variant="secondary" onClick={() => goTo(next)}>
									{application.status === "saved" && next.category === "applied" ? (
										<Trans>Mark as applied</Trans>
									) : (
										<Trans>Move to {getLaneLabel(next)}</Trans>
									)}
									<Icon name="arrow-right" size={16} />
								</Button>
							)}
						</div>
					</div>
				</header>

				<div className="grid gap-6 p-5">
					<NextStepCard
						application={application}
						onScheduleInterview={(entry) => setInterview({ open: true, entry })}
					/>
					<SentDocuments application={application} disabled={remove.isPending} />
					<Facts application={application} locale={i18n.locale} />
					<Tags application={application} />
					<ApplicationNotes application={application} />
					<Activity application={application} onOpenInterview={(entry) => setInterview({ open: true, entry })} />
				</div>
			</div>

			<footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-5 py-3">
				{!closed ? (
					<>
						<Button variant="secondary" onClick={() => setClosing(true)}>
							<Trans>Mark as closed…</Trans>
						</Button>
						{application.sourceUrl && (
							<Button
								variant="ghost"
								nativeButton={false}
								className="text-ink-2"
								render={<a href={application.sourceUrl} target="_blank" rel="noreferrer" />}
							>
								<Trans>Posting</Trans>
								<Icon name="arrow-square-out" size={16} />
							</Button>
						)}
						<OpenWorkspaceButton application={application} />
					</>
				) : (
					<Button variant="secondary" onClick={() => moveTo(application, getCategoryLane(lanes, "applied"))}>
						<Trans>Reopen</Trans>
					</Button>
				)}
			</footer>

			<CloseDialog
				open={closing}
				status={application.status}
				onOpenChange={setClosing}
				lanes={active}
				onClose={(lane, reason) => (lane ? moveTo(application, lane, reason) : reason && close(application, reason))}
			/>
			<InterviewDialog
				application={application}
				interview={interview.entry}
				open={interview.open}
				onOpenChange={(open) => setInterview((currentValue) => ({ ...currentValue, open }))}
			/>
			<PostingDialog application={application} open={postingOpen} onOpenChange={setPostingOpen} />
			{applying && <MarkAppliedDialog application={application} lane={applying} onClose={() => setApplying(null)} />}
		</>
	);
}

/** Salary, Source, Applied and Contact. Salary and source edit in place. */
function Facts({ application, locale }: { application: Application; locale: string }) {
	const invalidate = useInvalidateApplications();
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: () => toast.add({ type: "error", description: t`Couldn't save the change. Try again.` }),
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
				<dt className="text-xs font-semibold text-ink-3">
					<Trans>Applied</Trans>
				</dt>
				<dd className="text-sm font-medium">{application.status === "saved" ? "—" : applied}</dd>
			</div>
			<div className="grid gap-0.5">
				<dt className="text-xs font-semibold text-ink-3">
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
			<dt className="text-xs font-semibold text-ink-3">
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
		onError: () => toast.add({ type: "error", description: t`Couldn't save the tags. Try again.` }),
	});
	const save = (tags: string[]) => update.mutate({ id: application.id, tags });

	return (
		<section aria-labelledby="application-tags" className="grid gap-2">
			<h3 id="application-tags" className="text-xs font-semibold text-ink-3">
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
							<Icon name="x" size={14} />
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

type MarkAppliedDialogProps = { application: Application; lane: ApplicationLane; onClose: () => void };

function MarkAppliedDialog({ application, lane, onClose }: MarkAppliedDialogProps) {
	const id = useId();
	const invalidate = useInvalidateApplications();
	const { mode } = useApplicationLanes();
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
							...laneMoveInput(lane, mode),
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
					<PriorNoResponseNotice company={application.company} excludeId={application.id} />
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
						<h3 id="posting-requirements" className="text-xs font-semibold text-ink-3">
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

/** Opens the application's workspace on the tab for its stage. */
function OpenWorkspaceButton({ application }: { application: Application }) {
	const navigate = useNavigate();
	return (
		<Button
			className="ms-auto bg-accent-soft text-accent-text hover:bg-accent-soft hover:brightness-95"
			onClick={() =>
				void navigate({
					to: "/dashboard/applications/$applicationId/{-$tab}",
					params: { applicationId: application.id },
				})
			}
		>
			<Icon name="arrow-right" size={18} />
			<Trans>Open workspace</Trans>
		</Button>
	);
}
