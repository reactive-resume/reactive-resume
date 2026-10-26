import { useRouteContext } from "@tanstack/react-router";

/** Where shared links point: the app's alias (`APP_ALIAS_URL`) when set, since every public page works there too. */
export function useShareOrigin() {
	const { flags } = useRouteContext({ strict: false });
	return flags?.aliasUrl ?? window.location.origin;
}
