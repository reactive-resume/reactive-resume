// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
	queryOptions: vi.fn(),
	begin: vi.fn(),
	complete: vi.fn(),
	cancel: vi.fn(),
}));

const catalogQueryOptions = (options: { input: { id: string; entryPoint: string } }) => ({
	queryKey: ["aiProviders", "orcaCatalog", options.input],
	queryFn: () => mocks.queryOptions(options),
});

vi.mock("@/libs/orpc/client", () => ({
	client: {
		aiProviders: {
			orcaConnectBegin: mocks.begin,
			orcaConnectComplete: mocks.complete,
			orcaConnectCancel: mocks.cancel,
		},
	},
	orpc: {
		aiProviders: {
			orcaCatalog: { queryOptions: catalogQueryOptions },
			list: { key: () => ["aiProviders", "list"] },
		},
	},
}));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { OrcaAuthMethods } = await import("./orcarouter-connect-panel");
const { OrcaModelSelector } = await import("./orcarouter-model-selector");

function wrap(node: React.ReactNode) {
	return render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				{node}
			</QueryClientProvider>
		</I18nProvider>,
	);
}

const liveCatalog = {
	source: "live" as const,
	degradedReason: null,
	fetchedAt: "2026-10-04T00:00:00.000Z",
	models: [
		{
			id: "deepseek/deepseek-v4-pro",
			name: "DeepSeek V4 Pro",
			contextLength: 1_048_576,
			inputModalities: ["text"],
			reasoningEfforts: [],
			verifiedFallback: false,
		},
		{
			id: "deepseek/deepseek-v4.1-flash",
			name: "DeepSeek V4.1 Flash",
			contextLength: 1_048_576,
			inputModalities: ["text", "image"],
			reasoningEfforts: [],
			verifiedFallback: false,
		},
	],
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.begin.mockResolvedValue({
		connectId: "connect-1",
		authorizeUrl: "https://www.orcarouter.ai/auth?callback_url=oob&code_challenge=abc&code_challenge_method=S256",
		expiresInSeconds: 600,
	});
	mocks.cancel.mockResolvedValue({ status: "cancelled" });
	mocks.complete.mockResolvedValue({ id: "provider-1", method: "pkce", scope: "api" });
	mocks.queryOptions.mockResolvedValue(liveCatalog);
});

describe("OrcaRouter authentication methods", () => {
	it("shows the API-key and account sign-in choices side by side, with distinct labels", () => {
		wrap(
			<OrcaAuthMethods
				method="api_key"
				onMethodChange={() => {}}
				apiKey=""
				onApiKeyChange={() => {}}
				onConnected={() => {}}
			/>,
		);

		const apiKeyTab = screen.getByTestId("orca-method-api-key");
		const pkceTab = screen.getByTestId("orca-method-pkce");
		expect(apiKeyTab.textContent).toContain("API key");
		expect(pkceTab.textContent).toContain("Connect with OrcaRouter");
		expect(apiKeyTab.getAttribute("aria-selected")).toBe("true");
		expect(pkceTab.getAttribute("aria-selected")).toBe("false");
	});

	it("keeps the pasted key masked in the DOM", () => {
		wrap(
			<OrcaAuthMethods
				method="api_key"
				onMethodChange={() => {}}
				apiKey="sk-orca-typed-secret"
				onApiKeyChange={() => {}}
				onConnected={() => {}}
			/>,
		);

		const input = screen.getByTestId("orca-api-key-input") as HTMLInputElement;
		expect(input.type).toBe("password");
		expect(input.value).toBe("sk-orca-typed-secret");
	});

	it("reveals the consent URL and a code field after sign-in starts", async () => {
		wrap(
			<OrcaAuthMethods
				method="pkce"
				onMethodChange={() => {}}
				apiKey=""
				onApiKeyChange={() => {}}
				onConnected={() => {}}
			/>,
		);

		fireEvent.click(screen.getByTestId("orca-connect-start"));
		await waitFor(() => expect(screen.getByTestId("orca-authorize-url")).toBeTruthy());
		expect((screen.getByTestId("orca-authorize-url") as HTMLInputElement).value).toContain("www.orcarouter.ai/auth");
		expect(screen.getByTestId("orca-code-input")).toBeTruthy();
		// The verifier is never sent to the browser.
		expect(document.body.textContent).not.toContain("code_verifier");
	});

	it("cancels a pending sign-in and returns to the idle state", async () => {
		wrap(
			<OrcaAuthMethods
				method="pkce"
				onMethodChange={() => {}}
				apiKey=""
				onApiKeyChange={() => {}}
				onConnected={() => {}}
			/>,
		);
		fireEvent.click(screen.getByTestId("orca-connect-start"));
		await waitFor(() => expect(screen.getByTestId("orca-connect-cancel")).toBeTruthy());

		fireEvent.click(screen.getByTestId("orca-connect-cancel"));

		await waitFor(() => expect(screen.getByTestId("orca-connect-start")).toBeTruthy());
		expect(mocks.cancel).toHaveBeenCalledWith({ connectId: "connect-1" });
	});

	it("reports a failed exchange and offers another attempt", async () => {
		mocks.complete.mockRejectedValueOnce(new Error("That code is unknown, already used, or expired."));
		wrap(
			<OrcaAuthMethods
				method="pkce"
				onMethodChange={() => {}}
				apiKey=""
				onApiKeyChange={() => {}}
				onConnected={() => {}}
			/>,
		);
		fireEvent.click(screen.getByTestId("orca-connect-start"));
		await waitFor(() => expect(screen.getByTestId("orca-code-input")).toBeTruthy());
		fireEvent.change(screen.getByTestId("orca-code-input"), { target: { value: "code-1" } });
		fireEvent.click(screen.getByTestId("orca-connect-submit"));

		await waitFor(() => expect(screen.getByTestId("orca-connect-error")).toBeTruthy());
	});
});

