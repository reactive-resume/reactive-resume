import type { orpc } from "@/libs/orpc/client";
import type { Theme } from "@/libs/theme";
import type { IconProps } from "@phosphor-icons/react";
import type { FeatureFlags } from "@reactive-resume/api/features/flags";
import type { AuthSession } from "@reactive-resume/auth/types";
import type { Locale } from "@reactive-resume/utils/locale";
import type { QueryClient } from "@tanstack/react-query";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { I18nProvider, useLingui } from "@lingui/react";
import { IconContext } from "@phosphor-icons/react";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import { createRootRouteWithContext, HeadContent, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { LazyMotion, MotionConfig } from "motion/react";
import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@reactive-resume/ui/components/toast";
import { TooltipProvider } from "@reactive-resume/ui/components/tooltip";
import { isAppSectionPath } from "@reactive-resume/utils/app-paths";
import { isRTL } from "@reactive-resume/utils/locale";
import { BreakpointIndicator } from "@/components/layout/breakpoint-indicator";
import { DialogManager } from "@/dialogs/manager";
import { CommandPalette } from "@/features/command-palette";
import { useDocumentWebMcpTools } from "@/features/documents/webmcp";
import { ThemeProvider } from "@/features/theme/provider";
import { ConfirmDialogProvider } from "@/hooks/use-confirm";
import { loadRootContext } from "@/libs/root-context";
import { getHomepageMeta } from "@/libs/seo";

type RouterContext = {
	theme: Theme;
	locale: Locale;
	orpc: typeof orpc;
	queryClient: QueryClient;
	session: AuthSession | null;
	flags: FeatureFlags;
};

const iconContextValue: IconProps = { size: 16, weight: "regular" };

// Requested now, while the route loads, so animations are ready by the first render without blocking it.
const motionFeatures = import("@/libs/motion-features").then((module) => module.default);
const loadMotionFeatures = () => motionFeatures;

// Shows after five minutes at the earliest, so it loads after everything else.
const DonationToast = lazy(() =>
	import("@/components/ui/donation-toast").then((module) => ({ default: module.DonationToast })),
);

export const Route = createRootRouteWithContext<RouterContext>()({
	component: RootComponent,
	// index.html carries the tags that never change (charset, viewport, icons, manifest); the server adds each page's
	// canonical link, social cards and structured data. The router only keeps the title and description current.
	head: () => {
		const { title, description } = getHomepageMeta();
		return { meta: [{ title }, { name: "description", content: description }] };
	},
	beforeLoad: async ({ context, location, preload }) => {
		const root = await loadRootContext(context.queryClient);
		const { aliasUrl, appUrl } = root.flags;
		// Sign-in and the editor live on APP_URL; the alias (APP_ALIAS_URL) only serves the public pages. The server
		// redirects full page loads; this catches links followed inside the app.
		if (!preload && appUrl && aliasUrl === window.location.origin && isAppSectionPath(location.pathname))
			throw redirect({ href: `${appUrl}${location.href}` });
		return root;
	},
});

function RootComponent() {
	const { theme, locale, queryClient, session } = Route.useRouteContext();
	const dir = isRTL(locale) ? "rtl" : "ltr";

	// WebMCP: browser agents can list and open the signed-in user's documents from any page.
	useDocumentWebMcpTools(session !== null);

	// Suppress the app-wide donation toast inside the builder so it doesn't cover the right-sidebar controls.
	const isBuilder = useRouterState({ select: (s) => s.location.pathname.startsWith("/builder") });

	// The theme class is owned by ThemeProvider, which also follows the system appearance.
	useEffect(() => {
		document.documentElement.lang = locale;
		document.documentElement.dir = dir;
	}, [dir, locale]);

	return (
		<>
			<HeadContent />

			<QueryClientProvider client={queryClient}>
				<MotionConfig reducedMotion="user">
					<LazyMotion features={loadMotionFeatures}>
						<I18nProvider i18n={i18n}>
							<IconContext.Provider value={iconContextValue}>
								<ThemeProvider theme={theme}>
									<HotkeysProvider>
										<DirectionProvider direction={dir}>
											<TooltipProvider>
												<ConfirmDialogProvider>
													<Outlet />

													{!isBuilder && (
														<Suspense>
															<DonationToast />
														</Suspense>
													)}
													<DialogManager />
													<CommandPalette />
													<LocalizedToaster />

													{import.meta.env.DEV && <BreakpointIndicator />}
													{import.meta.env.DEV && (
														<TanStackDevtools
															config={{ position: "bottom-left" }}
															plugins={[
																{
																	name: "TanStack Query",
																	render: <ReactQueryDevtoolsPanel />,
																},
																{
																	name: "TanStack Router",
																	render: <TanStackRouterDevtoolsPanel />,
																},
															]}
														/>
													)}
												</ConfirmDialogProvider>
											</TooltipProvider>
										</DirectionProvider>
									</HotkeysProvider>
								</ThemeProvider>
							</IconContext.Provider>
						</I18nProvider>
					</LazyMotion>
				</MotionConfig>
			</QueryClientProvider>
		</>
	);
}

function LocalizedToaster() {
	useLingui();
	return <Toaster closeLabel={t`Close notification`} />;
}
