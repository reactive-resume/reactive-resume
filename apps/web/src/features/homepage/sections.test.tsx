import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://localhost:3000"}
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from "@tanstack/react-router";
import Cookies from "js-cookie";
import { supportedLocales } from "@reactive-resume/utils/locale";
import { LandingHeader } from "./header";
import { Languages } from "./sections";
import { CtaLink } from "./ui";
import { getLocale, loadLocale } from "@/libs/locale";

afterEach(() => {
	cleanup();
	Cookies.remove("locale");
	vi.restoreAllMocks();
	window.history.replaceState(null, "", "/");
});

it("lists every language by its own name as links that keep the address and the choice through registration", async () => {
	window.history.replaceState({ key: "homepage" }, "", "/?campaign=audit#languages");
	const user = userEvent.setup();
	const router = createRouter({
		routeTree: createRootRoute(),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	await loadLocale("en-US");
	const queryClient = new QueryClient({ defaultOptions: { queries: { enabled: false } } });

	const view = () => (
		<RouterContextProvider router={router}>
			<QueryClientProvider client={queryClient}>
				<I18nProvider i18n={i18n}>
					<LandingHeader />
					<Languages />
					<CtaLink size="hero" />
				</I18nProvider>
			</QueryClientProvider>
		</RouterContextProvider>
	);
	const { unmount } = render(view());

	const index = screen.getByRole("navigation", { name: "Speaks your language" });
	const links = within(index).getAllByRole("link");
	expect(links).toHaveLength(supportedLocales.length - 1);
	expect(within(index).getByText("American English").getAttribute("aria-current")).toBe("page");
	const german = within(index).getByRole("link", { name: "Deutsch" });
	expect(german.getAttribute("href")).toBe("/?campaign=audit&locale=de-DE#languages");
	expect(german.getAttribute("hreflang")).toBe("de-DE");
	expect(german.getAttribute("lang")).toBe("de-DE");
	expect(german.getAttribute("title")).toBe("German");
	const arabic = within(index).getByRole("link", { name: "العربية" });
	expect(arabic.getAttribute("dir")).toBe("rtl");
	expect(within(index).getByRole("link", { name: "Português (Brasil)" })).toBeDefined();
	expect(within(index).getByRole("link", { name: "繁體中文" })).toBeDefined();
	const doorway = screen.getByRole("link", { name: "English" });
	expect(doorway.getAttribute("href")).toBe("#languages");
	expect(doorway.getAttribute("title")).toBe("Change language");

	await user.click(screen.getByRole("button", { name: "Pause the list of languages" }));
	expect(screen.getByRole("button", { name: "Play the list of languages" })).toBeDefined();
	expect(Cookies.get("locale")).toBeUndefined();

	// Following the link is a page load; the address alone picks the language and keeps it.
	window.history.replaceState({ key: "homepage" }, "", german.getAttribute("href"));
	unmount();
	expect(getLocale()).toBe("de-DE");
	expect(Cookies.get("locale")).toBe("de-DE");
	await loadLocale(getLocale());
	render(view());
	expect(screen.getByRole("heading", { name: "Spricht Ihre Sprache" })).toBeDefined();
	expect(screen.getByText("Deutsch", { selector: "[aria-current=page]" })).toBeDefined();
	expect(
		within(screen.getByRole("navigation", { name: "Spricht Ihre Sprache" }))
			.getByRole("link", { name: "American English" })
			.getAttribute("href"),
	).toBe("/?campaign=audit&locale=en-US#languages");
	const [, heroCta] = screen.getAllByRole("link", { name: "Erstellen Sie Ihren Lebenslauf" });
	if (!heroCta) throw new Error("The hero's call to action is missing.");
	await user.click(heroCta);
	await waitFor(() => expect(router.history.location.pathname).toBe("/auth/register"));
	expect(getLocale()).toBe("de-DE");
});
