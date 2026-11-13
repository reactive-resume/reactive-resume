// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiUsageSection } from "./usage";
import { AiResultUsage } from "@/features/ai/usage";

const api = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({
	orpc: { ai: { usage: { queryOptions: () => ({ queryKey: ["usage"], queryFn: api.read, retry: false }) } } },
}));
const row = {
	action: "reply",
	providerId: "removed",
	label: "Removed connection",
	provider: "openai",
	model: "fast",
	requests: 2,
};
const report = {
	start: new Date("2026-10-25T23:00:00Z"),
	end: new Date("2026-11-01T23:00:00Z"),
	timezone: "Europe/Berlin",
	requests: 5,
	groups: [row, { ...row, action: "answer", model: "capable", requests: 3 }],
};
beforeEach(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	api.read.mockReset();
});
afterEach(cleanup);
const mount = () =>
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<AiUsageSection />
			</QueryClientProvider>
		</I18nProvider>,
	);

it("shows server week, connection/action/model totals and refreshes without provider-list dependency", async () => {
	api.read.mockResolvedValue(report);
	mount();
	fireEvent.click(await screen.findByRole("button", { name: /By connection/ }));
	await screen.findByText("Removed connection · openai");
	expect(screen.getByText("5 request attempts")).toBeVisible();
	expect(screen.getAllByText("AI request attempts: 5")).toHaveLength(1);
	expect(screen.getByText("Reply · fast · Removed connection · 2")).toBeVisible();
	expect(screen.getByText("Form answer · capable · Removed connection · 3")).toBeVisible();
	expect(screen.getByText(/Oct 26 – .*Nov 1/)).toBeVisible();
	expect(screen.getByText(/^Europe\/Berlin/)).toBeVisible();
	api.read.mockResolvedValue({ ...report, requests: 0, groups: [] });
	fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
	await screen.findByText(/No AI request attempts recorded this week\./);
	expect(screen.queryByText("Removed connection · openai")).toBeNull();
});

it("replaces stale totals with an honest failure and retries through the visible refresh control", async () => {
	api.read.mockResolvedValueOnce(report).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(report);
	mount();
	fireEvent.click(await screen.findByRole("button", { name: /By connection/ }));
	await screen.findByText("Removed connection · openai");
	fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
	await screen.findByRole("alert");
	expect(screen.queryByText("AI request attempts: 5")).toBeNull();
	await waitFor(() => expect(screen.getByRole("button", { name: "Refresh usage" })).not.toBeDisabled());
	fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
	await screen.findByText("Removed connection · openai");
});

it("localizes counts and never invents request history for an older saved result", async () => {
	i18n.loadAndActivate({ locale: "ar-SA", messages: {} });
	const { rerender } = render(
		<I18nProvider i18n={i18n}>
			<AiResultUsage usage={undefined} />
		</I18nProvider>,
	);
	expect(screen.getByText("AI request history unavailable for this result.")).toBeVisible();
	await act(async () =>
		rerender(
			<I18nProvider i18n={i18n}>
				<AiResultUsage usage={{ requests: 1234, models: [row] }} />
			</I18nProvider>,
		),
	);
	expect(screen.getByText(`AI request attempts: ${new Intl.NumberFormat("ar-SA").format(1234)}`)).toBeVisible();
	expect(screen.getByText("Removed connection · openai · fast")).toBeVisible();
});
