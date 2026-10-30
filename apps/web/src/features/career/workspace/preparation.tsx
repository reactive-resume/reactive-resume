import type { Application } from "@/features/applications/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import { nextPreparationStep } from "@reactive-resume/schema/applications/preparation";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Label } from "@reactive-resume/ui/components/label";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { downloadWithAnchor, generateFilename } from "@reactive-resume/utils/file";
import { useDefaultProvider, useWorkspace } from "../hooks";
import { Combobox } from "@/components/ui/combobox";
import { useDialogStore } from "@/dialogs/store";
import { useInvalidateApplications } from "@/features/applications/use-application-actions";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type PreparationProps = { application: Application; disabled: boolean };

/** One application's preparation uses its existing document selection, editors, and review checks. */
export function Preparation({ application, disabled }: PreparationProps) {
	const navigate = useNavigate();
	const openDialog = useDialogStore((state) => state.openDialog);
	const invalidate = useInvalidateApplications();
	const documents = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const connection = useDefaultProvider();
	const workspace = useWorkspace(application.id);
	const [posting, setPosting] = useState<string | null>(null);
	const [downloading, setDownloading] = useState<string | null>(null);
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
		review: t`Review readiness below`,
		submitted: t`Submission recorded. Current drafts are separate from what you sent.`,
		closed: t`Application closed. Current drafts remain available.`,
	};
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
	const download = async (kind: "resume" | "letter", documentId: string) => {
		setDownloading(documentId);
		try {
			const { createExportFile } = await import("@/features/resume/export/use-resume-export");
			if (kind === "resume") {
				const resume = await client.resume.getById({ id: documentId });
				downloadWithAnchor(await createExportFile(resume, "pdf"), generateFilename(resume.name, "pdf"));
			} else {
				const letter = await client.coverLetters.getById({ id: documentId });
				const { createLetterWordsForLocale, letterPageData } = await import("@/features/letters/compose");
				const words = await createLetterWordsForLocale(letter.style.metadata.page.locale);
				const data = letterPageData(letter, words);
				downloadWithAnchor(
					await createExportFile({ name: letter.name, slug: "", data }, "pdf", "cover-letter", {
						includeCoverLetterHeader: true,
					}),
					generateFilename(letter.name, "pdf"),
				);
			}
		} catch (error) {
			toastError(error, t`Couldn't generate the PDF. Try again.`);
		} finally {
			setDownloading(null);
		}
	};

	return (
		<section aria-label={t`Application preparation`} className="grid gap-4 rounded-xl border border-line p-4">
			<h2 className="text-base font-semibold">
				{editing ? <Trans>Prepare this application</Trans> : <Trans>Current drafts</Trans>}
			</h2>
			{editing && (
				<ol className="grid list-inside list-decimal gap-1 text-sm text-ink-2">
					{(["posting", "resume", "tailor", "letter", "answers", "review"] as const).map((step) => (
						<li
							key={step}
							aria-current={step === next ? "step" : undefined}
							className={step === next ? "font-semibold text-ink" : undefined}
						>
							{labels[step]}
						</li>
					))}
				</ol>
			)}
			<p role="status" className="text-sm font-medium">
				{editing ? t`Next: ${labels[next]}` : labels[next]}
			</p>
			{editing && (
				<details open={next === "posting" ? true : undefined}>
					<summary className="cursor-pointer text-sm font-medium">
						<Trans>Job posting</Trans>
					</summary>
					<div className="mt-2 grid gap-2">
						<Label htmlFor={`${id}-posting`}>
							<Trans>Job description</Trans>
						</Label>
						<Textarea
							id={`${id}-posting`}
							value={posting ?? application.jobDescription ?? ""}
							maxLength={20_000}
							disabled={busy}
							onChange={(event) => setPosting(event.target.value)}
						/>
						<Button
							size="sm"
							variant="secondary"
							disabled={busy || posting === null}
							onClick={() =>
								update.mutate(
									{ id: application.id, jobDescription: posting?.trim() || null },
									{ onSuccess: () => setPosting(null) },
								)
							}
						>
							<Trans>Save posting</Trans>
						</Button>
					</div>
				</details>
			)}
			{documents.isError ? (
				<div role="alert" className="grid gap-2 text-sm">
					<Trans>Linked documents couldn't be loaded.</Trans>
					<Button size="sm" variant="secondary" onClick={() => void documents.refetch()}>
						<Trans>Try again</Trans>
					</Button>
				</div>
			) : documents.isPending ? (
				<p role="status">
					<Trans>Loading linked documents…</Trans>
				</p>
			) : (
				<div className="grid gap-4">
					{(["resume", "letter"] as const).map((kind) => {
						const selected = kind === "resume" ? application.resumeId : application.coverLetterId;
						const choices = documents.data.filter((document) => document.type === kind);
						const document = choices.find((item) => item.id === selected);
						const label = kind === "resume" ? t`Selected resume` : t`Selected cover letter (optional)`;
						return (
							<div key={kind} className="grid gap-2">
								<Label htmlFor={`${id}-${kind}`}>{label}</Label>
								{selected && !document && (
									<p role="alert" className="text-xs text-ink-2">
										<Trans>Linked document unavailable. Choose another document or restore it from Trash.</Trans>
									</p>
								)}
								{editing ? (
									<Combobox
										id={`${id}-${kind}`}
										value={selected}
										options={choices.map((item) => ({ value: item.id, label: item.name }))}
										placeholder={t`None selected`}
										showClear
										disabled={busy}
										onValueChange={(value) =>
											update.mutate({
												id: application.id,
												...(kind === "resume" ? { resumeId: value } : { coverLetterId: value }),
											})
										}
									/>
								) : (
									<p className="text-sm">
										{document?.name ?? (selected ? t`Linked document unavailable` : t`None selected`)}
									</p>
								)}
								<div className="flex flex-wrap gap-2">
									{selected && (
										<>
											{kind === "resume" ? (
												<Link
													to="/builder/$resumeId"
													params={{ resumeId: selected }}
													search={{ applicationId: application.id }}
													className={buttonVariants({ size: "sm", variant: "secondary" })}
												>
													<Trans>Edit current resume</Trans>
												</Link>
											) : (
												<Link
													to="/builder/letter/$coverLetterId"
													params={{ coverLetterId: selected }}
													className={buttonVariants({ size: "sm", variant: "secondary" })}
												>
													<Trans>Edit current letter</Trans>
												</Link>
											)}
											<Button
												size="sm"
												variant="secondary"
												disabled={busy || downloading !== null || !document}
												loading={downloading === selected}
												onClick={() => void download(kind, selected)}
											>
												{kind === "resume" ? <Trans>Download resume PDF</Trans> : <Trans>Download letter PDF</Trans>}
											</Button>
										</>
									)}
									{editing &&
										(kind === "resume" ? (
											<Button size="sm" variant="secondary" disabled={busy} onClick={copyResume}>
												<Trans>Copy a base resume for this job</Trans>
											</Button>
										) : (
											!selected && (
												<Button size="sm" variant="secondary" disabled={busy} onClick={() => void writeLetter()}>
													<Trans>Write a letter</Trans>
												</Button>
											)
										))}
								</div>
							</div>
						);
					})}
				</div>
			)}
			{editing && (
				<>
					<p className="text-xs text-ink-2">
						<Trans>
							First application setup: save the posting, copy or create a resume, then review the documents and any
							required form answers below. A cover letter and form answers are optional when the employer doesn't ask
							for them.
						</Trans>
					</p>
					<p className="text-xs text-ink-2">
						{connection.isUnavailable
							? t`AI availability couldn't be confirmed. Manual preparation is available.`
							: connection.provider
								? t`Optional AI help is available in the editors. Review proposed edits before accepting them.`
								: t`No AI connection needed. Edit documents and write answers yourself.`}
					</p>
					{connection.provider && application.resumeId && (
						<Link
							to="/builder/$resumeId"
							params={{ resumeId: application.resumeId }}
							search={{ applicationId: application.id, assistant: "new" }}
							className={buttonVariants({ size: "sm", variant: "secondary" })}
						>
							<Trans>Review with assistant</Trans>
						</Link>
					)}
					<a
						className="text-sm underline underline-offset-2"
						href={next === "answers" ? "#application-answers" : "#application-readiness"}
					>
						{next === "answers" ? <Trans>Go to form answers</Trans> : <Trans>Go to readiness review</Trans>}
					</a>
					<p className="text-xs text-ink-3">
						<Trans>Preparation never submits to an employer or marks this application as applied.</Trans>
					</p>
				</>
			)}
		</section>
	);
}
