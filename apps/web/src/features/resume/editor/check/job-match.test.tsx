// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const api = vi.hoisted(() => ({
	application: { id: "job-a", company: "Example", role: "Engineer", jobDescription: null as string | null },
	update: vi.fn(async (input: { jobDescription: string }) => {
		api.application = { ...api.application, jobDescription: input.jobDescription };
		return api.application;
	}),
}));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: {
			getById: {
				queryKey: ({ input }: { input: { id: string } }) => ["applications", "detail", input],
				queryOptions: ({ input }: { input: { id: string } }) => ({
					queryKey: ["applications", "detail", input],
					queryFn: async () => api.application,
				}),
			},
			listSummary: { queryKey: () => ["applications", "summary"] },
			update: { mutationOptions: () => ({ mutationFn: api.update }) },
		},
		documents: { linkApplication: { mutationOptions: () => ({ mutationFn: vi.fn() }) } },
	},
}));
vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentBuilderResumeSelector: (select: (resume: { id: string; applicationId: string }) => unknown) =>
		select({ id: "resume-a", applicationId: "job-a" }),
	useIsResumeLocked: () => false,
	usePatchResume: () => vi.fn(),
}));
vi.mock("@/features/assistant/open", () => ({ openAssistantFrom: vi.fn() }));
vi.mock("./actions", () => ({ checkStateOf: vi.fn(), editWithUndo: vi.fn() }));
vi.mock("@reactive-resume/resume/ats-pdf", () => ({ matchJobDescription: () => ({ terms: [] }) }));

import { JobMatchTab, useJobMatch } from "./job-match";

function Match() {
	const match = useJobMatch(undefined);
	return (
		<>
			<output data-testid="posting">{match.posting}</output>
			<JobMatchTab match={match} data={defaultResumeData} />
		</>
	);
}

it("matches a newly saved posting without reopening the linked application", async () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const client = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000, retry: false } } });
	client.setQueryData(["applications", "detail", { id: "job-a" }], api.application);
	const view = render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<Match />
			</I18nProvider>
		</QueryClientProvider>,
	);
	fireEvent.change(screen.getByRole("textbox", { name: "Job posting" }), {
		target: { value: "TypeScript engineer" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save to the application" }));
	await waitFor(() => expect(api.update).toHaveBeenCalled());
	await waitFor(() => expect(screen.getByTestId("posting").textContent).toBe("TypeScript engineer"));
	view.unmount();
	client.clear();
});
