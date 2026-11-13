import type { AuthProvider } from "@reactive-resume/auth/types";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { SettingsRow, SettingsSection, subRowClassName, subRowsClassName, TextAction } from "../section";
import { getProviderName, useAuthAccounts, useAuthProviderActions, useEnabledProviders } from "./auth-hooks";
import { BackupCodesRow } from "./backup-codes";
import { SessionsRow } from "./sessions";
import { IconTile } from "@/components/calm/list-row";
import { useDialogStore } from "@/dialogs/store";
import { useConfirm, usePrompt } from "@/hooks/use-confirm";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";

const SOCIAL: AuthProvider[] = ["apple", "google", "github", "linkedin", "custom"];

const PROVIDER_ICON: Partial<Record<AuthProvider, IconName>> = {
	google: "google-logo",
	github: "github-logo",
	linkedin: "linkedin-logo",
};

const monthYear = (date: Date) => i18n.date(date, { month: "long", year: "numeric" });

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
		<SettingsSection id="security" title={<Trans>Sign-in and security</Trans>}>
			<SettingsRow
				id="password"
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
					<TextAction aria-label={t`Change password`} onClick={() => openDialog("auth.change-password", undefined)}>
						<Trans>Change</Trans>
					</TextAction>
				) : "credential" in enabledProviders ? (
					<TextAction onClick={() => openDialog("auth.set-password", undefined)}>
						<Trans>Set a password</Trans>
					</TextAction>
				) : null}
			</SettingsRow>

			<SettingsRow
				id="two-step"
				title={<Trans>Two-step verification</Trans>}
				description={
					!password ? (
						<Trans>Set a password to turn on two-step verification.</Trans>
					) : twoFactor ? (
						<Trans>On · a code from your authenticator app at sign-in</Trans>
					) : (
						<Trans>Off</Trans>
					)
				}
			>
				{/* Turning it on walks through the QR code and backup codes; turning it off asks for the password. */}
				{password &&
					(twoFactor ? (
						<TextAction
							aria-label={t`Turn off two-step verification`}
							onClick={() => openDialog("auth.two-factor.disable", undefined)}
						>
							<Trans>Turn off</Trans>
						</TextAction>
					) : (
						<TextAction
							aria-label={t`Set up two-step verification`}
							onClick={() => openDialog("auth.two-factor.enable", undefined)}
						>
							<Trans>Set up</Trans>
						</TextAction>
					))}
			</SettingsRow>
			{password && twoFactor && <BackupCodesRow />}

			<Passkeys />

			{social.map((provider, index) => {
				const account = getAccountByProviderId(provider);
				const name =
					provider === "custom" ? (enabledProviders.custom ?? getProviderName(provider)) : getProviderName(provider);
				return (
					<SettingsRow
						key={provider}
						id={index === 0 ? "linked-accounts" : undefined}
						leading={
							<IconTile className="bg-raised shadow-[inset_0_0_0_1px_var(--line)]">
								<Icon name={PROVIDER_ICON[provider] ?? "sign-in"} size={20} />
							</IconTile>
						}
						title={name}
						description={hasAccount(provider) ? <Trans>Connected</Trans> : <Trans>Not connected</Trans>}
					>
						{account ? (
							<TextAction onClick={() => void unlink(provider, account.id)}>
								<Trans>Disconnect</Trans>
							</TextAction>
						) : (
							<TextAction onClick={() => void link(provider)}>
								<Trans>Connect</Trans>
							</TextAction>
						)}
					</SettingsRow>
				);
			})}

			<SessionsRow />
		</SettingsSection>
	);
}

const PASSKEYS_KEY = ["auth", "passkeys"];

