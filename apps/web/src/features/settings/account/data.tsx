import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useId, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@reactive-resume/ui/components/alert-dialog";
import { Button } from "@reactive-resume/ui/components/button";
import { Input } from "@reactive-resume/ui/components/input";
import { toast } from "@reactive-resume/ui/components/toast";
import { downloadWithAnchor } from "@reactive-resume/utils/file";
import { SettingsRow, SettingsSection } from "../section";
import { buildAccountZip } from "./export";
import { clearAccountData } from "@/libs/auth/clear-account-data";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";
import { client } from "@/libs/orpc/client";

const CONFIRMATION = "delete";

type DataSectionProps = { openDeletion?: boolean };

export function DataSection({ openDeletion = false }: DataSectionProps) {
	const [deleting, setDeleting] = useState(openDeletion);

	const exportAll = useMutation({
		mutationFn: async () => {
			const zip = buildAccountZip(await client.auth.exportData());
			const date = new Date().toISOString().slice(0, 10);
			downloadWithAnchor(new Blob([zip as BlobPart], { type: "application/zip" }), `reactive-resume-${date}.zip`);
		},
		onError: (error) =>
			toast.add({
				type: "error",
				description: getReadableErrorMessage(error, t`Couldn't export your data. Try again.`),
			}),
	});

	return (
		<SettingsSection title={<Trans>Your data</Trans>}>
			<SettingsRow
				title={<Trans>Export everything</Trans>}
				description={<Trans>All documents and applications as JSON, in one zip</Trans>}
			>
				<Button size="sm" variant="secondary" loading={exportAll.isPending} onClick={() => exportAll.mutate()}>
					<Trans>Export</Trans>
				</Button>
			</SettingsRow>
			<SettingsRow
				title={<Trans>Delete account</Trans>}
				description={<Trans>Permanently removes everything. Export first if you want a copy.</Trans>}
			>
				<Button
					size="sm"
					variant="ghost"
					className="border border-danger font-semibold text-danger-text hover:bg-danger-soft"
					onClick={() => setDeleting(true)}
				>
					<Trans>Delete…</Trans>
				</Button>
			</SettingsRow>
			<DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
		</SettingsSection>
	);
}

type DeleteAccountDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

/** The one confirmation in Settings that asks you to type: it names what goes, and can't be undone. */
function DeleteAccountDialog({ open, onOpenChange }: DeleteAccountDialogProps) {
	const id = useId();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [typed, setTyped] = useState("");

	const remove = useMutation({
		mutationFn: () => client.auth.deleteAccount(),
		onSuccess: async () => {
			await authClient.signOut();
			clearAccountData(queryClient);
			toast.add({ description: t`Your account was deleted.` });
			void navigate({ to: "/" });
		},
		onError: (error) =>
			toast.add({
				type: "error",
				description: getReadableErrorMessage(error, t`Couldn't delete your account. Try again.`),
			}),
	});

	return (
		<AlertDialog
			open={open}
			onOpenChange={onOpenChange}
			// The typed confirmation clears once the dialog has faded out.
			onOpenChangeComplete={(next) => !next && setTyped("")}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						<Trans>Delete your account?</Trans>
					</AlertDialogTitle>
					<AlertDialogDescription>
						<Trans>
							All your documents, applications, API keys and public links are deleted for good. This can't be undone.
						</Trans>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="grid gap-1.5">
					<label htmlFor={id} className="text-[13px] font-medium">
						<Trans>
							Type <b className="font-mono font-medium">{CONFIRMATION}</b> to confirm
						</Trans>
					</label>
					<Input
						id={id}
						value={typed}
						autoComplete="off"
						className="focus-visible:border-danger focus-visible:shadow-[0_0_0_3px_var(--danger-soft)]"
						onChange={(event) => setTyped(event.target.value)}
					/>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel>
						<Trans>Keep account</Trans>
					</AlertDialogCancel>
					<AlertDialogAction
						variant="danger"
						disabled={typed.trim().toLowerCase() !== CONFIRMATION}
						loading={remove.isPending}
						onClick={() => remove.mutate()}
					>
						<Trans>Delete account</Trans>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
