import type { Application } from "../../types";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { NativeSelect } from "@reactive-resume/ui/components/native-select";
import { isCanonicalStageEvent } from "../../lanes";
import { PIPELINE } from "../../stages";
import { useInvalidateApplications } from "../../use-application-actions";
import { useDocumentDownload } from "../../use-document-download";
import { FileAttachmentField } from "../file-attachment-field";
import { useDialogStore } from "@/dialogs/store";
import { toastError } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

/** When the application was sent: its first stage at Applied or beyond. */
function sentOn(application: Application) {
	const applied = PIPELINE.indexOf("applied");
	const entry = [...application.activity]
		.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
		.find((item) => item.type === "stage" && isCanonicalStageEvent(item) && PIPELINE.indexOf(item.stage) >= applied);
	return new Date(entry?.at ?? application.appliedAt);
}

type SentDocumentRowProps = {
	icon: IconName;
	name: string;
	status: React.ReactNode;
	children: React.ReactNode;
};

function SentDocumentRow({ icon, name, status, children }: SentDocumentRowProps) {
	return (
		<div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-xl border border-line p-3">
			<Icon name={icon} className="shrink-0 text-ink-2" />
			<div className="grid min-w-44 flex-1">
				<span className="truncate text-sm font-medium">{name}</span>
				<span className="text-xs text-ink-3">{status}</span>
			</div>
			{/* Actions keep their size and drop to a second line, right-aligned, when the name needs the width. */}
			<div className="ms-auto flex items-center gap-1">{children}</div>
		</div>
	);
}

type SentDocumentsProps = {
	application: Application;
	disabled: boolean;
	/** `workspace` (Apply tab): a section heading, the recorded submission line, and each row's current-draft actions. */
	variant?: "detail" | "workspace";
};

/**
 * WHAT YOU SENT: the linked resume (opening the version that was sent, read-only, with a way back to the latest) and
 * the linked letter. Without them: Tailor a resume and Write a letter. Uploaded PDFs stay under "Attach a file".
 */
