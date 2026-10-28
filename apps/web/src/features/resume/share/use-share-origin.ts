import { useRouterState } from "@tanstack/react-router";

/** Where shared links point: the app's alias (`APP_ALIAS_URL`) when set, since every public page works there too. */
export function useShareOrigin() {
	const aliasUrl = useRouterState({
		select: (state): string | undefined => state.matches.at(-1)?.context.flags?.aliasUrl,
	});
	// Build-time marketing renders have neither route matches nor a deployment origin.
	return aliasUrl ?? (typeof window === "undefined" ? "" : window.location.origin);
}
