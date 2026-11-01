// @vitest-environment happy-dom

import type { ComponentProps } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const unlinkMock = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
const listAccountsMock = vi.hoisted(() =>
	vi.fn().mockResolvedValue({
		data: [
			{
				id: "internal-account-uuid-123",
				providerId: "google",
				accountId: "google-external-sub-456",
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		],
	}),
);

vi.mock("@tanstack/react-router", () => ({
	useRouter: () => ({ invalidate: vi.fn() }),
	useRouteContext: () => ({ flags: { smtpEnabled: true } }),
	Link: ({ to, children, ...props }: ComponentProps<"a"> & { to: string }) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@/hooks/use-confirm", () => ({
	useConfirm: () => vi.fn(),
	usePrompt: () => vi.fn(),
}));

vi.mock("@/libs/auth/client", () => ({
	authClient: {
		useSession: () => ({ data: { user: { twoFactorEnabled: false } } }),
		listAccounts: listAccountsMock,
		unlinkAccount: unlinkMock,
		passkey: {
			listUserPasskeys: async () => ({ data: [] }),
		},
	},
}));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		auth: {
			providers: {
				list: {
					queryOptions: () => ({
						queryKey: ["auth", "providers"],
						queryFn: async () => ({
							google: "Google",
							credential: "Password",
						}),
					}),
				},
			},
		},
	},
}));

vi.mock("@reactive-resume/ui/components/toast", () => ({
	toast: { add: vi.fn(), close: vi.fn() },
}));

i18n.loadAndActivate({ locale: "en", messages: {} });
const { SecuritySection } = await import("./security");

it("passes internal account ID (account.id) when unlinking a social provider", async () => {
	const queryClient = new QueryClient();

	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<SecuritySection />
			</QueryClientProvider>
		</I18nProvider>,
	);

	const disconnectButton = await screen.findByRole("button", { name: "Disconnect" });
	expect(disconnectButton).toBeInTheDocument();

	fireEvent.click(disconnectButton);

	await waitFor(() => {
		expect(unlinkMock).toHaveBeenCalledTimes(1);
	});

	expect(unlinkMock).toHaveBeenCalledWith({
		accountId: "internal-account-uuid-123",
	});
	expect(unlinkMock).not.toHaveBeenCalledWith({
		accountId: "google-external-sub-456",
	});
});
