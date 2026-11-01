import { useLingui } from "@lingui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { isLocale } from "@reactive-resume/utils/locale";
import { client, orpc } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";

/**
 * The account's language follows the interface it was last used in, the same as on the web, so account emails
 * (password reset, email change) arrive in it. A server from before accounts had a language reports none; nothing is
 * sent to it.
 */
export function useAccountLocale() {
	const { i18n } = useLingui();
	const session = useSession();
	const scope = getAccountScope();
	const queryClient = useQueryClient();
	const profile = useQuery(
		orpc.auth.getProfile.queryOptions({
			queryKey: [...orpc.auth.getProfile.key(), scope],
			context: { scope: scope ?? undefined },
			enabled: session.status === "signed-in" && scope !== null,
			retry: false,
		}),
	);
	const saved = profile.data && "locale" in profile.data ? profile.data.locale : undefined;
	const locale = i18n.locale;

	useEffect(() => {
		if (!scope || getAccountScope() !== scope || saved === undefined || saved === locale || !isLocale(locale)) return;
		// Best effort: an account email falls back to English.
		client.auth
			.updateProfile({ locale }, { context: { scope } })
			.then(() => {
				if (getAccountScope() === scope)
					return queryClient.invalidateQueries({ queryKey: [...orpc.auth.getProfile.key(), scope] });
			})
			.catch(() => undefined);
	}, [scope, saved, locale, queryClient]);
}
