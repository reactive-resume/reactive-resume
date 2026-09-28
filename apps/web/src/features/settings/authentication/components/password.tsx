import { Trans } from "@lingui/react/macro";
import { PasswordIcon, PencilSimpleLineIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { Button } from "@reactive-resume/ui/components/button";
import { useDialogStore } from "@/dialogs/store";
import { useAuthAccounts } from "./hooks";

export function PasswordSection() {
	const { openDialog } = useDialogStore();
	const { hasAccount } = useAuthAccounts();

	const hasPassword = hasAccount("credential");

	return (
		<div className="flex items-center justify-between gap-x-4">
			<h2 className="flex items-center gap-x-3 font-medium text-base">
				<PasswordIcon />
				<Trans>Password</Trans>
			</h2>

			{hasPassword ? (
				<Button variant="outline" onClick={() => openDialog("auth.change-password", undefined)}>
					<PencilSimpleLineIcon />
					<Trans>Update Password</Trans>
				</Button>
			) : (
				<Button
					variant="outline"
					nativeButton={false}
					render={
						<Link to="/auth/forgot-password">
							<Trans>Set Password</Trans>
						</Link>
					}
				/>
			)}
		</div>
	);
}
