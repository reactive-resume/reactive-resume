import { useLingui } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/api/client";
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
	const browse = () => {
		void openAccountSettings()
			.then(async () => {
				await profile.refetch();
				await queryClient.invalidateQueries({ queryKey: orpc.auth.apiKeys.list.key() });
			})
			.catch(() => showToast({ message: t`Couldn't open the browser. Try again.` }));
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
					<SettingsGroup title={t`Profile`}>
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
							onPress={browse}
						/>
						<ListRow
							title={t`Password`}
							leading="password"
							trailing={<Icon name="arrow-square-out" />}
							onPress={browse}
						/>
						<ListRow
							title={t`Two-step verification`}
							leading="shield-check"
							trailing={<Icon name="arrow-square-out" />}
							onPress={browse}
						/>
						<ListRow
							title={t`Passkeys`}
							leading="fingerprint"
							trailing={<Icon name="arrow-square-out" />}
							onPress={browse}
						/>
						<ListRow
							title={t`Linked accounts`}
							leading="plugs-connected"
							trailing={<Icon name="arrow-square-out" />}
							onPress={browse}
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
							onPress={() => {
								void openAccountSettings("/dashboard/settings/account?deleteAccount=true").catch(() =>
									showToast({ message: t`Couldn't open the browser. Try again.` }),
								);
							}}
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
