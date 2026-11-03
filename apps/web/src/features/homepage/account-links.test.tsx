// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRouter,
	RouterContextProvider,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { LandingHeader } from "./header";
import { Closing } from "./sections";
import { CtaLink } from "./ui";
import { loadLocale } from "@/libs/locale";

afterEach(cleanup);

async function fixture(signedIn: boolean, load = true) {
	await loadLocale("en-US");
	const root = createRootRouteWithContext<{ session: { user: { id: string } } | null }>()();
	const router = createRouter({
		routeTree: root,
		history: createMemoryHistory({ initialEntries: ["/"] }),
		context: { session: signedIn ? { user: { id: "fictional-account" } } : null },
	});
	if (load) await router.load();
	return (
		<RouterContextProvider router={router}>
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { enabled: false } } })}>
				<I18nProvider i18n={i18n}>
					<LandingHeader />
					<CtaLink size="hero" />
					<Closing />
				</I18nProvider>
			</QueryClientProvider>
		</RouterContextProvider>
	);
}

it("offers returning visitors direct sign-in beside header and closing registration actions", async () => {
	render(await fixture(false));
	for (const link of screen.getAllByRole("link", { name: "Sign in" })) {
		expect(link.getAttribute("href")).toBe("/auth/login");
	}
	expect(screen.getAllByRole("link", { name: "Sign in" })).toHaveLength(2);
	expect(screen.getAllByRole("link", { name: "Build your resume" })).toHaveLength(3);
});

it("takes signed-in visitors from every main CTA directly to their dashboard", async () => {
	render(await fixture(true));
	const links = screen.getAllByRole("link", { name: "Go to dashboard" });
	expect(links).toHaveLength(3);
	for (const link of links) expect(link.getAttribute("href")).toBe("/dashboard");
	expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
	expect(screen.queryByRole("link", { name: "Build your resume" })).toBeNull();
});

it("keeps build-time prerender anonymous before any route is matched", async () => {
	const html = renderToString(await fixture(true, false));
	expect(html).toContain('href="/auth/register"');
	expect(html).toContain('href="/auth/login"');
	expect(html).not.toContain('href="/dashboard"');
	expect(html).not.toContain("fictional-account");
});
