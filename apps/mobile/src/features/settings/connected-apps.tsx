import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Animated from "react-native-reanimated";
import { SettingsGroup } from "./layout";
import { client, orpc } from "@/api/client";
import { getClientId } from "@/auth/oauth";
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

/** The same plain-language permission lines the web settings use, without repeating profile and email when the whole account is readable. */
function useScopeLines() {
	const { t } = useLingui();
	return (scopes: string[]) => {
		const api = scopes.some((scope) => scope.startsWith("api:"));
		return [
			...(scopes.includes("api:read")
				? [t`Read your whole account, including exports and coaching conversations.`]
				: []),
			...(scopes.includes("api:write") ? [t`Create and change documents, applications and your profile.`] : []),
			...(scopes.includes("api:delete") ? [t`Delete documents and account data.`] : []),
			...(api ? [] : [t`Read, change and delete documents and applications (legacy connection).`]),
			...(!scopes.includes("api:read") && scopes.includes("profile") ? [t`Read your profile information.`] : []),
			...(!scopes.includes("api:read") && scopes.includes("email") ? [t`Read your email address.`] : []),
			...(scopes.includes("offline_access") ? [t`Keep access when you are not using the application.`] : []),
		];
	};
}

/** Applications allowed through OAuth, each with what it can do and Disconnect. This app's own sign-in is marked. */
export function ConnectedApps() {
	const { t, i18n } = useLingui();
	const { server } = useSession();
	const queryClient = useQueryClient();
	const scopeLines = useScopeLines();
	const [selected, setSelected] = useState<{ id: string; name: string } | null>(null);
	const connections = useQuery(
		orpc.auth.connections.list.queryOptions({ queryKey: [...orpc.auth.connections.list.key(), server], retry: false }),
	);
	const ownClient = useQuery({ queryKey: ["auth", "own-client", server], queryFn: () => getClientId(server) });
	const firstAppearance = useFirstAppearance(!connections.isPending);
	const disconnect = useMutation({
		mutationKey: ["settings", "disconnect-app"],
		mutationFn: (id: string) => client.auth.connections.delete({ id }),
		onSuccess: (_, id) => {
			const name = selected?.id === id ? selected.name : "";
			setSelected(null);
			showToast({ message: name ? t`Disconnected “${name}”.` : t`Application disconnected.` });
			void queryClient.invalidateQueries({ queryKey: orpc.auth.connections.list.key() });
		},
		onError: () => {
			setSelected(null);
			showToast({ message: t`Couldn't revoke this connection. Try again.` });
		},
	});
	const list = connections.data?.connections ?? [];
	return (
		<SettingsGroup title={t`Connected applications`} note={t`Disconnect an application from your account.`}>
			{connections.isPending ? <ListRow title={t`Loading connections...`} /> : null}
			{connections.isError ? (
				<Banner
					tone="danger"
					message={t`Couldn't load connected applications.`}
					action={{
						label: t`Try again`,
						onPress: () => {
							void connections.refetch();
							void ownClient.refetch();
						},
					}}
				/>
			) : null}
			{connections.isSuccess && list.length === 0 ? (
				<EmptyState title={t`No connected applications. Apps you allow appear here.`} />
			) : null}
			{list.map((connection, index) => {
				const name = connection.clientName?.trim() || connection.clientId;
				// Disconnecting this app here would sign it out mid-tap; sign out from Settings instead.
				// Labelled "this app" only on a match; until the lookup succeeds no row offers Disconnect, since any could be it.
				const own = ownClient.data === connection.clientId;
				const canDisconnect = ownClient.isSuccess && !own;
				const connected = connection.createdAt
					? t`Connected ${i18n.date(connection.createdAt, { dateStyle: "medium" })}`
					: null;
				return (
					<Animated.View key={connection.id} {...listItemMotion(index, firstAppearance)} layout={listLayout}>
						<ListRow
							title={own ? t`${name} (this app)` : name}
							subtitle={[...scopeLines(connection.scopes), ...(connected ? [connected] : [])].join("\n")}
							leading="plugs-connected"
							trailing={canDisconnect ? <Text color="dangerText">{t`Disconnect`}</Text> : undefined}
							accessibilityHint={canDisconnect ? t`Disconnect ${name}` : undefined}
							disabled={canDisconnect && disconnect.isPending}
							onPress={canDisconnect ? () => setSelected({ id: connection.id, name }) : undefined}
						/>
					</Animated.View>
				);
			})}
			<ConfirmDialog
				open={selected !== null}
				title={t`Disconnect “${selected?.name ?? ""}”?`}
				message={t`It loses access now. To use it again, connect it from the app. This cannot be undone.`}
				confirmLabel={t`Disconnect`}
				destructive
				onCancel={() => setSelected(null)}
				onConfirm={() => {
					if (selected && !disconnect.isPending) disconnect.mutate(selected.id);
				}}
			/>
		</SettingsGroup>
	);
}