function Passkeys() {
	const queryClient = useQueryClient();
	const { data: session } = authClient.useSession();
	const smtpEnabled = useRouteContext({ strict: false }).flags?.smtpEnabled ?? false;
	// The server adds passkeys only to verified addresses; say so instead of offering a button that always fails.
	const verified = session?.user.emailVerified ?? true;
	const prompt = usePrompt();
	const confirm = useConfirm();
	// Links to `#passkeys` (the phone apps use it) land on the opened list.
	const [open, setOpen] = useState(() => window.location.hash === "#passkeys");
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
				description: t`A name helps you tell passkeys apart, like “Work laptop”.`,
				defaultValue: "",
				confirmText: t`Save name`,
			});
			const id = typeof data?.id === "string" ? data.id : null;
			if (!id || !name?.trim()) return;
			const renamed = await authClient.passkey.updatePasskey({ id, name: name.trim() });
			if (renamed.error) return failed(renamed.error, t`Couldn't rename the passkey. Try again.`);
			await refresh();
		},
	});

	const remove = useMutation({
		mutationFn: async (passkey: (typeof passkeys)[number]) => {
			const name = passkey.name || t`Unnamed passkey`;
			if (
				!(await confirm(t`Remove “${name}”?`, {
					description: t`You can no longer sign in with this passkey. Your password and other passkeys still work.`,
					confirmText: t`Remove passkey`,
					cancelText: t`Keep passkey`,
					variant: "danger",
				}))
			)
				return;
			const { error } = await authClient.passkey.deletePasskey({ id: passkey.id });
			if (error) return failed(error, t`Couldn't remove the passkey. Try again.`);
			await refresh();
		},
	});
	const rename = useMutation({
		mutationFn: async (passkey: (typeof passkeys)[number]) => {
			const name = await prompt(t`Name this passkey`, { defaultValue: passkey.name ?? "", confirmText: t`Save name` });
			if (!name?.trim()) return;
			const { error } = await authClient.passkey.updatePasskey({ id: passkey.id, name: name.trim() });
			if (error) return failed(error, t`Couldn't rename the passkey. Try again.`);
			await refresh();
		},
	});

	const count = passkeys.length;
	const first = passkeys[0]?.name || t`Unnamed passkey`;
	const summary = count === 1 ? t`1 passkey · ${first}` : plural(count, { one: "# passkey", other: "# passkeys" });
	const listed = open && count > 0;

	return (
		<>
			<SettingsRow
				id="passkeys"
				title={<Trans>Passkeys</Trans>}
				description={
					!verified ? (
						smtpEnabled ? (
							<Trans>Verify your email to add a passkey.</Trans>
						) : (
							<Trans>Passkeys need a verified email, which this server can't send.</Trans>
						)
					) : count > 0 && !open ? (
						summary
					) : (
						<Trans>Sign in with your fingerprint, face or device PIN</Trans>
					)
				}
			>
				{count > 0 && !open ? (
					<TextAction aria-label={t`Manage passkeys`} onClick={() => setOpen(true)}>
						<Trans>Manage</Trans>
					</TextAction>
				) : (
					<TextAction loading={add.isPending} disabled={!verified} onClick={() => add.mutate()}>
						<Trans>Add a passkey</Trans>
					</TextAction>
				)}
			</SettingsRow>
			{listed && (
				<ul className={subRowsClassName}>
					{passkeys.map((passkey) => {
						const name = passkey.name || t`Unnamed passkey`;
						return (
							<li key={passkey.id} className={subRowClassName}>
								<Icon name="fingerprint" size={18} className="text-ink-2" />
								<span className="min-w-0 flex-1 truncate font-medium">{name}</span>
								<TextAction
									disabled={rename.isPending}
									aria-label={t`Rename ${name}`}
									onClick={() => rename.mutate(passkey)}
								>
									<Trans>Rename</Trans>
								</TextAction>
								<TextAction
									disabled={remove.isPending}
									aria-label={t`Remove ${name}`}
									onClick={() => remove.mutate(passkey)}
								>
									<Trans>Remove</Trans>
								</TextAction>
							</li>
						);
					})}
				</ul>
			)}
		</>
	);
}
