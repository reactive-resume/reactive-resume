// @vitest-environment happy-dom
import type { Application } from "../../types";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Activity } from "./activity";
vi.mock("../../use-application-lanes", () => ({ useApplicationLanes: () => ({ lanes: [] }) }));
vi.mock("../../use-application-actions", () => ({ useInvalidateApplications: () => vi.fn() }));
vi.mock("@/features/career/shared", () => ({ useCareerTime: () => ({ format: () => "Date", day: () => "Date" }) }));
vi.mock("@/hooks/use-confirm", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: Object.fromEntries(
			["addNote", "updateTimelineEntry", "deleteTimelineEntry"].map((name) => [
				name,
				{ mutationOptions: () => ({ mutationFn: vi.fn() }) },
			]),
		),
	},
}));
it("does not repeat a localized reply label and keeps a custom note's canonical qualifier", () => {
	i18n.loadAndActivate({ locale: "fr-FR", messages: { "7KxR8x": "Réponse donnée" } });
	const application = {
		id: "app",
		status: "applied",
		laneId: null,
		activity: [
			{
				id: "translated",
				type: "note",
				at: new Date(),
				text: "Réponse donnée",
				followedUp: { kind: "reply", stageEntryId: null },
			},
			{
				id: "custom",
				type: "note",
				at: new Date(),
				text: "Custom note",
				followedUp: { kind: "reply", stageEntryId: null },
			},
		],
	} as Application;
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<Activity application={application} onOpenInterview={() => {}} />
			</QueryClientProvider>
		</I18nProvider>,
	);
	expect(screen.getByText("Réponse donnée", { exact: true })).toBeVisible();
	expect(screen.getByText("Réponse donnée · Custom note", { exact: true })).toBeVisible();
});
