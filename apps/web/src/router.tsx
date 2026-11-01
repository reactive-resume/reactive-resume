import { createRouter } from "@tanstack/react-router";
import { followStageWrites } from "@reactive-resume/schema/applications/stage-baselines";
import { ErrorScreen } from "./components/layout/error-screen";
import { LoadingScreen } from "./components/layout/loading-screen";
import { NotFoundScreen } from "./components/layout/not-found-screen";
import { listedApplication, STAGE_SCOPE } from "./features/applications/use-application-actions";
import { registerAccountReset } from "./libs/auth/account-scope";
import { clearAccountState, syncAccountDataAcrossTabs } from "./libs/auth/clear-account-data";
import { orpc } from "./libs/orpc/client";
import { getQueryClient } from "./libs/query/client";
import { loadRootContext } from "./libs/root-context";
import { routeTree } from "./routeTree.gen";

// A pathname change fades the page (styles in index.css). Search-param and hash changes (filters, views, editor
// modes), the first load, and browsers without view-transition types swap instantly.
const supportsTransitionTypes = globalThis.CSS?.supports?.("selector(:active-view-transition-type(a))") === true;

export const getRouter = async () => {
	const queryClient = getQueryClient();
	// A bulk move chosen while a single stage change is on its way starts from what that change saved.
	followStageWrites(
		queryClient,
		() => STAGE_SCOPE,
		(id) => listedApplication(queryClient, id),
	);
	// A root load that discovers another account drops this account's cached data before adopting the new identity.
	registerAccountReset(() => clearAccountState(queryClient));
	syncAccountDataAcrossTabs(queryClient);

	const { theme, locale, session, flags } = await loadRootContext(queryClient);

	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		defaultStructuralSharing: true,
		defaultViewTransition: supportsTransitionTypes && {
			types: ({ fromLocation, pathChanged }) => (fromLocation && pathChanged ? ["page"] : false),
		},
		// Hovering a link starts its loaders; TanStack Query decides freshness, not the router's preload cache.
		defaultPreload: "intent",
		defaultPreloadStaleTime: 0,
		// Past 300ms a navigation shows the loader, held long enough (300ms) for its 200ms fade-in to land.
		defaultPendingMs: 300,
		defaultPendingMinMs: 300,
		defaultErrorComponent: ErrorScreen,
		defaultPendingComponent: LoadingScreen,
		defaultNotFoundComponent: NotFoundScreen,
		context: { orpc, queryClient, theme, locale, session, flags },
	});

	return router;
};
