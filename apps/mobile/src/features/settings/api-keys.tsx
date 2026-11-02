import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Animated from "react-native-reanimated";
import { openAccountSettings } from "./browser";
import { SettingsGroup } from "./layout";
import { client, orpc } from "@/api/client";
import { useSession } from "@/auth/session";
import {
	Banner,
	ConfirmDialog,
	EmptyState,
	ListRow,
	Text,
	listItemMotion,
	listLayout,
	showToast,
	useFirstAppearance,
} from "@/ui";

type ApiKeysProps = { userId: string };
export function ApiKeys({ userId }: ApiKeysProps) {
	const { t, i18n } = useLingui();
	const { server } = useSession();
	const queryClient = useQueryClient();
	const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
	const keys = useQuery(
		orpc.auth.apiKeys.list.queryOptions({ queryKey: [...orpc.auth.apiKeys.list.key(), server, userId], retry: false }),
	);
	const firstAppearance = useFirstAppearance(!keys.isPending);
	const revoke = useMutation({
		mutationKey: ["settings", "revoke-key"],
		mutationFn: async (keyId: string) => {
			const result = await client.auth.apiKeys.delete({ keyId });
			if (!result.success) throw new Error("Key revocation rejected");
		},
		onSuccess: () => {
			setSelected(null);
			showToast({ message: t`API key revoked. Apps using it stop working now.` });
			void queryClient.invalidateQueries({ queryKey: orpc.auth.apiKeys.list.key() });
		},
		onError: () => {
			setSelected(null);
			showToast({ message: t`Couldn't revoke the key. Try again.` });
		},
	});
	const date = (value: Date | null) => (value ? i18n.date(value, { dateStyle: "medium" }) : t`Never`);
	return (
		<SettingsGroup
			title={t`API keys`}
			note={t`New keys start read-only. Create keys in your browser account settings.`}
		>
			<ListRow
				title={t`New API key`}
				leading="arrow-square-out"
				onPress={() => {
					void openAccountSettings("/dashboard/settings/ai")
						.then(() => keys.refetch())
						.catch(() => showToast({ message: t`Couldn't open the browser. Try again.` }));
				}}
			/>
			{keys.isPending ? <ListRow title={t`Loading API keys…`} /> : null}
			{keys.isError ? (
				<Banner
					tone="danger"
					message={t`Couldn't load API keys.`}
					action={{ label: t`Try again`, onPress: () => void keys.refetch() }}
				/>
			) : null}
			{keys.data?.apiKeys.length === 0 ? <EmptyState title={t`No keys yet.`} /> : null}
			{keys.data?.apiKeys.map((key, index) => (
				<Animated.View key={key.id} {...listItemMotion(index, firstAppearance)} layout={listLayout}>
					<ListRow
						title={key.name ?? t`Unnamed key`}
						subtitle={t`Created ${date(key.createdAt)} · Last used ${date(key.lastRequest)} · Expires ${date(key.expiresAt)}`}
						leading="key"
						trailing={<Text color="dangerText">{t`Revoke`}</Text>}
						accessibilityHint={t`Revoke this API key`}
						disabled={revoke.isPending}
						onPress={() => setSelected({ id: key.id, name: key.name ?? t`Unnamed key` })}
					/>
				</Animated.View>
			))}
			<ConfirmDialog
				open={selected !== null}
				title={t`Revoke API key?`}
				message={t`Apps using “${selected?.name ?? ""}” will stop working. This can't be undone.`}
				confirmLabel={t`Revoke key`}
				destructive
				onCancel={() => setSelected(null)}
				onConfirm={() => {
					if (selected && !revoke.isPending) revoke.mutate(selected.id);
				}}
			/>
		</SettingsGroup>
	);
}
