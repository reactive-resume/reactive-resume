// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiKey = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), delete: vi.fn(), create: vi.fn() }));
const toasts = vi.hoisted(() => ({ add: vi.fn() }));

vi.mock("@/libs/auth/client", () => ({ authClient: { apiKey } }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: toasts.add, close: vi.fn() } }));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { ApiKeysSection } = await import("./api-keys");

const key = {
	id: "key-1",
	name: "Claude Desktop",
	start: "rr_abc",
	enabled: true,
	lastRequest: null,
	expiresAt: null,
	createdAt: new Date("2026-08-16T10:00:00Z"),
};

type ToastOptions = { actionProps: { onClick: () => Promise<void> }; onClose: () => void };

async function revoke() {
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<ApiKeysSection />
			</QueryClientProvider>
		</I18nProvider>,
	);
	await waitFor(() => expect(screen.getByText("Claude Desktop")).toBeTruthy());
	expect(screen.getByText(/never used · no expiry$/)).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Revoke Claude Desktop" }));
	await waitFor(() => expect(toasts.add).toHaveBeenCalled());
	return toasts.add.mock.calls.at(-1)?.[0] as ToastOptions;
}

describe("API keys", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		apiKey.list.mockResolvedValue({ data: { apiKeys: [key] }, error: null });
		apiKey.update.mockResolvedValue({ error: null });
		apiKey.delete.mockResolvedValue({ error: null });
	});

	it("turns a revoked key off at once, and Undo turns it back on without deleting it", async () => {
		const toast = await revoke();
		expect(apiKey.update).toHaveBeenCalledWith({ keyId: "key-1", enabled: false });

		await toast.actionProps.onClick();
		toast.onClose();
		expect(apiKey.update).toHaveBeenLastCalledWith({ keyId: "key-1", enabled: true });
		expect(apiKey.delete).not.toHaveBeenCalled();
	});
});
