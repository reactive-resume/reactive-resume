import type { Application } from "../../types";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { PIPELINE } from "../../stages";
import { useInvalidateApplications } from "../../use-application-actions";
import { FileAttachmentField } from "../file-attachment-field";
import { useDialogStore } from "@/dialogs/store";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

/** When the application was sent: its first stage at Applied or beyond. */
function sentOn(application: Application) {
	const applied = PIPELINE.indexOf("applied");
	const entry = [...application.activity]
		.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
		.find((item) => item.type === "stage" && PIPELINE.indexOf(item.stage) >= applied);
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
		<div className="flex items-center gap-2.5 rounded-xl border border-line p-3">
			<Icon name={icon} className="shrink-0 text-ink-2" />
			<div className="grid min-w-0 flex-1">
				<span className="truncate text-sm font-medium">{name}</span>
				<span className="text-xs text-ink-3">{status}</span>
			</div>
			{children}
		</div>
	);
}

type SentDocumentsProps = { application: Application; disabled: boolean };

/**
 * WHAT YOU SENT: the linked resume (opening the version that was sent, read-only, with a way back to the latest) and
 * the linked letter. Without them: Tailor a resume and Write a letter. Uploaded PDFs stay under "Attach a file".
 */
export function SentDocuments({ application, disabled }: SentDocumentsProps) {
	const { i18n } = useLingui();
	const navigate = useNavigate();
	const invalidate = useInvalidateApplications();
	const openDialog = useDialogStore((state) => state.openDialog);
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const [attaching, setAttaching] = useState(Boolean(application.resumeFileUrl || application.coverLetterUrl));

	const update = useMutation({
		...orpc.applications.update.mutationOptions(),
		onSuccess: () => invalidate(application.id),
		onError: (error) =>
			toast.add({ type: "error", description: getOrpcErrorMessage(error, { fallback: t`Couldn't save.` }) }),
	});
	const createLetter = useMutation(orpc.coverLetters.create.mutationOptions());

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
			void navigate({ to: "/builder/letter/$coverLetterId", params: { coverLetterId: created.id } });
		} catch (error) {
			toast.add({
				type: "error",
				description: getOrpcErrorMessage(error, { fallback: t`Couldn't create the letter.` }),
			});
		}
	};

	return (
		<section aria-labelledby="application-sent" className="grid gap-2">
			<h3 id="application-sent" className="text-xs font-semibold text-ink-3 uppercase">
				{application.status === "saved" ? <Trans>Documents for this job</Trans> : <Trans>What you sent</Trans>}
			</h3>

			{application.resumeId && (
				<SentDocumentRow
					icon="description"
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
						search={application.sentResumeVersionId ? { version: application.sentResumeVersionId } : {}}
						className={buttonVariants({ size: "sm", variant: "secondary" })}
					>
						<Trans>Open</Trans>
					</Link>
				</SentDocumentRow>
			)}

			{application.coverLetterId && (
				<SentDocumentRow
					icon="mail"
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
						search={application.sentCoverLetterVersionId ? { version: application.sentCoverLetterVersionId } : {}}
						className={buttonVariants({ size: "sm", variant: "secondary" })}
					>
						<Trans>Open</Trans>
					</Link>
				</SentDocumentRow>
			)}

			{(!application.resumeId || !application.coverLetterId) && (
				<div className="flex flex-wrap gap-1.5">
					{!application.resumeId && (
						<Button
							size="sm"
							disabled={disabled}
							onClick={() => openDialog("document.new", { step: "copy", applicationId: application.id })}
						>
							<Icon name="content_copy" size={16} />
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
							<Icon name="mail" size={16} />
							<Trans>Write a letter</Trans>
						</Button>
					)}
				</div>
			)}

			{attaching ? (
				<div className="grid gap-1.5">
					<FileAttachmentField
						value={
							application.resumeFileUrl
								? { url: application.resumeFileUrl, name: application.resumeFileName || t`Resume file` }
								: null
						}
						attachLabel={t`Attach a resume file (PDF)`}
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
						attachLabel={t`Attach a cover letter file (PDF)`}
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
