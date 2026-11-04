// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { Route } from "./route";

const state = vi.hoisted(() => ({
	forAccount: undefined as string | undefined,
	page: "alice",
	browser: { data: null as { user: { id: string } } | null, error: null as unknown },
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: object) => ({
		options,
		useSearch: () => ({ forAccount: state.forAccount }),
		useRouteContext: () => ({ session: { user: { id: state.page } } }),
	}),
	retainSearchParams: () => undefined,
	useRouterState: () => ({ pathname: "/dashboard/settings/account", search: "", href: "/dashboard/settings/account" }),
	Link: ({ children }: { children?: ReactNode }) => <a href="#settings">{children}</a>,
	Outlet: () => <p>Private settings</p>,
}));
vi.mock("@/libs/auth/client", () => ({ authClient: { useSession: () => state.browser } }));

// Vite defines the version at build time.
vi.stubGlobal("__APP_VERSION__", "0.0.0");
afterEach(cleanup);
afterAll(() => vi.unstubAllGlobals());

// The phone opens web settings for one account; a browser signed into another must not show or change that one's.
it.each([
	["no account was named", undefined, "alice", "alice", null, true],
	["page and browser are the named account", "alice", "alice", "alice", null, true],
	["the page belongs to another account", "alice", "bob", "alice", null, false],
	["the browser cookie belongs to another account", "alice", "alice", "bob", null, false],
	["the browser session can't be read", "alice", "alice", "alice", new Error("offline"), false],
])("shows settings only when %s", (_, forAccount, page, browser, error, shown) => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	Object.assign(state, { forAccount, page, browser: { data: { user: { id: browser } }, error } });
	const Settings = Route.options.component;
	if (!Settings) throw new Error("The settings route needs a component.");
	render(
		<I18nProvider i18n={i18n}>
			<Settings />
		</I18nProvider>,
	);
	expect(screen.queryByText("Private settings") !== null).toBe(shown);
	expect(screen.queryByText("Sign in with the account that opened these settings.") !== null).toBe(!shown);
});
