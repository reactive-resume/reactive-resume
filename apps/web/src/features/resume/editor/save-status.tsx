import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { Alert, AlertDescription } from "@reactive-resume/ui/components/alert";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { useDocumentSentAt } from "@/features/documents/document-status";
import { useResumeStore } from "@/features/resume/builder/draft";
import { useEditorStore } from "@/features/resume/editor/store";
import { useConfirm } from "@/hooks/use-confirm";
import { sessionSignInURL, useSessionRecovery } from "@/libs/auth/session-recovery";
import { getReadableErrorMessage } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";

/**
 * What the status line adds to the save state while there is nothing to do: how long the resume runs and where it
 * stands, as Documents says it ("1 page · Public", "2 pages · Draft", "1 page · Sent 2 Nov").
 */
function useDocumentFacts() {
	const pageCount = useEditorStore((state) => state.rendered.pageCount);
	const id = useResumeStore((state) => state.resume?.id ?? "");
	const isPublic = useResumeStore((state) => state.resume?.isPublic ?? false);
	const applicationId = useResumeStore((state) => state.resume?.applicationId ?? null);
	const { session } = useRouteContext({ strict: false });
	const sentAt = useDocumentSentAt({
		type: "resume",
		id,
		isPublic,
		hasPassword: false,
		application: applicationId ? { id: applicationId } : null,
	} as Parameters<typeof useDocumentSentAt>[0]);
	const pages = pageCount > 0 ? plural(pageCount, { one: "# page", other: "# pages" }) : null;
	const sentOn = sentAt
		? i18n.date(sentAt, { day: "numeric", month: "short", timeZone: session?.user.timezone ?? "UTC" })
		: null;
	const standing = sentOn
		? t({ comment: "A document's status: the day it was sent with its application", message: `Sent ${sentOn}` })
		: isPublic
			? t`Public`
			: t`Draft`;

	return [pages, standing].filter(Boolean).join(" · ");
}

/** Save state under the document name, with Retry for failures and Reload for conflicts. */
export function SaveStatus() {
	const facts = useDocumentFacts();
	const isLocked = useResumeStore((state) => state.resume?.isLocked ?? false);
	const status = useResumeStore((state) => state.saveStatus);
	const retrySave = useResumeStore((state) => state.retrySave);
	const reloadFromServer = useResumeStore((state) => state.reloadFromServer);
	const confirm = useConfirm();
	const [reloading, setReloading] = useState(false);
	const sessionEnded = useSessionRecovery((state) => state.accountId !== null);

	const reload = async () => {
		if (
			!(await confirm(t`Reload the saved version?`, {
				description: t`Your edits will be kept as a separate resume in Documents before loading the saved version.`,
				confirmText: t`Keep a copy and reload`,
			}))
		)
			return;
		setReloading(true);
		try {
			await reloadFromServer();
		} catch (error) {
			toast.add({
				type: "error",
				description: getReadableErrorMessage(error, t`Couldn't reload the resume. Your changes are still open.`),
			});
		} finally {
			setReloading(false);
		}
	};

	// Announced apart from the visible line, so its Retry and Reload buttons aren't inside a live region; a failed save
	// is assertive, every other state polite.
	const announcement =
		status === "saving"
			? t`Saving…`
			: status === "offline"
				? t`Offline · saved on this device`
				: status === "error"
					? sessionEnded
						? t`Not saved · Sign in to save`
						: t`Not saved`
					: status === "locked"
						? t`Locked · unlock to save`
						: status === "conflict"
							? t`Review saved version`
							: t`Saved`;

	return (
		<span className="flex max-w-full min-w-0 items-center gap-1.5 text-xs leading-4 text-ink-3">
			<span
				className="sr-only"
				role={status === "error" ? "alert" : "status"}
				aria-live={status === "error" ? "assertive" : "polite"}
			>
				{announcement}
			</span>
			{status === "saving" && (
				<>
					<Spinner decorative className="size-3" />
					<Trans>Saving…</Trans>
				</>
			)}
			{(status === "saved" || status === "idle") && (
				// One line of words: the state, then the pages and where the resume stands.
				<span className="flex-1 truncate">{[isLocked ? t`Locked` : t`Saved`, facts].filter(Boolean).join(" · ")}</span>
			)}
			{status === "offline" && (
				<span className={cn(ENTER_CLASS, "flex min-w-0 items-center gap-1.5 text-warn-text")}>
					<Icon name="cloud-slash" size={14} />
					<span className="truncate">
						<Trans>Offline · saved on this device</Trans>
					</span>
				</span>
			)}
			{status === "error" && (
				<span className={cn(ENTER_CLASS, "flex min-w-0 items-center gap-1.5 text-danger-text")}>
					<Icon name="cloud-warning" size={14} />
					<Trans>Not saved</Trans>
					<span aria-hidden="true">·</span>
					{sessionEnded ? (
						<a
							href={sessionSignInURL()}
							target="_blank"
							rel="noopener noreferrer"
							className="rounded-sm font-semibold underline underline-offset-2 hover:opacity-80"
						>
							<Trans>Sign in to save</Trans>
						</a>
					) : (
						<button
							type="button"
							onClick={retrySave}
							aria-label={t`Retry saving`}
							className="rounded-sm font-semibold underline underline-offset-2 hover:opacity-80"
						>
							<Trans>Retry</Trans>
						</button>
					)}
				</span>
			)}
			{status === "locked" && (
				<span className={cn(ENTER_CLASS, "flex min-w-0 items-center gap-1.5 text-warn-text")}>
					<Icon name="lock" size={14} />
					<span className="truncate">
						<Trans>Locked · unlock to save</Trans>
					</span>
				</span>
			)}
			{status === "conflict" && (
				<span className={cn(ENTER_CLASS, "flex min-w-0 items-center gap-1.5 text-warn-text")}>
					<Icon name="cloud-warning" size={14} />
					<span className="truncate">
						<Trans>Review saved version</Trans>
					</span>
					<span aria-hidden="true">·</span>
					<button
						type="button"
						disabled={reloading}
						onClick={() => void reload()}
						className="rounded-sm font-semibold underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
					>
						<Trans>Reload</Trans>
					</button>
				</span>
			)}
		</span>
	);
}

/** Shown at the top of the panel while offline: editing carries on, Download and Share wait for a connection. */
export function OfflineBanner({ className }: { className?: string }) {
	const offline = useResumeStore((state) => state.saveStatus === "offline");
	if (!offline) return null;

	return (
		<Alert variant="warn" role="status" className={cn(ENTER_CLASS, className)}>
			<Icon name="wifi-slash" size={20} />
			<AlertDescription>
				<Trans>You can keep editing. Changes sync when you're back online. Download and Share need a connection.</Trans>
			</AlertDescription>
		</Alert>
	);
}
