import { useLingui } from "@lingui/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { I18nManager } from "react-native";
import { isLocale, isRTL } from "@reactive-resume/utils/locale";
import { client, orpc } from "@/api/client";
import { getAccountScope, getSession, useSession } from "@/auth/session";
import { activateLocale, getDeviceLocale, hasLocalePreference, selectableLocales } from "@/i18n";

/**
 * Restore the account language on an unconfigured device. Explicit local choices win and update account emails;
 * a server from before accounts had a language reports none and receives no write.
 */
export function useAccountLocale() {
	const { i18n } = useLingui();
	const session = useSession();
	const [dismissed, setDismissed] = useState<{ session: typeof session; locale: string } | null>(null);
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
	const explicit = hasLocalePreference();

	useEffect(() => {
		if (!explicit) {
			let active = true;
			const current = () => active && getSession() === session && getAccountScope() === scope && !hasLocalePreference();
			const target =
				session.status === "signed-in" && scope && isLocale(saved) && selectableLocales.includes(saved)
					? saved
					: getDeviceLocale();
			if (target !== locale) void activateLocale(target, current).catch(() => undefined);
			return () => {
				active = false;
			};
		}
		if (!scope || getAccountScope() !== scope || saved === undefined || saved === locale || !isLocale(locale)) return;
		// Best effort: an account email falls back to English.
		client.auth
			.updateProfile({ locale }, { context: { scope } })
			.then(() => {
				if (getAccountScope() === scope)
					return queryClient.invalidateQueries({ queryKey: [...orpc.auth.getProfile.key(), scope] });
			})
			.catch(() => undefined);
	}, [scope, saved, locale, queryClient, explicit, session]);

	return {
		restart:
			!explicit &&
			isRTL(locale) !== I18nManager.isRTL &&
			(dismissed?.session !== session || dismissed.locale !== locale),
		dismissRestart: () => setDismissed({ session, locale }),
	};
}
