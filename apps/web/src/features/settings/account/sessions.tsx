import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { SettingsRow, subRowClassName, subRowsClassName, TextAction } from "../section";
import { authClient } from "@/libs/auth/client";
import { getReadableErrorMessage } from "@/libs/error-message";

const SESSIONS_KEY = ["auth", "sessions"];

/** "Chrome on macOS" from a user agent, or null when it names neither. */
function describeAgent(agent: string | null | undefined): string | null {
	if (!agent) return null;
	const browser = /Edg\//.test(agent)
		? "Edge"
		: /Firefox\//.test(agent)
			? "Firefox"
			: /Chrome\//.test(agent)
				? "Chrome"
				: /Safari\//.test(agent)
					? "Safari"
					: null;
	const system = /iPhone|iPad/.test(agent)
		? "iOS"
		: /Android/.test(agent)
			? "Android"
			: /Mac OS X|Macintosh/.test(agent)
				? "macOS"
				: /Windows/.test(agent)
					? "Windows"
					: /Linux/.test(agent)
						? "Linux"
						: null;
	if (browser && system) return t`${browser} on ${system}`;
	return browser ?? system;
}

/** Where this account is signed in: one row that opens the devices, newest first, each but this one with Sign out. */
export function SessionsRow() {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const { data: current } = authClient.useSession();
	// Links to `#sessions` (the phone apps use it) land on the opened list.
	const [open, setOpen] = useState(() => window.location.hash === "#sessions");
	const { data: sessions = [] } = useQuery({
		queryKey: SESSIONS_KEY,
		queryFn: async () => {
			const { data } = await authClient.listSessions();
			return [...(data ?? [])].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
		},
	});
	const revoke = useMutation({
		mutationFn: async (token: string) => {
			const { error } = await authClient.revokeSession({ token });
			if (error) throw error;
		},
		onSuccess: () => {
			toast.add({ type: "success", description: t`Signed out of that device.` });
			void queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
		},
		onError: (error) =>
			toast.add({
				type: "error",
				description: getReadableErrorMessage(error, t`Couldn't sign out of that device. Try again.`),
			}),
	});

	if (sessions.length === 0) return null;
	const count = sessions.length;
	return (
		<>
			<SettingsRow
				id="sessions"
				title={<Trans>Sessions</Trans>}
				description={
					open ? (
						<Trans>Devices signed in to your account</Trans>
					) : (
						plural(count, { one: "# device · this one", other: "# devices signed in to your account" })
					)
				}
			>
				{!open && (
					<TextAction aria-label={t`Manage sessions`} onClick={() => setOpen(true)}>
						<Trans>Manage</Trans>
					</TextAction>
				)}
			</SettingsRow>
			{open && (
				<ul className={subRowsClassName}>
					{sessions.map((session) => {
						const here = session.token === current?.session.token;
						const name = describeAgent(session.userAgent) ?? t`Unknown device`;
						const active = i18n.date(new Date(session.updatedAt), { dateStyle: "medium", timeStyle: "short" });
						const phone = /iPhone|iPad|Android/.test(session.userAgent ?? "");
						return (
							<li key={session.id} className={subRowClassName}>
								<Icon name={phone ? "device-mobile" : "desktop"} size={18} className="text-ink-2" />
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="truncate font-medium">{name}</span>
									<span className="text-[13px]/[18px] text-ink-3">
										{here ? <Trans>This device · last active {active}</Trans> : <Trans>Last active {active}</Trans>}
									</span>
								</span>
								{here ? null : (
									<TextAction
										disabled={revoke.isPending}
										aria-label={t`Sign out of ${name}`}
										onClick={() => revoke.mutate(session.token)}
									>
										<Trans>Sign out</Trans>
									</TextAction>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</>
	);
}
