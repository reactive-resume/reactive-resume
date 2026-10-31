import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@reactive-resume/ui/components/button";
import { toast } from "@reactive-resume/ui/components/toast";
import { SettingsSection } from "../section";
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
		<SettingsSection
			title={<Trans>Connected applications</Trans>}
			description={<Trans>Disconnect an application from your account.</Trans>}
		>
			{error || revoke.error ? <p role="alert">{(error ?? revoke.error)?.message}</p> : null}
			{isPending ? (
				<p role="status">
					<Trans>Loading connections...</Trans>
				</p>
			) : connections.length === 0 ? (
				<p className="text-sm text-ink-3">
					<Trans>No connected applications. Apps you allow appear here.</Trans>
				</p>
			) : (
				<ul className="divide-y divide-line">
					{connections.map((connection) => (
						<li key={connection.id} className="flex items-center justify-between gap-3 py-3">
							<div className="min-w-0 text-sm">
								<p className="font-medium break-all">{connection.clientName}</p>
								<ul className="space-y-1 text-ink-3">
									{connection.scopes.includes("api:read") && (
										<li>
											<Trans>Read your whole account, including exports and coaching conversations.</Trans>
										</li>
									)}
									{connection.scopes.includes("api:write") && (
										<li>
											<Trans>Create and change documents, applications and your profile.</Trans>
										</li>
									)}
									{connection.scopes.includes("api:delete") && (
										<li>
											<Trans>Delete documents and account data.</Trans>
										</li>
									)}
									{!connection.scopes.some((scope) => scope.startsWith("api:")) && (
										<li>
											<Trans>Read, change and delete documents and applications (legacy connection).</Trans>
										</li>
									)}
									{connection.scopes.includes("profile") && (
										<li>
											<Trans>Read your profile information.</Trans>
										</li>
									)}
									{connection.scopes.includes("email") && (
										<li>
											<Trans>Read your email address.</Trans>
										</li>
									)}
									{connection.scopes.includes("offline_access") && (
										<li>
											<Trans>Keep access when you are not using the application.</Trans>
										</li>
									)}
								</ul>
								<p className="text-ink-3">
									<Trans>Connected {i18n.date(new Date(connection.createdAt), { dateStyle: "medium" })}</Trans>
								</p>
							</div>
							<Button
								variant="ghost"
								size="sm"
								className="text-danger-text"
								aria-label={t`Disconnect ${connection.clientName}`}
								disabled={revoke.isPending}
								onClick={async () => {
									const name = connection.clientName;
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
							</Button>
						</li>
					))}
				</ul>
			)}
		</SettingsSection>
	);
}
