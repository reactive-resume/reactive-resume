import { Trans } from "@lingui/react/macro";
import { KeyIcon, LockOpenIcon, ToggleLeftIcon, ToggleRightIcon } from "@phosphor-icons/react";
import { Button } from "@reactive-resume/ui/components/button";
import { Separator } from "@reactive-resume/ui/components/separator";
import { useDialogStore } from "@/dialogs/store";
import { authClient } from "@/libs/auth/client";
import { useAuthAccounts } from "./hooks";

export function TwoFactorSection() {
	const { openDialog } = useDialogStore();
	const { hasAccount } = useAuthAccounts();
	const { data: session } = authClient.useSession();

	const hasPassword = hasAccount("credential");
	const hasTwoFactor = session?.user.twoFactorEnabled ?? false;

	if (!hasPassword) return null;

	return (
		<div>
			<Separator />

			<div className="mt-4 flex items-center justify-between gap-x-4">
				<h2 className="flex items-center gap-x-3 font-medium text-base">
					{hasTwoFactor ? <LockOpenIcon /> : <KeyIcon />}
					<Trans>Two-Factor Authentication</Trans>
				</h2>

				<Button
					variant="outline"
					onClick={() => openDialog(hasTwoFactor ? "auth.two-factor.disable" : "auth.two-factor.enable", undefined)}
				>
					{hasTwoFactor ? (
						<>
							<ToggleLeftIcon />
							<Trans>Disable 2FA</Trans>
						</>
					) : (
						<>
							<ToggleRightIcon />
							<Trans>Enable 2FA</Trans>
						</>
					)}
				</Button>
			</div>
		</div>
	);
}
