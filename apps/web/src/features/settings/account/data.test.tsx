// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const remove = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/libs/auth/client", () => ({ authClient: { apiKey: { list: async () => ({ data: { apiKeys: [] } }) } } }));
vi.mock("@/libs/orpc/client", () => ({
	client: { auth: { deleteAccount: remove } },
	orpc: {
		documents: { counts: { queryOptions: () => ({ queryKey: ["counts"], queryFn: async () => ({}) }) } },
		applications: { list: { queryOptions: () => ({ queryKey: ["applications"], queryFn: async () => [] }) } },
	},
}));

i18n.loadAndActivate({ locale: "en", messages: {} });
const { DataSection } = await import("./data");

it("opens the deletion deep link at confirmation, never deletes on navigation, and allows cancellation", async () => {
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<DataSection openDeletion />
			</QueryClientProvider>
		</I18nProvider>,
	);
	const confirm = await screen.findByRole("button", { name: /^Delete account$/ });
	expect(confirm).toBeDisabled();
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "delete" } });
	expect(confirm).toBeEnabled();
	expect(remove).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Keep account" }));
	await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	expect(remove).not.toHaveBeenCalled();
});
