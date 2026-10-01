import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@reactive-resume/ui/components/button";
import { SettingsSection } from "../section";
import { authClient } from "@/libs/auth/client";

const queryKey = ["auth", "connected-apps"];

export function ConnectedAppsSection() {
	const queryClient = useQueryClient();
	const {
		data: connections = [],
		isPending,
		error,
	} = useQuery({
		queryKey,
		queryFn: async () => {
			const { data, error } = await authClient.oauth2.getConsents();
			if (error) throw new Error(t`Could not load connected applications.`);
			return data ?? [];
		},
	});
	const revoke = useMutation({
		mutationFn: async (id: string) => {
			const { error } = await authClient.oauth2.deleteConsent({ id });
			if (error) throw new Error(t`Could not revoke this connection. Try again.`);
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey }),
	});

	return (
		<SettingsSection
			title={<Trans>Connected applications</Trans>}
			description={<Trans>Revoke an application's access to your account.</Trans>}
		>
			{error || revoke.error ? <p role="alert">{(error ?? revoke.error)?.message}</p> : null}
			{isPending ? (
				<p role="status">
					<Trans>Loading connections...</Trans>
				</p>
			) : connections.length === 0 ? (
				<p className="text-sm text-ink-3">
					<Trans>No connected applications.</Trans>
				</p>
			) : (
				<ul className="divide-y divide-line">
					{connections.map((connection) => (
						<li key={connection.id} className="flex items-center justify-between gap-3 py-3">
							<div className="min-w-0 text-sm">
								<p className="font-medium break-all">{connection.clientId}</p>
								<p className="break-words text-ink-3">{connection.scopes.join(", ")}</p>
							</div>
							<Button
								variant="secondary"
								size="sm"
								disabled={revoke.isPending}
								onClick={() => revoke.mutate(connection.id)}
							>
								<Trans>Revoke access</Trans>
							</Button>
						</li>
					))}
				</ul>
			)}
		</SettingsSection>
	);
}