export function SentDocuments({ application, disabled, variant = "detail" }: SentDocumentsProps) {
	const { i18n } = useLingui();
	const navigate = useNavigate();
	const { download, downloading } = useDocumentDownload();
	const workspace = variant === "workspace";
	const invalidate = useInvalidateApplications();
	const queryClient = useQueryClient();
	const openDialog = useDialogStore((state) => state.openDialog);
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const [attaching, setAttaching] = useState(Boolean(application.resumeFileUrl || application.coverLetterUrl));

	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: (error) => toastError(error, t`Couldn't save the documents. Try again.`),
	});
	const createLetter = useMutation(orpc.coverLetters.create.mutationOptions());
	const link = useMutation({
		...orpc.documents.linkApplication.mutationOptions(),
		onSuccess: () => {
			invalidate(application.id);
			void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
		},
		onError: (error) => toastError(error, t`Couldn't save the documents. Try again.`),
	});

	const resume = documents?.find((document) => document.type === "resume" && document.id === application.resumeId);
	const letter = documents?.find((document) => document.type === "letter" && document.id === application.coverLetterId);
	const date = sentOn(application).toLocaleDateString(i18n.locale, { month: "short", day: "numeric" });

	// A structured letter: the server fills the recipient from the application and makes it the application's letter.
	const writeLetter = async () => {
		const letterInput = {
			name: t`Cover letter — ${application.company}`.slice(0, 100),
			applicationId: application.id,
			...(application.resumeId ? { resumeId: application.resumeId } : {}),
		};
		try {
			const created = await createLetter.mutateAsync(letterInput);
			invalidate(application.id);
			void navigate({
				to: "/builder/letter/$coverLetterId",
				params: { coverLetterId: created.id },
				search: { applicationId: application.id },
			});
		} catch (error) {
			toastError(error, t`Couldn't create the letter. Try again.`);
		}
	};

	// Current drafts stay editable after submission; the sent versions above never change.
	const draftMenu = (kind: "resume" | "letter", documentId: string) => (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<IconButton
						icon="dots-three"
						label={kind === "resume" ? t`Resume options` : t`Cover letter options`}
						size="icon-xs"
						className="text-ink-2"
					/>
				}
			/>
			<DropdownMenuContent align="end">
				<DropdownMenuItem
					onClick={() =>
						void navigate(
							kind === "resume"
								? {
										to: "/builder/$resumeId",
										params: { resumeId: documentId },
										search: { applicationId: application.id },
									}
								: {
										to: "/builder/letter/$coverLetterId",
										params: { coverLetterId: documentId },
										search: { applicationId: application.id },
									},
						)
					}
				>
					<Icon name="pencil-simple" size={18} />
					<Trans>Edit current draft</Trans>
				</DropdownMenuItem>
				<DropdownMenuItem disabled={downloading !== null} onClick={() => void download(kind, documentId)}>
					<Icon name="download-simple" size={18} />
					{downloading === documentId ? <Trans>Generating PDF…</Trans> : <Trans>Download current PDF</Trans>}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);

	return (
		<section aria-labelledby="application-sent" className="grid gap-2">
			{workspace ? (
				<div className="grid gap-1 pb-1">
					<h2 id="application-sent" className="text-lg leading-6 font-semibold">
						<Trans>What you sent</Trans>
					</h2>
					<p className="flex items-start gap-1.5 text-[13px] leading-[18px] text-ink-2">
						<Icon name="check-circle" size={16} className="mt-px shrink-0 text-accent-text" />
						<span>
							<Trans>
								Submission recorded {date}. The sent versions never change; current drafts stay editable. This record
								does not confirm employer receipt.
							</Trans>
						</span>
					</p>
				</div>
			) : (
				<h3 id="application-sent" className="text-xs font-semibold text-ink-3">
					{application.status === "saved" ? <Trans>Documents for this job</Trans> : <Trans>What you sent</Trans>}
				</h3>
			)}

			{application.resumeId && (
				<SentDocumentRow
					icon="file-text"
					name={resume?.name ?? t`Linked resume`}
					status={
						application.sentResumeVersionId ? (
							application.sentCheckScore !== null ? (
								<Trans>
									Version sent {date} · Check {application.sentCheckScore}
								</Trans>
							) : (
								<Trans>Version sent {date}</Trans>
							)
						) : (
							<Trans>Linked · not sent yet</Trans>
						)
					}
				>
					<Link
						to="/builder/$resumeId"
						params={{ resumeId: application.resumeId }}
						search={{
							applicationId: application.id,
							...(application.sentResumeVersionId ? { version: application.sentResumeVersionId } : {}),
						}}
						className={buttonVariants({ size: "sm", variant: "secondary" })}
					>
						{workspace && application.sentResumeVersionId ? <Trans>Open sent version</Trans> : <Trans>Open</Trans>}
					</Link>
					{workspace && draftMenu("resume", application.resumeId)}
				</SentDocumentRow>
			)}

			{application.coverLetterId && (
				<SentDocumentRow
					icon="envelope-simple"
					name={letter?.name ?? t`Cover letter`}
					status={
						application.sentCoverLetterVersionId ? (
							<Trans>Version sent {date}</Trans>
						) : (
							<Trans>Linked · not sent yet</Trans>
						)
					}
				>
					<Link
						to="/builder/letter/$coverLetterId"
						params={{ coverLetterId: application.coverLetterId }}
						search={{
							applicationId: application.id,
							...(application.sentCoverLetterVersionId ? { version: application.sentCoverLetterVersionId } : {}),
						}}
						className={buttonVariants({ size: "sm", variant: "secondary" })}
					>
						{workspace && application.sentCoverLetterVersionId ? <Trans>Open sent version</Trans> : <Trans>Open</Trans>}
					</Link>
					{workspace && draftMenu("letter", application.coverLetterId)}
				</SentDocumentRow>
			)}

			{/* A closed application has an outcome, not a preparation task: no Prepare a resume / Write a letter primary action. */}
			{application.status !== "closed" && (!application.resumeId || !application.coverLetterId) && (
				<div className="flex flex-wrap gap-1.5">
					{!application.resumeId && (
						<Button
							size="sm"
							disabled={disabled}
							onClick={() => openDialog("document.new", { step: "copy", applicationId: application.id })}
						>
							<Icon name="copy" size={16} />
							<Trans>Prepare a resume</Trans>
						</Button>
					)}
					{!application.coverLetterId && (
						<Button
							size="sm"
							variant="secondary"
							disabled={disabled || createLetter.isPending}
							onClick={() => void writeLetter()}
						>
							<Icon name="envelope-simple" size={16} />
							<Trans>Write a letter</Trans>
						</Button>
					)}
				</div>
			)}

			{application.status === "saved" && !application.sentCoverLetterVersionId && (
				<NativeSelect
					aria-label={t`Use an existing letter`}
					value={application.coverLetterId ?? ""}
					disabled={disabled || link.isPending}
					onChange={(event) => {
						const id = event.target.value;
						if (id) link.mutate({ type: "letter", id, applicationId: application.id });
					}}
				>
					<option value="">{t`Use an existing letter…`}</option>
					{documents
						?.filter(
							(item) =>
								item.type === "letter" &&
								!item.isLocked &&
								(!item.application || item.application.id === application.id),
						)
						.map((item) => (
							<option key={item.id} value={item.id}>
								{item.name}
							</option>
						))}
				</NativeSelect>
			)}

			{attaching ? (
				<div className="grid gap-1.5">
					<FileAttachmentField
						value={
							application.resumeFileUrl
								? { url: application.resumeFileUrl, name: application.resumeFileName || t`Resume file` }
								: null
						}
						attachLabel={t`Attach a resume file (PDF, up to 10 MB)`}
						disabled={disabled || update.isPending}
						onChange={(value) =>
							update.mutate({
								id: application.id,
								...(value ? { resumeFile: value } : { resumeFileUrl: null, resumeFileName: null }),
							})
						}
					/>
					<FileAttachmentField
						value={
							application.coverLetterUrl
								? { url: application.coverLetterUrl, name: application.coverLetterName || t`Cover letter file` }
								: null
						}
						attachLabel={t`Attach a cover letter file (PDF, up to 10 MB)`}
						disabled={disabled || update.isPending}
						onChange={(value) =>
							update.mutate({
								id: application.id,
								...(value ? { coverLetterFile: value } : { coverLetterUrl: null, coverLetterName: null }),
							})
						}
					/>
				</div>
			) : (
				<button
					type="button"
					onClick={() => setAttaching(true)}
					className="w-fit text-xs text-ink-3 underline underline-offset-2 hover:text-ink-2"
				>
					<Trans>Attach a file instead</Trans>
				</button>
			)}
		</section>
	);
}
