// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const toasts = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: toasts }));
import { ConfirmDialogProvider } from "@/hooks/use-confirm";

const oauth2 = vi.hoisted(() => ({ getConsents: vi.fn(), publicClient: vi.fn(), deleteConsent: vi.fn() }));
vi.mock("@/libs/auth/client", () => ({ authClient: { oauth2 } }));

i18n.loadAndActivate({ locale: "en", messages: {} });
const { ConnectedAppsSection } = await import("./connected-apps");

it("shows registered application names, keeps unnamed or unavailable clients revocable, and revokes the consent", async () => {
	const consents = [
		{
			id: "consent-1",
			clientId: "codex-client-id",
			scopes: ["api:read", "api:custom"],
			createdAt: new Date("2026-10-01T12:00:00Z"),
		},
		{
			id: "consent-2",
			clientId: "unnamed-client-id",
			scopes: ["api:read"],
			createdAt: new Date("2026-10-01T12:00:00Z"),
		},
		{
			id: "consent-3",
			clientId: "unavailable-client-id",
			scopes: ["api:read"],
			createdAt: new Date("2026-10-01T12:00:00Z"),
		},
		{
			id: "consent-4",
			clientId: "legacy-client-id",
			scopes: ["profile", "email"],
			createdAt: new Date("2026-10-01T12:00:00Z"),
		},
	];
	oauth2.getConsents.mockResolvedValue({ data: consents, error: null });
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
				<ConfirmDialogProvider>
					<ConnectedAppsSection />
				</ConfirmDialogProvider>
			</QueryClientProvider>
		</I18nProvider>,
	);

	expect(await screen.findByText("Codex")).toBeTruthy();
	expect(screen.queryByText("codex-client-id")).toBeNull();
	expect(screen.getByText("unnamed-client-id")).toBeTruthy();
	expect(screen.getByText("unavailable-client-id")).toBeTruthy();
	expect(screen.getByText("Read, change and delete documents and applications (legacy connection).")).toBeTruthy();
	const connection = screen.getByText("Codex").closest("li");
	if (!connection) throw new Error("Application name is missing its connection row");
	fireEvent.click(within(connection).getByRole("button", { name: "Disconnect Codex" }));
	expect(oauth2.deleteConsent).not.toHaveBeenCalled();
	const dialog = await screen.findByRole("alertdialog");
	expect(within(dialog).getByText("Disconnect “Codex”?")).toBeTruthy();
	fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
	expect(oauth2.deleteConsent).not.toHaveBeenCalled();
	expect(within(connection).queryByText("api:read")).toBeNull();
	expect(within(connection).getByText("api:custom")).toBeTruthy();
	expect(within(connection).getByText(/Connected/)).toBeTruthy();
	// The server no longer lists the revoked consent, so the refetch removes its row.
	oauth2.getConsents.mockResolvedValue({ data: consents.slice(1), error: null });
	fireEvent.click(within(connection).getByRole("button", { name: "Disconnect Codex" }));
	fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Disconnect" }));
	await waitFor(() => expect(oauth2.deleteConsent).toHaveBeenCalledWith({ id: "consent-1" }));
	expect(toasts.add).toHaveBeenCalledWith(expect.objectContaining({ description: "Disconnected “Codex”." }));
	await waitFor(() => expect(screen.queryByText("Codex")).toBeNull());
	expect(screen.getByText("unnamed-client-id")).toBeTruthy();
});
