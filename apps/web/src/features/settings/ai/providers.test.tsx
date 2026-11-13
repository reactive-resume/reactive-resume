// @vitest-environment happy-dom

import type { RouterOutput } from "@/libs/orpc/client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmDialogProvider } from "@/hooks/use-confirm";
import { setAccountScope, invalidateAccountScope } from "@/libs/auth/account-scope";

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
			career: {
				...actual.orpc.career,
				schedules: { queryOptions: () => ({ queryKey: ["schedules"], queryFn: async () => [] }) },
			},
			resume: { list: { queryOptions: () => ({ queryKey: ["resumes"], queryFn: async () => [] }) } },
			applications: { listSummary: { queryOptions: () => ({ queryKey: ["applications"], queryFn: async () => [] }) } },
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

vi.mock("@tanstack/react-router", async (importOriginal) => ({
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => vi.fn(),
}));

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
	return render(
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
	const trigger = screen.getAllByRole("button", { name: /^More for / })[index];
	if (!trigger) throw new Error("Missing provider options trigger");
	fireEvent.click(trigger);
};

beforeEach(() => {
	localStorage.clear();
	setAccountScope("ai-settings-account");
});
afterEach(() => {
	cleanup();
	invalidateAccountScope();
	vi.clearAllMocks();
});

it("deletes a provider from the row menu only after Keep provider is declined", async () => {
	api.list.mockResolvedValue([provider("p1", "Fictional working connection", { isDefault: true })]);
	api.remove.mockResolvedValue(undefined);
	renderSection();

	expect(await screen.findByText("Fictional working connection")).toBeTruthy();
	openDelete(0);
	fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));

	expect(await screen.findByText("Delete “Fictional working connection”?")).toBeTruthy();
	expect(
		screen.getByText(
			"Its saved key is deleted. Conversations that used it need another connection before you can continue them.",
		),
	).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Keep connection" }));
	expect(api.remove).not.toHaveBeenCalled();

	openDelete(0);
	fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
	fireEvent.click(await screen.findByRole("button", { name: "Delete connection" }));
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
	fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
	fireEvent.click(await screen.findByRole("button", { name: "Delete connection" }));

	await waitFor(() => expect(screen.queryByText("Fictional working connection")).toBeNull());
	expect(screen.getByText("Fictional backup connection")).toBeTruthy();
});

// A key typed for one vendor must not be sent to the vendor picked next.
it.each(["add", "edit"])("clears the typed key when the provider changes in %s", async (mode) => {
	api.list.mockResolvedValue([provider("p1", "Fictional working connection", { isDefault: true })]);
	renderSection();
	if (mode === "add") fireEvent.click(await screen.findByRole("button", { name: /^Add a connection/ }));
	else {
		await screen.findByText("Fictional working connection");
		openDelete(0);
		fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
	}
	const key = await screen.findByLabelText("API key");
	fireEvent.change(key, { target: { value: "sk-openai-secret" } });
	fireEvent.click(screen.getByRole("combobox", { name: "Provider" }));
	fireEvent.click(await screen.findByRole("option", { name: /Anthropic/ }));
	await waitFor(() => expect(screen.getByLabelText("API key")).toHaveValue(""));
});

it("keeps the first successful connection's next steps across reloads until dismissed", async () => {
	let saved: SavedProvider[] = [];
	const connected = provider("first", "Fictional first connection", { isDefault: true });
	api.list.mockImplementation(async () => saved);
	api.create.mockResolvedValue({ ...connected, enabled: false, testStatus: "untested" });
	api.test.mockImplementation(async () => {
		saved = [connected];
		return connected;
	});
	const first = renderSection();
	fireEvent.click(await screen.findByRole("button", { name: /^Add a connection/ }));
	fireEvent.change(await screen.findByLabelText("API key"), { target: { value: "fictional-test-key" } });
	fireEvent.click(screen.getByRole("button", { name: "Save and test" }));
	await screen.findByText("AI is ready");
	first.unmount();
	const reopened = renderSection();
	await screen.findByText("AI is ready");
	fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
	reopened.unmount();
	renderSection();
	await screen.findByText("Fictional first connection");
	expect(screen.queryByText("AI is ready")).toBeNull();
});

it("connects rejected-key feedback to the API key field", async () => {
	const { ProviderFieldsForm } = await import("./provider-fields");
	render(
		<I18nProvider i18n={i18n}>
			<ProviderFieldsForm
				provider="openai"
				value={{ label: "", apiKey: "invalid", model: "gpt-5", baseURL: "", fastModel: "", capableModel: "" }}
				onChange={() => {}}
				keyError="The key was rejected. Check the key and test again."
			/>
		</I18nProvider>,
	);
	const key = screen.getByLabelText("API key");
	const error = screen.getByRole("alert");
	expect(key.getAttribute("aria-invalid")).toBe("true");
	expect(key.getAttribute("aria-describedby")).toBe(error.id);
	expect(error.parentElement).toBe(key.parentElement);
});
