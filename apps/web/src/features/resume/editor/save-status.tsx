import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useState } from "react";
import { Alert, AlertDescription } from "@reactive-resume/ui/components/alert";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { useResumeStore } from "@/features/resume/builder/draft";
import { useConfirm } from "@/hooks/use-confirm";
import { getReadableErrorMessage } from "@/libs/error-message";
import { ENTER_CLASS } from "@/libs/motion";

/** Save state under the document name, with Retry for failures and Reload for conflicts. */
export function SaveStatus() {
	const status = useResumeStore((state) => state.saveStatus);
	const retrySave = useResumeStore((state) => state.retrySave);
	const reloadFromServer = useResumeStore((state) => state.reloadFromServer);
	const confirm = useConfirm();
	const [reloading, setReloading] = useState(false);

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

	return (
		<span role="status" aria-live="polite" className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-ink-3">
			{status === "saving" && (
				<>
					<Spinner decorative className="size-3" />
					<Trans>Saving…</Trans>
				</>
			)}
			{(status === "saved" || status === "idle") && (
				<>
					<Icon name="cloud-check" size={16} />
					<Trans>Saved</Trans>
				</>
			)}
			{status === "offline" && (
				<span className={cn(ENTER_CLASS, "flex min-w-0 items-center gap-1.5 text-warn-text")}>
					<Icon name="cloud-slash" size={16} />
					<span className="truncate">
						<Trans>Offline · saved on this device</Trans>
					</span>
				</span>
			)}
			{status === "error" && (
				<span className={cn(ENTER_CLASS, "flex min-w-0 items-center gap-1.5 text-danger-text")}>
					<Icon name="cloud-warning" size={16} />
					<Trans>Not saved</Trans>
					<span aria-hidden="true">·</span>
					<button
						type="button"
						onClick={retrySave}
						aria-label={t`Retry saving`}
						className="rounded-sm font-semibold underline underline-offset-2 hover:opacity-80"
					>
						<Trans>Retry</Trans>
					</button>
				</span>
			)}
			{status === "locked" && (
				<span className={cn(ENTER_CLASS, "flex min-w-0 items-center gap-1.5 text-warn-text")}>
					<Icon name="lock" size={16} />
					<span className="truncate">
						<Trans>Locked · unlock to save</Trans>
					</span>
				</span>
			)}
			{status === "conflict" && (
				<span className={cn(ENTER_CLASS, "flex min-w-0 items-center gap-1.5 text-warn-text")}>
					<Icon name="cloud-warning" size={16} />
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
