// @vitest-environment happy-dom

import type { Application } from "../../types";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const update = vi.hoisted(() => vi.fn().mockResolvedValue({}));
vi.mock("@tanstack/react-router", () => ({ useRouteContext: () => ({ session: { user: { timezone: "UTC" } } }) }));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: { update: { mutationOptions: () => ({ mutationFn: update }) } },
		career: { savedItems: { queryOptions: () => ({ queryKey: ["offers"], queryFn: async () => [] }) } },
	},
}));
vi.mock("../../use-application-actions", () => ({ useInvalidateApplications: () => vi.fn() }));

const { NextStepCard } = await import("./next-step-card");

it("opens the follow-up with its saved date and note, then saves the edited note", async () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const application = {
		id: "application-1",
		role: "Engineer",
		company: "Orbital",
		status: "applied",
		activity: [],
		followUpAt: new Date(2026, 9, 15, 9),
		followUpNote: "Ask the recruiter",
	} as unknown as Application;
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<NextStepCard application={application} onScheduleInterview={vi.fn()} />
			</QueryClientProvider>
		</I18nProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Edit" }));
	fireEvent.click(await screen.findByRole("menuitem", { name: "Change the follow-up…" }));
	expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-10-15");
	expect((screen.getByLabelText("What to do") as HTMLInputElement).value).toBe("Ask the recruiter");
	fireEvent.change(screen.getByLabelText("What to do"), { target: { value: "Email the recruiter" } });
	fireEvent.click(screen.getByRole("button", { name: "Save" }));
	await waitFor(() =>
		expect(update).toHaveBeenCalledWith(
			{
				id: application.id,
				followUpAt: application.followUpAt,
				followUpNote: "Email the recruiter",
			},
			expect.anything(),
		),
	);
});
