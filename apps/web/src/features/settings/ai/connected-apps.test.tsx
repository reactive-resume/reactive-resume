// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const oauth2 = vi.hoisted(() => ({ getConsents: vi.fn(), publicClient: vi.fn(), deleteConsent: vi.fn() }));
vi.mock("@/libs/auth/client", () => ({ authClient: { oauth2 } }));

i18n.loadAndActivate({ locale: "en", messages: {} });
const { ConnectedAppsSection } = await import("./connected-apps");

it("shows registered application names, keeps unnamed or unavailable clients revocable, and revokes the consent", async () => {
	oauth2.getConsents.mockResolvedValue({
		data: [
			{ id: "consent-1", clientId: "codex-client-id", scopes: ["api:read"] },
			{ id: "consent-2", clientId: "unnamed-client-id", scopes: ["api:read"] },
			{ id: "consent-3", clientId: "unavailable-client-id", scopes: ["api:read"] },
		],
		error: null,
	});
	oauth2.publicClient.mockImplementation(({ query }: { query: { client_id: string } }) => {
		if (query.client_id === "unavailable-client-id") return Promise.reject(new Error("Network unavailable"));
		return Promise.resolve({
			data: { client_name: query.client_id === "codex-client-id" ? "Codex" : null },
			error: null,
		});
	});
	oauth2.deleteConsent.mockResolvedValue({ error: null });

	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<ConnectedAppsSection />
			</QueryClientProvider>
		</I18nProvider>,
	);

	expect(await screen.findByText("Codex")).toBeTruthy();
	expect(screen.queryByText("codex-client-id")).toBeNull();
	expect(screen.getByText("unnamed-client-id")).toBeTruthy();
	expect(screen.getByText("unavailable-client-id")).toBeTruthy();
	const connection = screen.getByText("Codex").closest("li");
	if (!connection) throw new Error("Application name is missing its connection row");
	fireEvent.click(within(connection).getByRole("button", { name: "Revoke access" }));
	await waitFor(() => expect(oauth2.deleteConsent).toHaveBeenCalledWith({ id: "consent-1" }));
});
