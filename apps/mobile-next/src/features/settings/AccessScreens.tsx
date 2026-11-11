// S5 › API keys and S2/S5 › Connected applications: the bearer API lists both and revokes them, so they stay in the
// app. Revoking a key or disconnecting an app is final (no Undo); the dialog says so.
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useState } from "react";
import { useAPIKeyActions, useAPIKeys, useConnectedApps } from "@/data";
import { Dialog, ListRow, PushScreen, RowLink, Text, showToast } from "@/ui";

const shortDate = (locale: string, value: Date | string) =>
	new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(value));

function Note({ text, danger }: { text: string; danger?: boolean }) {
	return (
		<Text variant="ui" color={danger ? "dangerText" : "ink3"} style={{ paddingHorizontal: 24, paddingVertical: 12 }}>
			{text}
		</Text>
	);
}

export function APIKeysScreen() {
	const { i18n } = useLingui();
	const keys = useAPIKeys();
	const actions = useAPIKeyActions();
	const [revoking, setRevoking] = useState<{ id: string; name: string } | null>(null);
	const list = keys.data?.apiKeys ?? [];
	const revoke = (id: string) =>
		void actions
			.delete({ keyId: id })
			.then(() => showToast({ message: t`Key revoked. Apps using it stop working now.` }))
			.catch(() => showToast({ message: t`Couldn't revoke this key. Try again.` }));
	return (
		<PushScreen
			title={t`API keys`}
			overlay={
				<Dialog
					open={!!revoking}
					onClose={() => setRevoking(null)}
					title={t`Revoke this key?`}
					message={t`Apps using it stop working at once. This can't be undone; make a new key if you need one.`}
					actions={[
						{
							label: t`Revoke key`,
							tone: "danger",
							onPress: () => {
								if (revoking) revoke(revoking.id);
								setRevoking(null);
							},
						},
						{ label: t`Cancel`, tone: "secondary", onPress: () => setRevoking(null) },
					]}
				/>
			}
		>
			{keys.isError ? <Note danger text={t`Couldn't load your API keys. Try again.`} /> : null}
			{keys.data && list.length === 0 ? <Note text={t`No keys yet.`} /> : null}
			{list.map((key, i) => {
				const name = key.name || key.start || t`unnamed key`;
				const readOnly = !key.permissions || Object.values(key.permissions).every((p) => p.every((x) => x === "read"));
				const access = readOnly ? t`Read only` : t`Full access`;
				const used = key.lastRequest ? shortDate(i18n.locale, key.lastRequest) : t`Never`;
				return (
					<ListRow
						key={key.id}
						title={name}
						secondary={t`${access} · last used ${used}`}
						trailing={
							<RowLink
								label={t`Revoke`}
								testID={`revoke-${key.id}`}
								onPress={() => setRevoking({ id: key.id, name })}
							/>
						}
						last={i === list.length - 1}
					/>
				);
			})}
		</PushScreen>
	);
}

/** Web's scope descriptions, joined into one line per app. */
function scopeLine(scopes: readonly string[]) {
	const lines: string[] = [];
	if (scopes.includes("api:read"))
		lines.push(t`Read your whole account, including exports and coaching conversations.`);
	if (scopes.includes("api:write")) lines.push(t`Create and change documents, applications and your profile.`);
	if (scopes.includes("api:delete")) lines.push(t`Delete documents and account data.`);
	if (!scopes.some((scope) => scope.startsWith("api:")))
		lines.push(t`Read, change and delete documents and applications (legacy connection).`);
	if (scopes.includes("offline_access")) lines.push(t`Keep access when you are not using the application.`);
	return lines.join(" ");
}

export function ConnectedAppsScreen() {
	const apps = useConnectedApps();
	const actions = useAPIKeyActions();
	const [disconnecting, setDisconnecting] = useState<{ id: string; name: string } | null>(null);
	const list = apps.data?.connections ?? [];
	const name = disconnecting?.name ?? "";
	return (
		<PushScreen
			title={t`Connected applications`}
			overlay={
				<Dialog
					open={!!disconnecting}
					onClose={() => setDisconnecting(null)}
					title={t`Disconnect “${name}”?`}
					message={t`It loses access now. To use it again, connect it from the app. This cannot be undone.`}
					actions={[
						{
							label: t`Disconnect`,
							tone: "danger",
							onPress: () => {
								const target = disconnecting;
								setDisconnecting(null);
								if (!target) return;
								void actions
									.disconnect({ id: target.id })
									.then(() => showToast({ message: t`Disconnected “${target.name}”.` }))
									.catch(() => showToast({ message: t`Couldn't revoke this connection. Try again.` }));
							},
						},
						{ label: t`Cancel`, tone: "secondary", onPress: () => setDisconnecting(null) },
					]}
				/>
			}
		>
			{apps.isError ? <Note danger text={t`Couldn't load connected applications. Try again.`} /> : null}
			{apps.data && list.length === 0 ? (
				<Note text={t`No connected applications. Apps you allow appear here.`} />
			) : null}
			{list.map((app, i) => {
				const appName = app.clientName ?? app.clientId;
				return (
					<ListRow
						key={app.id}
						title={appName}
						secondary={scopeLine(app.scopes)}
						wrapSecondary
						trailing={
							<RowLink
								label={t`Disconnect`}
								testID={`disconnect-${app.id}`}
								onPress={() => setDisconnecting({ id: app.id, name: appName })}
							/>
						}
						last={i === list.length - 1}
					/>
				);
			})}
		</PushScreen>
	);
}
