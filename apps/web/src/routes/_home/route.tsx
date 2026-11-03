import { Trans } from "@lingui/react/macro";
import { createFileRoute, Outlet, useMatch } from "@tanstack/react-router";
import { MarketingLayout } from "@/features/homepage/marketing-layout";

export const Route = createFileRoute("/_home")({
	component: RouteComponent,
});

function RouteComponent() {
	const rootMatch = useMatch({ from: "/_home/", shouldThrow: false });
	const rootMode = rootMatch?.loaderData?.root.status;
	// The homepage ships its own header and skip link; the shared ones are for the other marketing pages.
	const isHomepage = rootMatch !== undefined && (!rootMode || rootMode === "disabled");
	if (!rootMatch)
		return (
			<MarketingLayout>
				<Outlet />
			</MarketingLayout>
		);
	return (
		<>
			{!isHomepage && (
				<a
					href="#main-content"
					className="sr-only focus:not-sr-only focus:fixed focus:inset-s-4 focus:top-4 focus:z-100 focus:rounded-md focus:bg-bg focus:px-4 focus:py-2 focus:text-ink focus:shadow-lg focus:ring-2 focus:ring-accent"
				>
					<Trans>Skip to main content</Trans>
				</a>
			)}
			<Outlet />
		</>
	);
}
