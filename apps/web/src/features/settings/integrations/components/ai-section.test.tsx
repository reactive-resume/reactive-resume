// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { toast } from "@reactive-resume/ui/components/toast";

type MutationName = "create" | "test" | "update" | "delete";

type MockProvider = {
	id: string;
	label: string;
	provider: "openai";
	model: string;
	baseURL: string;
	enabled: boolean;
	testStatus: string;
	testError: string | null;
	apiKeyPreview: string;
	apiKeyFingerprint: string;
	lastTestedAt: Date | null;
	lastUsedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
};

type MutationOptions = {
	name: MutationName;
	meta?: { noInvalidate?: boolean };
};

type ComboboxProps = {
	id: string;
	value: string;
	options: { value: string; label: string }[];
	onValueChange: (value: string) => void;
};

const queryClient = vi.hoisted(() => ({
	invalidateQueries: vi.fn(),
	setQueryData: vi.fn(),
}));

const providers = vi.hoisted(() => ({ data: [] as MockProvider[] }));

const mutations = vi.hoisted(() => ({
	create: vi.fn(),
	test: vi.fn(),
	update: vi.fn(),
	delete: vi.fn(),
}));

const mutationOptions = vi.hoisted(() => ({
	create: vi.fn((options?: MutationOptions) => ({ ...options, name: "create" })),
	test: vi.fn((options?: MutationOptions) => ({ ...options, name: "test" })),
	update: vi.fn((options?: MutationOptions) => ({ ...options, name: "update" })),
	delete: vi.fn((options?: MutationOptions) => ({ ...options, name: "delete" })),
}));

vi.mock("@tanstack/react-query", () => ({
	useQuery: () => ({ data: providers.data, isLoading: false, error: null }),
	useQueryClient: () => queryClient,
	useMutation: (options: MutationOptions) => ({
		isPending: false,
		mutate: (
			input: unknown,
			handlers?: { onSuccess?: (data: unknown) => void; onError?: (error: unknown) => void },
		) => {
			mutations[options.name](input).then(handlers?.onSuccess).catch(handlers?.onError);
		},
		mutateAsync: mutations[options.name],
	}),
}));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		aiProviders: {
			list: {
				queryOptions: () => ({ queryKey: ["aiProviders", "list"] }),
				queryKey: () => ["aiProviders", "list"],
			},
			create: { mutationOptions: mutationOptions.create },
			test: { mutationOptions: mutationOptions.test },
			update: { mutationOptions: mutationOptions.update },
			delete: { mutationOptions: mutationOptions.delete },
		},
	},
}));

vi.mock("@/components/ui/combobox", () => ({
	Combobox: ({ id, value, options, onValueChange }: ComboboxProps) => (
		<select id={id} value={value} onChange={(event) => onValueChange(event.currentTarget.value)}>
			{options.map((option) => (
				<option key={option.value} value={option.value}>
					{option.label}
				</option>
			))}
		</select>
	),
}));

vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { AISettingsSection } = await import("./ai-section");

const provider = (overrides: Partial<MockProvider>): MockProvider => ({
	id: "provider-1",
	label: "OpenAI",
	provider: "openai",
	model: "gpt-4.1",
	baseURL: "https://api.openai.com/v1",
	enabled: false,
	testStatus: "untested",
	testError: null,
	apiKeyPreview: "sk-p...test",
	apiKeyFingerprint: "fingerprint",
	lastTestedAt: null,
	lastUsedAt: null,
	createdAt: new Date("2026-07-04T00:00:00Z"),
	updatedAt: new Date("2026-07-04T00:00:00Z"),
	...overrides,
});

const renderSection = () =>
	render(
		<I18nProvider i18n={i18n}>
			<AISettingsSection />
		</I18nProvider>,
	);

describe("AISettingsSection", () => {
	beforeEach(() => {
		queryClient.invalidateQueries.mockReset();
		queryClient.setQueryData.mockReset();
		mutationOptions.create.mockClear();
		mutationOptions.test.mockClear();
		mutationOptions.update.mockClear();
		mutationOptions.delete.mockClear();
		mutations.create.mockReset();
		mutations.test.mockReset();
		mutations.update.mockReset();
		mutations.delete.mockReset();
		providers.data = [];
	});

	it("offers popular AI SDK providers and labels Ollama as cloud-hosted", () => {
		renderSection();

		for (const label of [
			"Requesty",
			"Mistral AI",
			"Cohere",
			"xAI Grok",
			"Groq",
			"DeepSeek",
			"Together.ai",
			"Fireworks",
			"Cerebras",
			"Perplexity",
			"Ollama Cloud",
		]) {
			expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
		}

		expect(screen.queryByRole("option", { name: "Ollama" })).not.toBeInTheDocument();
	});

	it("uses the save-and-test result as the connected provider row", async () => {
		const created = provider({});
		const tested = provider({ enabled: true, testStatus: "success", lastTestedAt: new Date("2026-07-04T01:00:00Z") });

		mutations.create.mockResolvedValue(created);
		mutations.test.mockResolvedValue(tested);

		renderSection();

		fireEvent.change(screen.getByLabelText("API Key"), { target: { value: "sk-test" } });
		fireEvent.click(screen.getByRole("button", { name: /save & test provider/i }));

		await waitFor(() => expect(queryClient.setQueryData).toHaveBeenCalled());

		expect(mutationOptions.create).toHaveBeenCalledWith({ meta: { noInvalidate: true } });
		expect(mutationOptions.test).toHaveBeenCalledWith({ meta: { noInvalidate: true } });
		expect(mutations.update).not.toHaveBeenCalled();

		const [, updater] = queryClient.setQueryData.mock.calls.at(-1) as [
			unknown,
			(providers: MockProvider[]) => MockProvider[],
		];
		expect(updater([created])).toEqual([tested]);
	});

	// The server returns a provider-side failure as data (see the API package's e2e coverage), so the
	// reason has to reach the card rather than being flattened into a generic transport error.
	it("shows the server's reason on the card and keeps the toast to the outcome", async () => {
		const failed = provider({
			enabled: false,
			testStatus: "failure",
			testError: "OpenAI rejected the API key.",
			lastTestedAt: new Date("2026-08-15T00:00:00Z"),
		});

		providers.data = [provider({})];
		mutations.test.mockResolvedValue(failed);

		renderSection();
		fireEvent.click(screen.getByRole("button", { name: "Test" }));

		await waitFor(() => expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));

		// Toast reports only the outcome; the card carries the detail.
		expect(toast.add).toHaveBeenCalledWith({ type: "error", description: "Connection failed." });
		expect(toast.add).not.toHaveBeenCalledWith(
			expect.objectContaining({ description: expect.stringContaining("rejected the API key") }),
		);

		providers.data = [failed];
		renderSection();

		expect(screen.getAllByText("OpenAI rejected the API key.").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Connection failed").length).toBeGreaterThan(0);
	});

	it("updates a configured provider's model", async () => {
		providers.data = [provider({})];
		mutations.update.mockResolvedValue(provider({ model: "gpt-5-mini", testStatus: "untested", enabled: false }));

		renderSection();

		fireEvent.click(screen.getByRole("button", { name: "Edit model" }));
		fireEvent.change(screen.getByLabelText("Provider model"), { target: { value: "gpt-5-mini" } });
		fireEvent.click(screen.getByRole("button", { name: "Save model" }));

		await waitFor(() => expect(mutations.update).toHaveBeenCalledWith({ id: "provider-1", model: "gpt-5-mini" }));
		expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["aiProviders", "list"] });
	});
});
