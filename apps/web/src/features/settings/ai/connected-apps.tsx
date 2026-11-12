import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { SettingsSection, TextAction } from "../section";
import { IconTile, ListRow } from "@/components/calm/list-row";
import { useConfirm } from "@/hooks/use-confirm";
import { authClient } from "@/libs/auth/client";

const queryKey = ["auth", "connected-apps"];

export function ConnectedAppsSection() {
	const queryClient = useQueryClient();
	const confirm = useConfirm();
	const { i18n } = useLingui();
	const {
		data: connections = [],
		isPending,
		error,
	} = useQuery({
		queryKey,
		queryFn: async () => {
			const { data, error } = await authClient.oauth2.getConsents();
			if (error) throw new Error(t`Couldn't load connected applications. Refresh the page to try again.`);
			return Promise.all(
				(data ?? []).map(async (connection) => {
					const client = await authClient.oauth2
						.publicClient({ query: { client_id: connection.clientId } })
						.catch(() => null);
					return { ...connection, clientName: client?.data?.client_name?.trim() || connection.clientId };
				}),
			);
		},
	});
	const revoke = useMutation({
		mutationFn: async ({ id }: { id: string; name: string }) => {
			const { error } = await authClient.oauth2.deleteConsent({ id });
			if (error) throw new Error(t`Couldn't revoke this connection. Try again.`);
		},
		onSuccess: async (_, { name }) => {
			toast.add({ type: "success", description: t`Disconnected “${name}”.` });
			await queryClient.invalidateQueries({ queryKey });
		},
	});

	return (
		<SettingsSection id="connected-applications" title={<Trans>Connected applications</Trans>}>
			<p className="pb-1.5 text-[13px]/[18px] text-ink-3">
				<Trans>Apps you allowed by signing in. Disconnecting ends their access at once.</Trans>
			</p>
			{error || revoke.error ? (
				<p role="alert" className="text-[13px]/[18px] text-danger-text">
					{(error ?? revoke.error)?.message}
				</p>
			) : null}
			{isPending ? (
				<p role="status" className="py-4 text-[13px]/[18px] text-ink-3">
					<Trans>Loading connections…</Trans>
				</p>
			) : connections.length === 0 ? (
				<p className="py-4 text-[13px]/[18px] text-ink-3">
					<Trans>Apps you allow appear here.</Trans>
				</p>
			) : (
				<ul className="group/list flex flex-col">
					{connections.map((connection) => {
						const name = connection.clientName;
						const scopes = connection.scopes;
						const others = scopes.filter((scope) => !KNOWN_SCOPES.includes(scope));
						return (
							<ListRow
								key={connection.id}
								render={<li />}
								className="items-start"
								leading={
									<IconTile className="bg-raised shadow-[inset_0_0_0_1px_var(--line)]">
										<Icon name="plugs" />
									</IconTile>
								}
								trailing={
									<TextAction
										className="mt-2.5"
										aria-label={t`Disconnect ${name}`}
										disabled={revoke.isPending}
										onClick={async () => {
											if (
												await confirm(t`Disconnect “${name}”?`, {
													description: t`It loses access now. To use it again, connect it from the app. This cannot be undone.`,
													confirmText: t`Disconnect`,
												})
											)
												revoke.mutate({ id: connection.id, name });
										}}
									>
										<Trans>Disconnect</Trans>
									</TextAction>
								}
							>
								<span className="flex min-w-0 flex-1 flex-col gap-px">
									<span className="text-[15px]/[22px] font-medium break-all text-ink">{name}</span>
									<span className="text-[13px]/[18px] text-ink-3">
										<Permissions scopes={scopes} />
										{others.map((scope) => (
											<Fragment key={scope}>
												{" "}
												<span className="t-mono">{scope}</span>
											</Fragment>
										))}
									</span>
									<span className="text-[13px]/[18px] text-ink-3">
										<Trans>
											Connected {i18n.date(new Date(connection.createdAt), { month: "short", day: "numeric" })}
										</Trans>
										{scopes.includes("offline_access") && (
											<>
												{" · "}
												<Trans>keeps access while you're away</Trans>
											</>
										)}
									</span>
								</span>
							</ListRow>
						);
					})}
				</ul>
			)}
		</SettingsSection>
	);
}

const KNOWN_SCOPES = ["openid", "profile", "email", "offline_access", "api:read", "api:write", "api:delete"];

/** What a connection may do, as one or two sentences, including what it can't. */
function Permissions({ scopes }: { scopes: string[] }) {
	const read = scopes.includes("api:read");
	const write = scopes.includes("api:write");
	const remove = scopes.includes("api:delete");
	// Identity-only grants retain account-wide permissions in the API bearer resolver.
	if (!scopes.some((scope) => scope.startsWith("api:")))
		return <Trans>Read, change and delete documents and applications (legacy connection).</Trans>;
	if (read && write && remove)
		return (
			<Trans>
				Can read your whole account, create and change documents, applications and your profile, and delete them.
			</Trans>
		);
	if (read && write)
		return (
			<Trans>
				Can read your whole account, and create and change documents, applications and your profile. Can't delete.
			</Trans>
		);
	if (read && !remove)
		return (
			<Trans>
				Can read your whole account, including exports and coaching conversations. Can't change or delete anything.
			</Trans>
		);
	return (
		<>
			{read && <Trans>Read your whole account, including exports and coaching conversations.</Trans>}{" "}
			{write && <Trans>Create and change documents, applications and your profile.</Trans>}{" "}
			{remove && <Trans>Delete documents and account data.</Trans>}
		</>
	);
}
