// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Command, CommandInput, CommandList } from "@reactive-resume/ui/components/command";
import { useCommandPaletteStore } from "../store";
import { AskCommandGroup } from "./ask";

const openAssistant = vi.hoisted(() => vi.fn());
const account = vi.hoisted(() => ({ id: "fixture", generation: 0 }));
vi.mock("@/libs/auth/account-scope", () => ({ getAccountGeneration: () => account.generation }));
const providers = vi.hoisted(() => ({
	hasUsableProvider: true,
	isUnavailable: false,
	isLoading: false,
	error: null as Error | null,
	retry: vi.fn(),
}));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => providers,
}));
vi.mock("@/features/ai/set-up-ai", () => ({
	SetUpAiDialog: ({ open }: { open: boolean }) =>
		open ? (
			<div role="dialog" aria-label="Set up AI">
				<p>Provider form boundary</p>
			</div>
		) : null,
}));
vi.mock("@/features/assistant/open", () => ({ openAssistantFrom: openAssistant }));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useRouteContext: () => ({ session: { user: { id: account.id } } }),
	useRouterState: () => "/builder/resume-1",
}));
afterEach(() => {
	cleanup();
	useCommandPaletteStore.getState().reset();
	Object.assign(providers, { hasUsableProvider: true, isUnavailable: false, isLoading: false, error: null });
	vi.clearAllMocks();
	account.id = "fixture";
	account.generation = 0;
});

it("clears the old account's question and setup before showing another account", async () => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	useCommandPaletteStore.setState({ search: "Old account question" });
	providers.hasUsableProvider = false;
	const queryClient = new QueryClient();
	const view = () => (
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<Command>
					<CommandList>
						<AskCommandGroup />
					</CommandList>
				</Command>
			</QueryClientProvider>
		</I18nProvider>
	);
	const { rerender } = render(view());
	fireEvent.click(await screen.findByRole("option", { name: /Ask the assistant/ }));
	expect(await screen.findByRole("dialog", { name: "Set up AI" })).toBeVisible();
	account.id = "replacement";
	account.generation++;
	rerender(view());
	expect(useCommandPaletteStore.getState().search).toBe("");
	expect(screen.queryByRole("dialog", { name: "Set up AI" })).toBeNull();
	expect(openAssistant).not.toHaveBeenCalled();
	queryClient.clear();
});

it.each(["question ", "  question", "two  words"])("keeps Ask visible for whitespace query %j", async (search) => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	useCommandPaletteStore.setState({ search });
	const queryClient = new QueryClient();
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<Command>
					<CommandInput value={search} />
					<CommandList>
						<AskCommandGroup />
					</CommandList>
				</Command>
			</QueryClientProvider>
		</I18nProvider>,
	);
	const ask = await screen.findByRole("option", {
		name: `Ask the assistant “${search.trim().replace(/\s+/g, " ")}”`,
	});
	expect(ask).toBeVisible();
	fireEvent.click(ask);
	expect(openAssistant).toHaveBeenLastCalledWith({ draft: search.trim() });
	queryClient.clear();
});

it.each(["missing", "loading", "failed", "account-changed"])(
	"keeps the task in the palette when provider readiness is %s",
	async (kind) => {
		i18n.loadAndActivate({ locale: "en-US", messages: {} });
		useCommandPaletteStore.setState({ search: "Keep my question" });
		Object.assign(providers, {
			hasUsableProvider: false,
			isUnavailable: kind !== "missing",
			isLoading: kind === "loading",
			error: kind === "failed" ? new Error("Lookup unavailable") : null,
		});
		const queryClient = new QueryClient();
		render(
			<I18nProvider i18n={i18n}>
				<QueryClientProvider client={queryClient}>
					<Command>
						<CommandInput value="Keep my question" />
						<CommandList>
							<AskCommandGroup />
						</CommandList>
					</Command>
				</QueryClientProvider>
			</I18nProvider>,
		);
		const ask = await screen.findByRole("option", { name: /Ask the assistant/ });
		expect(ask).toHaveTextContent(
			kind === "loading" ? "Loading…" : kind === "failed" ? "Try again" : "Connect an AI provider",
		);
		if (kind === "account-changed") account.generation++;
		fireEvent.click(ask);
		expect(openAssistant).not.toHaveBeenCalled();
		expect(useCommandPaletteStore.getState().search).toBe("Keep my question");
		if (kind === "missing") expect(await screen.findByRole("dialog", { name: "Set up AI" })).toBeVisible();
		else expect(providers.retry).toHaveBeenCalledTimes(kind === "failed" ? 1 : 0);
		queryClient.clear();
	},
);
