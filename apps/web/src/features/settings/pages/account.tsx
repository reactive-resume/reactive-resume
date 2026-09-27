import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { DownloadSimpleIcon, TrashSimpleIcon } from "@phosphor-icons/react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor, generateFilename } from "@reactive-resume/utils/file";
import { useConfirm } from "@/hooks/use-confirm";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { orpc } from "@/libs/orpc/client";

const CONFIRMATION_TEXT = "delete";

export function AccountSettingsPage() {
	const confirm = useConfirm();
	const navigate = useNavigate();
	const [confirmationText, setConfirmationText] = useState("");

	const { mutate: deleteAccount } = useMutation(orpc.auth.deleteAccount.mutationOptions());

	const { mutate: exportData, isPending: isExporting } = useMutation(
		orpc.auth.exportData.mutationOptions({
			onSuccess: (data) => {
				const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
				downloadWithAnchor(blob, generateFilename("reactive-resume-export", "json"));
				toast.add({ type: "success", description: t`Your data has been exported.` });
			},
			onError: (error) => {
				toast.add({
					type: "error",
					description: getReadableErrorMessage(
						error,
						t({
							comment: "Fallback toast when data export fails",
							message: "Failed to export your data. Please try again.",
						}),
					),
				});
			},
		}),
	);

	const handleDeleteAccount = async () => {
		const confirmed = await confirm(t`Are you sure you want to delete your account?`, {
			description: t`This action cannot be undone. All your data will be permanently deleted.`,
			confirmText: t({
				comment: "Account deletion confirmation dialog confirm action in account settings",
				message: "Confirm",
			}),
			cancelText: t({
				comment: "Account deletion confirmation dialog cancel action in account settings",
				message: "Cancel",
			}),
		});

		if (!confirmed) return;

		const toastId = toast.add({ type: "loading", description: t`Deleting your account...` });

		deleteAccount(undefined, {
			onSuccess: async () => {
				toast.add({ type: "success", description: t`Your account has been deleted.`, id: toastId });
				await authClient.signOut();
				void navigate({ to: "/" });
			},
			onError: (error) => {
				toast.add({
					type: "error",
					description: getReadableErrorMessage(
						error,
						t({
							comment: "Fallback toast when account deletion fails",
							message: "Failed to delete your account. Please try again.",
						}),
					),
					id: toastId,
				});
			},
		});
	};

	return (
		<div className="grid max-w-xl gap-6">
			<div className="grid gap-3">
				<p className="leading-relaxed">
					<Trans>Download a copy of all your data, including your profile and every resume, as a JSON file.</Trans>
				</p>

				<Button
					variant="outline"
					className="justify-self-start"
					onClick={() => exportData(undefined)}
					disabled={isExporting}
				>
					<DownloadSimpleIcon />
					<Trans>Export my data</Trans>
				</Button>
			</div>

			<hr className="border-border" />

			<p className="leading-relaxed">
				<Trans>To delete your account, type the confirmation text below, then click the button.</Trans>
			</p>

			<Input
				type="text"
				value={confirmationText}
				onChange={(e) => setConfirmationText(e.target.value)}
				placeholder={t`Type "${CONFIRMATION_TEXT}" to confirm`}
			/>

			<Button
				variant="destructive"
				className="justify-self-end"
				onClick={handleDeleteAccount}
				disabled={confirmationText !== CONFIRMATION_TEXT}
			>
				<TrashSimpleIcon />
				<Trans>Delete Account</Trans>
			</Button>
		</div>
	);
}
