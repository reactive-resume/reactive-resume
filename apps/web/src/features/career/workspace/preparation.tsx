import type { Application } from "@/features/applications/types";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { nextPreparationStep } from "@reactive-resume/schema/applications/preparation";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Label } from "@reactive-resume/ui/components/label";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { cn } from "@reactive-resume/utils/style";
import { useDefaultProvider, useWorkspace } from "../hooks";
import { Combobox } from "@/components/ui/combobox";
import { useDialogStore } from "@/dialogs/store";
import { useInvalidateApplications } from "@/features/applications/use-application-actions";
import { useDocumentDownload } from "@/features/applications/use-document-download";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

const STEPS = ["posting", "resume", "tailor", "letter", "answers", "review"] as const;

type PreparationProps = { application: Application; disabled: boolean };

/**
 * One application's preparation: the current step as the heading with its own action, then the posting and the two
 * selected documents as rows. It uses the existing document selection, editors and review checks and never submits.
 */
export function Preparation({ application, disabled }: PreparationProps) {
	const navigate = useNavigate();
	const openDialog = useDialogStore((state) => state.openDialog);
	const invalidate = useInvalidateApplications();
	const documents = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const connection = useDefaultProvider();
	const workspace = useWorkspace(application.id);
	const [posting, setPosting] = useState<string | null>(null);
	const [postingOpen, setPostingOpen] = useState(false);
	const { download, downloading } = useDocumentDownload();
	const id = useId();
	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: (error) => toastError(error, t`Couldn't save that change. Try again.`),
	});
	const createLetter = useMutation(orpc.coverLetters.create.mutationOptions());
	const next = nextPreparationStep(application, workspace.data, documents.data);
	const editing = application.status === "saved" && next !== "submitted";
	const busy = disabled || update.isPending || createLetter.isPending;
	const labels = {
		posting: t`Save the job posting`,
		resume: t`Choose a base resume`,
		tailor: t`Tailor and review your resume`,
		letter: t`Write a cover letter if required`,
		answers: t`Write and review form answers`,
		review: t`Review readiness and record your submission`,
		submitted: t`Submission recorded. Current drafts are separate from what you sent.`,
		closed: t`Application closed. Current drafts remain available.`,
	};
	const stepIndex = STEPS.indexOf(next as (typeof STEPS)[number]);
	const copyResume = () =>
		openDialog("document.new", {
			...(documents.data?.some((document) => document.type === "resume") ? { step: "copy" as const } : {}),
			applicationId: application.id,
			...(application.resumeId ? { sourceResumeId: application.resumeId } : {}),
		});
	const writeLetter = async () => {
		try {
			const letter = await createLetter.mutateAsync({
				name: t`Cover letter — ${application.company}`.slice(0, 100),
				applicationId: application.id,
				...(application.resumeId ? { resumeId: application.resumeId } : {}),
			});
			invalidate(application.id);
			void navigate({ to: "/builder/letter/$coverLetterId", params: { coverLetterId: letter.id } });
		} catch (error) {
			toastError(error, t`Couldn't create the letter. Try again.`);
		}
	};
	const savePosting = () =>
		update.mutate(
			{ id: application.id, jobDescription: posting?.trim() || null },
			{
				onSuccess: () => {
					setPosting(null);
					setPostingOpen(false);
				},
			},
		);

	// The step's own action sits beside the heading; at the review step the readiness card's button takes over.
	const action: ReactNode = !editing ? null : next === "resume" ? (
		<Button disabled={busy} onClick={copyResume}>
			<Trans>Copy a base resume for this job</Trans>
		</Button>
	) : next === "tailor" && application.resumeId ? (
		<Link
			to="/builder/$resumeId"
			params={{ resumeId: application.resumeId }}
			search={{ applicationId: application.id }}
			className={buttonVariants()}
		>
			<Trans>Tailor the resume</Trans>
		</Link>
	) : next === "letter" ? (
		<Button disabled={busy} onClick={() => void writeLetter()}>
			<Trans>Write a letter</Trans>
		</Button>
	) : next === "answers" ? (
		<a href="#application-answers" className={buttonVariants()}>
			<Trans>Go to form answers</Trans>
		</a>
	) : null;

	const postingEditorOpen = editing && (postingOpen || next === "posting");
	const postingText = application.jobDescription?.trim() ?? "";

	return (
		<section
			aria-label={t`Application preparation`}
			className="grid gap-4 rounded-xl border border-line bg-surface px-5 pt-5 pb-2"
		>
			<div className="grid gap-3">
				<div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3">
					<div className="grid min-w-0 gap-1">
						<h2 aria-live="polite" aria-atomic="true" className="text-lg leading-6 font-semibold text-balance">
							{editing ? labels[next] : <Trans>Current drafts</Trans>}
						</h2>
						<p className="text-[13px] leading-[18px] text-ink-2">
							{editing
								? connection.isUnavailable
									? t`AI availability couldn't be confirmed. Prepare manually; nothing here is sent to the employer or marks the job applied.`
									: connection.provider
										? t`Optional AI help in the editors; review edits before accepting. Nothing here is sent to the employer or marks the job applied.`
										: t`No AI needed. Edit documents and write answers yourself; nothing here is sent to the employer or marks the job applied.`
								: labels[next]}
						</p>
					</div>
					{action}
				</div>
				{editing && (
					<details className="group text-[13px] text-ink-2">
						<summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm hover:text-ink">
							<Icon
								name="caret-right"
								size={14}
								className="transition-transform duration-standard ease-enter group-open:rotate-90"
							/>
							{t`Step ${stepIndex + 1} of ${STEPS.length}`}
						</summary>
						<ol className="mt-2 grid list-inside list-decimal gap-1 ps-5">
							{STEPS.map((step) => (
								<li
									key={step}
									aria-current={step === next ? "step" : undefined}
									className={cn(step === next && "font-semibold text-ink")}
								>
									{labels[step]}
								</li>
							))}
						</ol>
					</details>
				)}
			</div>

			<div className="grid border-t border-line">
				{editing && (
					<Row label={t`Posting`} className={cn(postingEditorOpen && "pb-3")}>
						<span className={cn("min-w-0 truncate text-sm", postingText ? "text-ink" : "text-ink-3")}>
							{postingText || <Trans>Not saved yet</Trans>}
						</span>
						{next === "posting" ? (
							<span />
						) : (
							<Button
								variant="ghost"
								aria-expanded={postingEditorOpen}
								aria-controls={`${id}-posting-editor`}
								disabled={busy}
								onClick={() => setPostingOpen((open) => !open)}
							>
								{postingText ? <Trans>Edit posting</Trans> : <Trans>Add posting</Trans>}
							</Button>
						)}
						{postingEditorOpen && (
							<div id={`${id}-posting-editor`} className="col-span-full grid gap-2">
								<Label htmlFor={`${id}-posting`}>
									<Trans>Job description</Trans>
								</Label>
								<Textarea
									id={`${id}-posting`}
									value={posting ?? application.jobDescription ?? ""}
									maxLength={20_000}
									disabled={busy}
									className="min-h-28"
									onChange={(event) => setPosting(event.target.value)}
								/>
								<div className="flex gap-1.5">
									<Button
										size="sm"
										variant={next === "posting" ? "primary" : "secondary"}
										disabled={busy || posting === null}
										onClick={savePosting}
									>
										<Trans>Save posting</Trans>
									</Button>
									{next !== "posting" && (
										<Button
											size="sm"
											variant="ghost"
											onClick={() => {
												setPosting(null);
												setPostingOpen(false);
											}}
										>
											<Trans>Cancel</Trans>
										</Button>
									)}
								</div>
							</div>
						)}
					</Row>
				)}
				{documents.isError ? (
					<div role="alert" className="flex flex-wrap items-center gap-3 py-3 text-sm">
						<Trans>Linked documents couldn't be loaded.</Trans>
						<Button size="sm" variant="secondary" onClick={() => void documents.refetch()}>
							<Trans>Try again</Trans>
						</Button>
					</div>
				) : documents.isPending ? (
					<p role="status" className="py-3 text-sm text-ink-3">
						<Trans>Loading linked documents…</Trans>
					</p>
				) : (
					(["resume", "letter"] as const).map((kind) => {
						const selected = kind === "resume" ? application.resumeId : application.coverLetterId;
						const choices = documents.data.filter((document) => document.type === kind);
						const document = choices.find((item) => item.id === selected);
						const label = kind === "resume" ? t`Resume` : t`Cover letter`;
						const fieldId = `${id}-${kind}`;
						const select = (value: string | null) =>
							update.mutate({
								id: application.id,
								...(kind === "resume" ? { resumeId: value } : { coverLetterId: value }),
							});
						return (
							<Row
								key={kind}
								label={
									<Label htmlFor={fieldId} className="text-[13px] font-normal text-ink-2">
										{label}
									</Label>
								}
							>
								{editing ? (
									<Combobox
										id={fieldId}
										value={selected}
										options={choices.map((item) => ({ value: item.id, label: item.name }))}
										placeholder={kind === "letter" ? t`Optional · none selected` : t`None selected`}
										disabled={busy}
										className="h-9 w-full min-w-0"
										onValueChange={select}
									/>
								) : (
									<span className={cn("min-w-0 truncate text-sm", !document && "text-ink-3")}>
										{document?.name ?? (selected ? t`Linked document unavailable` : t`None selected`)}
									</span>
								)}
								<div className="-me-2 flex items-center gap-0.5">
									{selected &&
										document &&
										(kind === "resume" ? (
											<Link
												to="/builder/$resumeId"
												params={{ resumeId: selected }}
												search={{ applicationId: application.id }}
												aria-label={t`Edit resume`}
												className={buttonVariants({ variant: "ghost" })}
											>
												<Trans>Edit</Trans>
											</Link>
										) : (
											<Link
												to="/builder/letter/$coverLetterId"
												params={{ coverLetterId: selected }}
												aria-label={t`Edit cover letter`}
												className={buttonVariants({ variant: "ghost" })}
											>
												<Trans>Edit</Trans>
											</Link>
										))}
									<DropdownMenu>
										<DropdownMenuTrigger
											render={
												<IconButton
													icon="dots-three"
													label={kind === "resume" ? t`Resume options` : t`Cover letter options`}
													disabled={busy}
													className="text-ink-2"
												/>
											}
										/>
										<DropdownMenuContent align="end">
											{selected && (
												<DropdownMenuItem
													disabled={downloading !== null || !document}
													onClick={() => void download(kind, selected)}
												>
													<Icon name="download-simple" size={18} />
													{downloading === selected ? <Trans>Generating PDF…</Trans> : <Trans>Download PDF</Trans>}
												</DropdownMenuItem>
											)}
											{editing && kind === "resume" && (
												<DropdownMenuItem onClick={copyResume}>
													<Icon name="copy" size={18} />
													<Trans>Copy a base resume for this job</Trans>
												</DropdownMenuItem>
											)}
											{editing && kind === "resume" && connection.provider && selected && (
												<DropdownMenuItem
													onClick={() =>
														void navigate({
															to: "/builder/$resumeId",
															params: { resumeId: selected },
															search: { applicationId: application.id, assistant: "new" },
														})
													}
												>
													<Icon name="sparkle" size={18} />
													<Trans>Review with assistant</Trans>
												</DropdownMenuItem>
											)}
											{editing && kind === "letter" && !selected && (
												<DropdownMenuItem onClick={() => void writeLetter()}>
													<Icon name="envelope-simple" size={18} />
													<Trans>Write a letter</Trans>
												</DropdownMenuItem>
											)}
											{editing && selected && (
												<DropdownMenuItem onClick={() => select(null)}>
													<Icon name="x" size={18} />
													{kind === "resume" ? <Trans>Clear resume</Trans> : <Trans>Clear cover letter</Trans>}
												</DropdownMenuItem>
											)}
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
								{selected && !document && (
									<p role="alert" className="col-span-full text-xs text-ink-2">
										<Trans>Linked document unavailable. Choose another document or restore it from Trash.</Trans>
									</p>
								)}
							</Row>
						);
					})
				)}
			</div>
		</section>
	);
}

type RowProps = { label: ReactNode; className?: string; children: ReactNode };

/** One preparation row: a label column, the row's control or value, then its actions at the right edge. */
function Row({ label, className, children }: RowProps) {
	return (
		<div
			className={cn(
				"grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b border-line py-2.5 last:border-b-0 @md:grid-cols-[104px_minmax(0,1fr)_auto]",
				className,
			)}
		>
			<div className="col-span-full text-[13px] text-ink-2 @md:col-span-1">{label}</div>
			{children}
		</div>
	);
}
