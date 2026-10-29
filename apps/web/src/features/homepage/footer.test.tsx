import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingFooter } from "./footer";
import { ThemeProvider } from "@/features/theme/provider";

afterEach(() => vi.unstubAllGlobals());

it("offers direct sign-in alongside account creation in homepage navigation", () => {
	vi.stubGlobal("__APP_VERSION__", "test");
	const router = createRouter({
		routeTree: createRootRoute(),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	i18n.loadAndActivate({ locale: "en-US", messages: {} });

	const html = renderToStaticMarkup(
		<RouterContextProvider router={router}>
			<I18nProvider i18n={i18n}>
				<ThemeProvider theme="light">
					<LandingFooter />
				</ThemeProvider>
			</I18nProvider>
		</RouterContextProvider>,
	);

	expect(html).toMatch(/<a[^>]*href="\/auth\/login"[^>]*>Sign in<\/a>/);
	expect(html).toMatch(/<a[^>]*href="\/auth\/register"[^>]*>Get started<\/a>/);
});
