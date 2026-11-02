import type { AuthSession } from "@reactive-resume/auth/types";
import type { QueryClient } from "@tanstack/react-query";
import { setAccountScope } from "./auth/account-scope";
import { getSession } from "./auth/session";
import { getLocale, loadLocale } from "./locale";
import { client } from "./orpc/client";
import { getTheme } from "./theme";

export const sessionQueryKey = ["auth", "session"] as const;

// The account's language follows the interface it was last used in, so its emails (password reset, email change)
// arrive in that language. A different account, session or interface language needs its own check.
let accountLocaleCheck: { userId: string; sessionId: string; locale: string } | null = null;
const flagsQueryKey = ["flags"] as const;
// Each root load is numbered. A load that finishes after a newer one must not certify its older session: a hover
// preload started as the previous account cannot relabel the live page after the browser moved on.
let rootLoadSequence = 0;

type RootLoadOptions = {
	/** Only a committed route (not a hover preload) may certify the account this tab renders for. */
	commit?: boolean;
};

// Root beforeLoad runs on every navigation and every hover preload, so the network reads come from the query cache.
// A signed-in session is reused for a minute; a signed-out one is always re-checked, so signing in elsewhere shows up
// on the next navigation. Anything that signs in, signs out or edits the profile invalidates `sessionQueryKey` before
// calling `router.invalidate()`. Flags come from server env and only change on a restart.
export async function loadRootContext(queryClient: QueryClient, options: RootLoadOptions = {}) {
	const load = options.commit === false ? rootLoadSequence : ++rootLoadSequence;
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
	// A preload only prepares a future navigation; a stale completion has already been overtaken. Neither may adopt
	// an account scope, because the page on screen still belongs to the session it was rendered for.
	const current = queryClient.getQueryData<AuthSession | null>(sessionQueryKey);
	const committed = load === rootLoadSequence && options.commit !== false;
	if (committed) setAccountScope(session?.user.id ?? null);
	if (committed && !session) accountLocaleCheck = null;
	if (
		committed &&
		session &&
		!session.user.isAnonymous &&
		current?.user.id === session.user.id &&
		current.session.id === session.session.id &&
		(accountLocaleCheck?.userId !== session.user.id ||
			accountLocaleCheck.sessionId !== session.session.id ||
			accountLocaleCheck.locale !== locale)
	) {
		const check = { userId: session.user.id, sessionId: session.session.id, locale };
		accountLocaleCheck = check;
		if (session.user.locale !== locale) {
			const retry = () => {
				if (accountLocaleCheck === check) accountLocaleCheck = null;
			};
			void client.auth.updateProfile({ locale }, { context: { accountId: session.user.id } }).then((result) => {
				if (!result.status) retry();
			}, retry);
		}
	}

	return { theme, locale, session, flags };
}
