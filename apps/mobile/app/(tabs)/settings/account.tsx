import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/api/client";
import { getAccountScope } from "@/auth/session";
import { ApiKeys } from "@/features/settings/api-keys";
import { openAccountSettings } from "@/features/settings/browser";
import { ExportDataRow } from "@/features/settings/export";
import { SettingsGroup, SettingsPage } from "@/features/settings/layout";
import { ProfileEditor } from "@/features/settings/profile";
import { useProfile } from "@/features/settings/queries";
import { SignOutRow } from "@/features/settings/sign-out";
import { Banner, Icon, ListRow, Skeleton, showToast, useTheme } from "@/ui";

export default function AccountScreen() {
	const { t } = useLingui();
	const profile = useProfile();
	const queryClient = useQueryClient();
	const { size } = useTheme();
	const scope = getAccountScope();
	const browse = (path: Parameters<typeof openAccountSettings>[0]) => {
		void openAccountSettings(path, scope)
			.then(async (current) => {
				if (!current) return;
				await profile.refetch();
				if (getAccountScope() === scope)
					await queryClient.invalidateQueries({ queryKey: orpc.auth.apiKeys.list.key() });
			})
			.catch(() => {
				if (getAccountScope() === scope) showToast({ message: t`Couldn't open the browser. Try again.` });
			});
	};
	return (
		<SettingsPage
			title={t`Account`}
			onRefresh={() =>
				Promise.allSettled([
					profile.refetch(),
					queryClient.invalidateQueries({ queryKey: orpc.auth.apiKeys.list.key() }),
				])
			}
		>
			{profile.isPending ? <Skeleton height={size.input} /> : null}
			{profile.isError ? (
				<Banner
					tone="danger"
					message={t`Couldn't load your profile.`}
					action={{ label: t`Try again`, onPress: () => void profile.refetch() }}
				/>
			) : null}
			{profile.data ? (
				<>
					<SettingsGroup title={t`Account details`}>
						<ProfileEditor key={profile.data.id} profile={profile.data} />
					</SettingsGroup>
					<SettingsGroup
						title={t`Sign-in & security`}
						note={t`These open your server's account settings in a browser tab inside the app. You may need to sign in there.`}
					>
						<ListRow
							title={t`Email`}
							subtitle={profile.data.email}
							leading="envelope-simple"
							trailing={<Icon name="arrow-square-out" />}
							onPress={() => browse("/dashboard/settings/account#email")}
						/>
						<ListRow
							title={t`Password`}
							leading="password"
							trailing={<Icon name="arrow-square-out" />}
							onPress={() => browse("/dashboard/settings/account#password")}
						/>
						<ListRow
							title={t`Two-step verification`}
							leading="shield-check"
							trailing={<Icon name="arrow-square-out" />}
							onPress={() => browse("/dashboard/settings/account#two-step")}
						/>
						<ListRow
							title={t`Passkeys`}
							leading="fingerprint"
							trailing={<Icon name="arrow-square-out" />}
							onPress={() => browse("/dashboard/settings/account#passkeys")}
						/>
						<ListRow
							title={t`Linked accounts`}
							leading="plugs-connected"
							trailing={<Icon name="arrow-square-out" />}
							onPress={() => browse("/dashboard/settings/account#linked-accounts")}
						/>
					</SettingsGroup>
					<ApiKeys userId={profile.data.id} />
					<SettingsGroup title={t`Your data`}>
						<ExportDataRow />
						<ListRow
							title={t`Delete account`}
							subtitle={t`Permanently removes everything. Opens your browser account settings.`}
							leading="trash"
							destructive
							trailing={<Icon name="arrow-square-out" />}
							onPress={() => browse("/dashboard/settings/account?deleteAccount=true")}
						/>
					</SettingsGroup>
				</>
			) : null}
			<SettingsGroup>
				<SignOutRow />
			</SettingsGroup>
		</SettingsPage>
	);
}
