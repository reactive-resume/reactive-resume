import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://localhost:3000"}
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from "@tanstack/react-router";
import Cookies from "js-cookie";
import { Languages } from "./sections";
import { CtaLink } from "./ui";
import { getLocale, loadLocale } from "@/libs/locale";

afterEach(() => {
	cleanup();
	Cookies.remove("locale");
	vi.restoreAllMocks();
	window.history.replaceState(null, "", "/");
});

it("lets visitors choose their language with the keyboard and keep it when starting registration", async () => {
	window.history.replaceState({ key: "homepage" }, "", "/?locale=en-US&campaign=audit#languages");
	const user = userEvent.setup();
	const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
	const router = createRouter({
		routeTree: createRootRoute(),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	await router.load();
	await loadLocale("en-US");

	const view = () => (
		<RouterContextProvider router={router}>
			<I18nProvider i18n={i18n}>
				<Languages />
				<CtaLink size="hero" />
			</I18nProvider>
		</RouterContextProvider>
	);
	const { unmount } = render(view());
	const selector = screen.getByRole("combobox", { name: "Change language" });

	await user.click(screen.getByRole("button", { name: "Pause the list of languages" }));
	expect(screen.getByRole("button", { name: "Play the list of languages" })).toBeDefined();
	expect(Cookies.get("locale")).toBeUndefined();

	selector.focus();
	await user.keyboard("{Enter}");
	await user.type(screen.getByPlaceholderText("Search..."), "German");
	await user.keyboard("{ArrowDown}{Enter}");
	await waitFor(() => expect(reload).toHaveBeenCalledOnce());
	expect(getLocale()).toBe("de-DE");
	expect(window.location.search).toBe("?locale=de-DE&campaign=audit");
	expect(window.location.hash).toBe("#languages");
	expect(window.history.state).toEqual({ key: "homepage" });

	unmount();
	await loadLocale(getLocale());
	render(view());
	expect(screen.getByRole("heading", { name: "Spricht Ihre Sprache" })).toBeDefined();
	await user.click(screen.getByRole("link", { name: "Erstellen Sie Ihren Lebenslauf" }));
	await waitFor(() => expect(router.history.location.pathname).toBe("/auth/register"));
	expect(getLocale()).toBe("de-DE");
});
