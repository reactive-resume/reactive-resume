import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { Share } from "./share";

afterEach(() => vi.unstubAllGlobals());

describe("landing share address", () => {
	it.each([
		{ origin: "https://rxresu.me", aliasUrl: "https://rx.cv", address: "rx.cv/alex-morgan" },
		{ origin: "https://resume.example.com", aliasUrl: undefined, address: "resume.example.com/alex-morgan" },
		{ origin: "http://localhost:3000", aliasUrl: undefined, address: "localhost:3000/alex-morgan" },
	])("shows $address", async ({ origin, aliasUrl, address }) => {
		vi.stubGlobal("window", { location: { origin } });
		const router = createRouter({
			routeTree: createRootRoute({ beforeLoad: () => ({ flags: { aliasUrl } }) }),
			history: createMemoryHistory({ initialEntries: ["/"] }),
		});
		await router.load();
		i18n.loadAndActivate({ locale: "en-US", messages: {} });

		const html = renderToStaticMarkup(
			<RouterContextProvider router={router}>
				<I18nProvider i18n={i18n}>
					<Share />
				</I18nProvider>
			</RouterContextProvider>,
		);

		expect(html).toContain(`<span class="sr-only">${address}</span>`);
	});

	it("falls back to rxresu.me when prerendering without deployment configuration", () => {
		const router = createRouter({
			routeTree: createRootRoute(),
			history: createMemoryHistory({ initialEntries: ["/"] }),
		});
		i18n.loadAndActivate({ locale: "en-US", messages: {} });

		const html = renderToStaticMarkup(
			<RouterContextProvider router={router}>
				<I18nProvider i18n={i18n}>
					<Share />
				</I18nProvider>
			</RouterContextProvider>,
		);

		expect(html).toContain('<span class="sr-only">rxresu.me/alex-morgan</span>');
	});
});
