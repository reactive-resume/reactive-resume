// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({
	client: {},
	orpc: {
		aiProviders: {
			list: { queryOptions: () => ({ queryKey: ["providers"], queryFn: api.list, retry: false }) },
		},
		career: {
			facts: { queryOptions: () => ({ queryKey: ["facts"], queryFn: async () => [] }) },
			stories: { queryOptions: () => ({ queryKey: ["stories"], queryFn: async () => [] }) },
		},
	},
}));
vi.mock("@tanstack/react-router", () => ({
	Link: ({ children }: { children: ReactNode }) => <a href="/dashboard/settings/ai">{children}</a>,
}));

import { useHasUsableAiProvider } from "./hooks/use-has-usable-ai-provider";
import { AiNotice } from "@/features/career/workspace/fit";

let client: QueryClient;
const provider = { id: "saved", label: "Saved DeepSeek", enabled: true, testStatus: "success" };
const application = {
	id: "app",
	resumeId: null,
	coverLetterId: null,
	jobDescription: "Build reliable services.",
	requirements: [],
	notes: null,
	contacts: [],
};
function Wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>{children}</I18nProvider>
		</QueryClientProvider>
	);
}
beforeEach(() => {
	api.list.mockReset();
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});
afterEach(() => {
	cleanup();
	client.clear();
});

it("shows a recoverable lookup error instead of setup, then restores the saved provider after Retry", async () => {
	api.list.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce([provider]);
	render(<AiNotice task="fit" application={application} />, { wrapper: Wrapper });
	expect(screen.getByRole("status").textContent).toContain("Loading AI connections");
	expect(screen.queryByRole("button", { name: "Set up AI" })).toBeNull();
	expect((await screen.findByRole("alert")).textContent).toContain("saved connections haven't changed");
	expect(screen.queryByRole("button", { name: "Set up AI" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Try again" }));
	await screen.findByText(/to Saved DeepSeek/);
	expect(screen.queryByRole("alert")).toBeNull();
	expect(api.list).toHaveBeenCalledTimes(2);
});

it("offers setup only after a successful empty provider lookup", async () => {
	api.list.mockResolvedValue([]);
	render(<AiNotice />, { wrapper: Wrapper });
	await screen.findByRole("button", { name: "Set up AI" });
	expect(screen.queryByRole("alert")).toBeNull();
});

it("withdraws AI availability if refreshing cached configuration fails, then recovers it", async () => {
	api.list.mockResolvedValueOnce([provider]).mockRejectedValueOnce(new Error("Offline")).mockResolvedValue([provider]);
	const { result } = renderHook(useHasUsableAiProvider, { wrapper: Wrapper });
	await waitFor(() => expect(result.current.hasUsableProvider).toBe(true));
	await act(async () => {
		await client.invalidateQueries({ queryKey: ["providers"] });
	});
	await waitFor(() => expect(result.current.isUnavailable).toBe(true));
	expect(result.current.hasUsableProvider).toBe(false);
	expect(result.current.usableProviders).toEqual([]);
	act(() => result.current.retry());
	await waitFor(() => expect(result.current.hasUsableProvider).toBe(true));
});
