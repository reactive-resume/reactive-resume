import type { AuthSession } from "@reactive-resume/auth/types";
import type { QueryClient } from "@tanstack/react-query";
import { getSession } from "./auth/session";
import { getLocale, loadLocale } from "./locale";
import { client } from "./orpc/client";
import { getTheme } from "./theme";

export const sessionQueryKey = ["auth", "session"] as const;
const flagsQueryKey = ["flags"] as const;

// Root beforeLoad runs on every navigation and every hover preload, so the network reads come from the query cache.
// A signed-in session is reused for a minute; a signed-out one is always re-checked, so signing in elsewhere shows up
// on the next navigation. Anything that signs in, signs out or edits the profile invalidates `sessionQueryKey` before
// calling `router.invalidate()`. Flags come from server env and only change on a restart.
export async function loadRootContext(queryClient: QueryClient) {
	const theme = getTheme();
	const locale = getLocale();

	const sessionPromise = queryClient
		.query({
			queryKey: sessionQueryKey,
			queryFn: getSession,
			staleTime: (query) => (query.state.data ? 60_000 : 0),
		})
		.catch((error: unknown) => {
			const cached = queryClient.getQueryData<AuthSession | null>(sessionQueryKey);
			if (cached) {
				console.warn("[session] Failed to refresh session, retaining cached session:", error);
				return cached;
			}
			throw error;
		});

	const [session, flags] = await Promise.all([
		sessionPromise,
		queryClient.query({ queryKey: flagsQueryKey, queryFn: () => client.flags.get(), staleTime: 5 * 60_000 }),
		loadLocale(locale),
	]);

	return { theme, locale, session, flags };
}