describe("OrcaRouter model selector", () => {
	it("renders the options the server returned for the requested entry point, not free text", async () => {
		wrap(<OrcaModelSelector providerId="provider-1" entryPoint="chat" value="" onValueChange={() => {}} />);

		await waitFor(() => expect(screen.getByText("2 models from OrcaRouter")).toBeTruthy());
		expect(mocks.queryOptions).toHaveBeenCalledWith(
			expect.objectContaining({ input: { id: "provider-1", entryPoint: "chat" } }),
		);
		// A selector, never a free-text model field.
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("asks the server for the multimodal filter when the entry point is an image attachment", async () => {
		wrap(<OrcaModelSelector providerId="provider-1" entryPoint="assistant_image" value="" onValueChange={() => {}} />);

		await waitFor(() =>
			expect(mocks.queryOptions).toHaveBeenCalledWith(
				expect.objectContaining({ input: { id: "provider-1", entryPoint: "assistant_image" } }),
			),
		);
	});

	it("tells the user to choose again when the selected model is no longer offered", async () => {
		mocks.queryOptions.mockResolvedValue({
			...liveCatalog,
			models: [liveCatalog.models[1]],
		});
		wrap(
			<OrcaModelSelector
				providerId="provider-1"
				entryPoint="assistant_image"
				value="deepseek/deepseek-v4-pro"
				onValueChange={() => {}}
			/>,
		);

		await waitFor(() => expect(screen.getByTestId("orca-model-invalidated")).toBeTruthy());
	});

	it("labels a degraded catalog as a verified fallback instead of a live list", async () => {
		mocks.queryOptions.mockResolvedValue({
			source: "seed",
			degradedReason: "OrcaRouter's model list could not be reached, so a small verified list is shown.",
			fetchedAt: null,
			models: [{ ...liveCatalog.models[0], verifiedFallback: true }],
		});
		wrap(<OrcaModelSelector providerId="provider-1" entryPoint="chat" value="" onValueChange={() => {}} />);

		await waitFor(() => expect(screen.getByTestId("orca-catalog-degraded")).toBeTruthy());
		expect(screen.getByTestId("orca-catalog-degraded").textContent).toContain("verified list");
	});

	it("shows an error state instead of falling back to a text field when the catalog call fails", async () => {
		mocks.queryOptions.mockRejectedValue(new Error("offline"));
		wrap(<OrcaModelSelector providerId="provider-1" entryPoint="chat" value="" onValueChange={() => {}} />);

		await waitFor(() => expect(screen.getByTestId("orca-catalog-error")).toBeTruthy());
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	it("shows an empty state when OrcaRouter reports no models for the capability", async () => {
		mocks.queryOptions.mockResolvedValue({ ...liveCatalog, models: [] });
		wrap(<OrcaModelSelector providerId="provider-1" entryPoint="chat" value="" onValueChange={() => {}} />);

		await waitFor(() => expect(screen.getByText("OrcaRouter returned no models for this capability.")).toBeTruthy());
		expect(screen.queryByTestId("orca-catalog-error")).toBeNull();
	});
});
