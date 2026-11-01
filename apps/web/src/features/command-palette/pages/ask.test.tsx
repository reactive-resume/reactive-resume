// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Command, CommandInput, CommandList } from "@reactive-resume/ui/components/command";
import { useCommandPaletteStore } from "../store";
import { AskCommandGroup } from "./ask";

const openAssistant = vi.hoisted(() => vi.fn());
vi.mock("@/features/assistant/open", () => ({ openAssistantFrom: openAssistant }));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useRouteContext: () => ({ session: { user: { id: "fixture" } } }),
	useRouterState: () => "/builder/resume-1",
}));
afterEach(() => useCommandPaletteStore.getState().reset());

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
