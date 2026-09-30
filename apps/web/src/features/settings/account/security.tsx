import type { AuthProvider } from "@reactive-resume/auth/types";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Switch } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { SettingsRow, SettingsSection } from "../section";
import { getProviderName, useAuthAccounts, useAuthProviderActions, useEnabledProviders } from "./auth-hooks";
import { useDialogStore } from "@/dialogs/store";
import { useConfirm, usePrompt } from "@/hooks/use-confirm";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";

const SOCIAL: AuthProvider[] = ["google", "github", "linkedin", "custom"];

const monthYear = (date: Date) => date.toLocaleDateString(undefined, { month: "long", year: "numeric" });

export function SecuritySection() {
	const openDialog = useDialogStore((state) => state.openDialog);
	const { hasAccount, getAccountByProviderId } = useAuthAccounts();
	const { enabledProviders } = useEnabledProviders();
	const { link, unlink } = useAuthProviderActions();
	const { data: session } = authClient.useSession();

	const password = getAccountByProviderId("credential");
	const twoFactor = session?.user.twoFactorEnabled ?? false;
	const social = SOCIAL.filter((provider) => provider in enabledProviders);

	return (
		<SettingsSection title={<Trans>Sign-in & security</Trans>}>
			<SettingsRow
				title={<Trans>Password</Trans>}
				description={
					password ? (
						<Trans>Last changed in {monthYear(new Date(password.updatedAt))}</Trans>
					) : (
						<Trans>You sign in without one</Trans>
					)
				}
			>
				{password ? (
					<Button size="sm" variant="secondary" onClick={() => openDialog("auth.change-password", undefined)}>
						<Trans>Change</Trans>
					</Button>
				) : (
					<Link to="/auth/forgot-password" className={buttonVariants({ size: "sm", variant: "secondary" })}>
						<Trans>Set a password</Trans>
					</Link>
				)}
			</SettingsRow>

			{password && (
				<SettingsRow
					title={<Trans>Two-step verification</Trans>}
					description={<Trans>A code from an authenticator app at sign-in</Trans>}
				>
					<Switch
						aria-label={t`Two-step verification`}
						checked={twoFactor}
						// Turning it on walks through the QR code and backup codes; turning it off asks for the password.
						onCheckedChange={() =>
							openDialog(twoFactor ? "auth.two-factor.disable" : "auth.two-factor.enable", undefined)
						}
					/>
				</SettingsRow>
			)}

			<Passkeys />

			{social.map((provider) => {
				const account = getAccountByProviderId(provider);
				const name =
					provider === "custom" ? (enabledProviders.custom ?? getProviderName(provider)) : getProviderName(provider);
				return (
					<SettingsRow
						key={provider}
						title={name}
						description={hasAccount(provider) ? <Trans>Connected</Trans> : <Trans>Not connected</Trans>}
					>
						{account ? (
							<Button size="sm" variant="ghost" onClick={() => void unlink(provider, account.accountId)}>
								<Trans>Disconnect</Trans>
							</Button>
						) : (
							<Button size="sm" variant="secondary" onClick={() => void link(provider)}>
								<Trans>Connect</Trans>
							</Button>
						)}
					</SettingsRow>
				);
			})}
		</SettingsSection>
	);
}

const PASSKEYS_KEY = ["auth", "passkeys"];

function Passkeys() {
	const queryClient = useQueryClient();
	const prompt = usePrompt();
	const confirm = useConfirm();
	const { data: passkeys = [] } = useQuery({
		queryKey: PASSKEYS_KEY,
		queryFn: () => authClient.passkey.listUserPasskeys(),
		select: ({ data }) => data ?? [],
	});
	const refresh = () => queryClient.invalidateQueries({ queryKey: PASSKEYS_KEY });
	const failed = (error: unknown, fallback: string) =>
		toast.add({ type: "error", description: getReadableErrorMessage(error, fallback) });

	const add = useMutation({
		mutationFn: async () => {
			const { data, error } = await authClient.passkey.addPasskey();
			if (error) return failed(error, t`Couldn't add the passkey. Try again.`);
			await refresh();
			const name = await prompt(t`Name this passkey`, {
				description: t`A name helps you tell passkeys apart, like "Work laptop".`,
				defaultValue: "",
				confirmText: t`Save`,
			});
			const id = typeof data?.id === "string" ? data.id : null;
			if (!id || !name?.trim()) return;
			const renamed = await authClient.passkey.updatePasskey({ id, name: name.trim() });
			if (renamed.error) return failed(renamed.error, t`Couldn't rename the passkey.`);
			await refresh();
		},
	});

	const remove = useMutation({
		mutationFn: async (id: string) => {
			if (
				!(await confirm(t`Remove this passkey?`, {
					description: t`It will no longer sign you in.`,
					confirmText: t`Remove`,
				}))
			)
				return;
			const { error } = await authClient.passkey.deletePasskey({ id });
			if (error) return failed(error, t`Couldn't remove the passkey. Try again.`);
			await refresh();
		},
	});
	const rename = useMutation({
		mutationFn: async (passkey: (typeof passkeys)[number]) => {
			const name = await prompt(t`Name this passkey`, { defaultValue: passkey.name ?? "", confirmText: t`Save` });
			if (!name?.trim()) return;
			const { error } = await authClient.passkey.updatePasskey({ id: passkey.id, name: name.trim() });
			if (error) return failed(error, t`Couldn't rename the passkey.`);
			await refresh();
		},
	});

	return (
		<div className="grid">
			<SettingsRow
				title={<Trans>Passkeys</Trans>}
				description={<Trans>Sign in with your fingerprint, face or device PIN</Trans>}
			>
				<Button size="sm" variant="secondary" loading={add.isPending} onClick={() => add.mutate()}>
					<Trans>Add passkey</Trans>
				</Button>
			</SettingsRow>
			{passkeys.length > 0 && (
				<ul className="ms-4 grid border-s border-line ps-3">
					{passkeys.map((passkey) => (
						<li key={passkey.id} className="flex items-center gap-3 py-1.5 text-sm">
							<span className="min-w-0 flex-1 truncate">{passkey.name || t`Unnamed passkey`}</span>
							<Button size="sm" variant="ghost" disabled={rename.isPending} onClick={() => rename.mutate(passkey)}>
								<Trans>Rename</Trans>
							</Button>
							<Button
								size="sm"
								variant="ghost"
								disabled={remove.isPending}
								aria-label={t`Remove ${passkey.name || t`Unnamed passkey`}`}
								onClick={() => remove.mutate(passkey.id)}
							>
								<Trans>Remove</Trans>
							</Button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
