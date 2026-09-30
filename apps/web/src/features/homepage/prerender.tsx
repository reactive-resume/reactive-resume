/**
 * Renders the public marketing pages, the landing page and the ATS checker, to HTML, one file per locale, at build time
 * (see `prerenderPages` in vite.config.ts). The server sends the file for the visitor's locale, so every heading and
 * paragraph is in the first response and the page paints before any JavaScript runs; React renders the live page in
 * its place once the route has loaded.
 */
import type { IconProps } from "@phosphor-icons/react";
import type { Locale } from "@reactive-resume/utils/locale";
import type { ReactNode } from "react";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { IconContext } from "@phosphor-icons/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { isRTL, localeSchema } from "@reactive-resume/utils/locale";
import { Homepage } from "./page";
import { AtsCheckerPage } from "@/features/ats-checker/page";
import { ThemeProvider } from "@/features/theme/provider";
import { getLocaleMessages } from "@/libs/locale";
import { getAtsCheckerMeta, getHomepageMeta } from "@/libs/seo";
import { Header } from "@/routes/_home/-sections/header";

export const locales = localeSchema.options;

// Matches the root route's icon defaults (routes/__root.tsx), which the marketing header's icons inherit.
const iconContextValue: IconProps = { size: 16, weight: "regular" };

const pages = {
	home: { path: "/", meta: getHomepageMeta, render: () => <Homepage /> },
	// What the /_home layout renders around the checker for a signed-out visitor (routes/_home/route.tsx).
	"ats-checker": {
		path: "/ats-checker",
		meta: getAtsCheckerMeta,
		render: () => (
			<>
				<Header />
				<AtsCheckerPage signedIn={false} importPending={false} />
			</>
		),
	},
} satisfies Record<
	string,
	{ path: string; meta: () => { title: string; description: string }; render: () => ReactNode }
>;

type PrerenderedPage = keyof typeof pages;
export const prerenderedPages = Object.keys(pages) as PrerenderedPage[];

export async function renderPage(name: PrerenderedPage, locale: Locale) {
	const page = pages[name];
	const { messages } = await getLocaleMessages(locale);
	i18n.loadAndActivate({ locale, messages });

	// Links only need a router to build their hrefs; nothing is loaded or navigated.
	const router = createRouter({
		routeTree: createRootRoute(),
		history: createMemoryHistory({ initialEntries: [page.path] }),
	});
	const dir = isRTL(locale) ? "rtl" : "ltr";

	const html = renderToString(
		<RouterContextProvider router={router}>
			<QueryClientProvider client={new QueryClient()}>
				<I18nProvider i18n={i18n}>
					<IconContext.Provider value={iconContextValue}>
						<ThemeProvider theme="system">
							<DirectionProvider direction={dir}>{page.render()}</DirectionProvider>
						</ThemeProvider>
					</IconContext.Provider>
				</I18nProvider>
			</QueryClientProvider>
		</RouterContextProvider>,
	);

	return { html, dir, ...page.meta() };
}
