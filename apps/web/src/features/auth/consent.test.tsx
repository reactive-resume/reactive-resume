// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { OAuthConsentPage } from "./pages/consent";

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: { client_name: "Cursor" }, isPending: false, isError: false }),
}));
vi.mock("@tanstack/react-router", () => ({ Link: () => null }));
vi.mock("@/libs/auth/client", () => ({ authClient: {} }));

afterEach(cleanup);

// Anyone can register a client named "Cursor" and claim a custom scheme spelled like a website, so the consent screen
// must name where the grant actually goes.
it.each([
	["https://www.cursor.com/agents/mcp/oauth/callback", "www.cursor.com"],
	["www.cursor.com:/oauth/callback", "www.cursor.com:"],
	["com.example.app:/oauth/callback", "com.example.app:"],
	["cursor://anysphere.cursor-mcp/oauth/callback", "cursor://anysphere.cursor-mcp"],
	["evilapp://www.cursor.com/oauth/callback", "evilapp://www.cursor.com"],
])("names %s as %s before consent", (redirectUri, destination) => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const oauthQuery = new URLSearchParams({ client_id: "client", redirect_uri: redirectUri, sig: "signed" }).toString();
	render(
		<I18nProvider i18n={i18n}>
			<OAuthConsentPage oauthQuery={oauthQuery} email="owner@example.com" isAnonymous={false} disableSignups={false} />
		</I18nProvider>,
	);
	expect(screen.getByText(destination, { exact: true })).toBeVisible();
});
