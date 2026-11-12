// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmDialogProvider } from "@/hooks/use-confirm";

const api = vi.hoisted(() => ({ status: vi.fn(), test: vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		webAccess: {
			status: { queryOptions: () => ({ queryKey: ["web-access"], queryFn: api.status }), key: () => ["web-access"] },
			save: { mutationOptions: (options: object) => ({ ...options, mutationFn: vi.fn() }) },
			delete: { mutationOptions: (options: object) => ({ ...options, mutationFn: vi.fn() }) },
			test: { mutationOptions: () => ({ mutationFn: api.test }) },
		},
	},
}));
vi.mock("../integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({ hasUsableProvider: true, isUnavailable: false }),
}));

i18n.loadAndActivate({ locale: "en", messages: {} });
const { WebAccessSection, WebAccessAttention } = await import("./web-access");

const status = (overrides: object) => ({
	builtInReader: true,
	configured: false,
	provider: null,
	managed: false,
	canSave: true,
	search: true,
	searxng: true,
	read: true,
	...overrides,
});

function renderSection(attention = false, operation: "search" | "read" = "search") {
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<ConfirmDialogProvider>
					{attention ? <WebAccessAttention failure="auth" operation={operation} /> : <WebAccessSection />}
				</ConfirmDialogProvider>
			</QueryClientProvider>
		</I18nProvider>,
	);
}

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

it.each([
	{ managed: true, searxng: false, name: "firecrawl" },
	{ managed: false, searxng: true, name: "SearXNG" },
])(
	"routes $name search repair to the operator rather than personal key controls",
	async ({ managed, searxng, name }) => {
		api.status.mockResolvedValue(status({ configured: true, provider: "firecrawl", managed, searxng }));
		renderSection(true);
		expect(await screen.findByText(/Ask your server administrator to fix web access/)).toBeTruthy();
		expect(screen.getByText(new RegExp(`${name} · .*rejected the API key`))).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Set up web access" })).toBeNull();
	},
);

it("keeps a personal reader repair separate from the server's working search", async () => {
	api.status.mockResolvedValue(status({ configured: true, provider: "firecrawl", searxng: true }));
	renderSection(true, "read");
	expect(await screen.findByText(/firecrawl · .*rejected the API key/)).toBeTruthy();
	expect(screen.getByRole("button", { name: "Set up web access" })).toBeTruthy();
	expect(screen.queryByText(/Ask your server administrator/)).toBeNull();
});

it("tests the server's search without a connection and leaves reading to the built-in reader", async () => {
	api.status.mockResolvedValue(status({}));
	api.test.mockResolvedValue({ search: { success: true }, read: { success: false, error: "unavailable" } });
	renderSection();

	expect(await screen.findByText(/Your server provides search/)).toBeTruthy();
	expect(screen.queryByText(/AI provider's own web search/)).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Test" }));

	expect(await screen.findByText("Search works")).toBeTruthy();
	expect(screen.queryByText("Reading failed")).toBeNull();
	expect(
		screen.getByText(/Search was tested with your server's search. Links are read with the built-in reader./),
	).toBeTruthy();
});

it("names the server's search and the connection's reading separately", async () => {
	api.status.mockResolvedValue(status({ configured: true, provider: "tavily" }));
	api.test.mockResolvedValue({ search: { success: true }, read: { success: true } });
	renderSection();

	expect(await screen.findByText("Search and reading · Tavily")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Test" }));

	expect(await screen.findByText("Reading works")).toBeTruthy();
	expect(screen.getByText("Search was tested with your server's search, and reading with Tavily.")).toBeTruthy();
});

it("keeps the connection's wording without SearXNG", async () => {
	api.status.mockResolvedValue(status({ configured: true, provider: "tavily", searxng: false }));
	api.test.mockResolvedValue({ search: { success: true }, read: { success: true } });
	renderSection();

	expect(await screen.findByText("Search and reading · Tavily")).toBeTruthy();
	expect(screen.queryByText(/Your server provides search/)).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Test" }));
	expect(await screen.findByText("Key stored encrypted · tested just now")).toBeTruthy();
	expect(screen.queryByText(/Search was tested/)).toBeNull();
});
