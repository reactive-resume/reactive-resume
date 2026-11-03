// @vitest-environment happy-dom

import type { RouterOutput } from "@/libs/orpc/client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmDialogProvider } from "@/hooks/use-confirm";

const api = vi.hoisted(() => ({
	list: vi.fn(),
	remove: vi.fn(),
	test: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	setDefault: vi.fn(),
}));

vi.mock("@/libs/orpc/client", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/libs/orpc/client")>();
	return {
		...actual,
		orpc: {
			...actual.orpc,
			aiProviders: {
				list: {
					queryOptions: () => ({ queryKey: ["providers"], queryFn: api.list }),
					key: () => ["providers"],
				},
				delete: { mutationOptions: () => ({ mutationFn: api.remove }) },
				test: { mutationOptions: () => ({ mutationFn: api.test }) },
				create: { mutationOptions: () => ({ mutationFn: api.create }) },
				update: { mutationOptions: () => ({ mutationFn: api.update }) },
				setDefault: { mutationOptions: () => ({ mutationFn: api.setDefault }) },
			},
		},
	};
});

i18n.loadAndActivate({ locale: "en", messages: {} });
const { ProvidersSection } = await import("./providers");

type SavedProvider = RouterOutput["aiProviders"]["list"][number];

const provider = (id: string, label: string, overrides: Partial<SavedProvider> = {}): SavedProvider => ({
	managed: false,
	id,
	label,
	provider: "openai",
	model: "gpt-5",
	fastModel: null,
	capableModel: null,
	baseURL: null,
	enabled: true,
	isDefault: false,
	testStatus: "success",
	testError: null,
	testErrorKind: null,
	apiKeyPreview: "sk-…1234",
	apiKeyFingerprint: "a".repeat(64),
	recipientVersion: "b".repeat(64),
	lastTestedAt: null,
	lastUsedAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
	...overrides,
});

function renderSection() {
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<ConfirmDialogProvider>
					<ProvidersSection />
				</ConfirmDialogProvider>
			</QueryClientProvider>
		</I18nProvider>,
	);
}

const openDelete = (index: number) => {
	const trigger = screen.getAllByRole("button", { name: "Provider options" })[index];
	if (!trigger) throw new Error("Missing provider options trigger");
	fireEvent.click(trigger);
};

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

it("deletes a provider from the row menu only after Keep provider is declined", async () => {
	api.list.mockResolvedValue([provider("p1", "Fictional working connection", { isDefault: true })]);
	api.remove.mockResolvedValue(undefined);
	renderSection();

	expect(await screen.findByText("Fictional working connection")).toBeTruthy();
	openDelete(0);
	fireEvent.click(await screen.findByRole("menuitem", { name: "Delete provider" }));

	expect(await screen.findByText("Delete “Fictional working connection”?")).toBeTruthy();
	expect(screen.getByText("Its saved key is deleted. Conversations using it need another provider.")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Keep provider" }));
	expect(api.remove).not.toHaveBeenCalled();

	openDelete(0);
	fireEvent.click(await screen.findByRole("menuitem", { name: "Delete provider" }));
	fireEvent.click(await screen.findByRole("button", { name: "Delete provider" }));
	await waitFor(() => expect(api.remove).toHaveBeenCalledWith({ id: "p1" }, expect.anything()));
});

it("removes the default row and shows the provider the server promoted", async () => {
	api.list
		.mockResolvedValueOnce([
			provider("p1", "Fictional working connection", { isDefault: true }),
			provider("p2", "Fictional backup connection"),
		])
		.mockResolvedValue([provider("p2", "Fictional backup connection", { isDefault: true })]);
	api.remove.mockResolvedValue(undefined);
	renderSection();

	expect(await screen.findByText("Fictional working connection")).toBeTruthy();
	openDelete(0);
	fireEvent.click(await screen.findByRole("menuitem", { name: "Delete provider" }));
	fireEvent.click(await screen.findByRole("button", { name: "Delete provider" }));

	await waitFor(() => expect(screen.queryByText("Fictional working connection")).toBeNull());
	expect(screen.getByText("Fictional backup connection")).toBeTruthy();
});
