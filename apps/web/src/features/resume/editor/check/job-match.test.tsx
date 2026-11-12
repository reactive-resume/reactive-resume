// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const api = vi.hoisted(() => ({
	navigate: vi.fn(),
	application: { id: "job-a", company: "Example", role: "Engineer", jobDescription: null as string | null },
	load: vi.fn(async () => api.application),
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
					queryFn: api.load,
				}),
			},
			listSummary: {
				queryKey: () => ["applications", "summary"],
				queryOptions: () => ({ queryKey: ["applications", "summary"], queryFn: async () => [] }),
			},
			update: { mutationOptions: () => ({ mutationFn: api.update }) },
		},
		documents: {
			key: () => ["documents"],
			copyForJob: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			linkApplication: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
		},
	},
}));
vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentBuilderResumeSelector: (select: (resume: { id: string; applicationId: string }) => unknown) =>
		select({ id: "resume-a", applicationId: "job-a" }),
	useIsResumeLocked: () => false,
	usePatchResume: () => vi.fn(),
}));
vi.mock("@/features/assistant/open", () => ({ openAssistantFrom: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => api.navigate,
	useSearch: () => ({}),
	Link: ({ children }: { children: React.ReactNode }) => <a href="/dashboard/applications/fixture/fit">{children}</a>,
}));
vi.mock("./actions", () => ({ checkStateOf: vi.fn(), editWithUndo: vi.fn() }));
vi.mock("@reactive-resume/resume/ats-pdf", () => ({ matchJobDescription: () => ({ terms: [] }) }));

vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({ hasUsableProvider: true }),
}));
import { useEditorStore } from "../store";
import { JobMatchTab, useJobMatch } from "./job-match";

afterEach(cleanup);

function Match({ selectedId }: { selectedId?: string }) {
	const match = useJobMatch(undefined, selectedId);
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

it("keeps the selected application's posting isolated from a different stored link and pasted draft", async () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	useEditorStore.setState({ pastedPosting: "Unrelated pasted posting" });
	const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
	client.setQueryData(["applications", "detail", { id: "job-a" }], api.application);
	client.setQueryData(
		["applications", "summary"],
		[
			{ id: "job-b", company: "Selected company", role: "Analyst", status: "saved" },
			{ id: "job-c", company: "Other company", role: "Designer", status: "saved" },
		],
	);
	let resolve!: (value: typeof api.application) => void;
	api.load.mockImplementationOnce(
		() =>
			new Promise((done) => {
				resolve = done;
			}),
	);
	render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<Match selectedId="job-b" />
			</I18nProvider>
		</QueryClientProvider>,
	);
	expect(screen.getByText("Loading…").getAttribute("role")).toBe("status");
	expect(screen.getByTestId("posting").textContent).toBe("");
	resolve({ id: "job-b", company: "Selected company", role: "Analyst", jobDescription: "Selected posting" });
	await waitFor(() => expect(screen.getByTestId("posting").textContent).toBe("Selected posting"));
	expect(screen.getByText("Selected company")).toBeTruthy();
	expect(screen.getByText("Analyst · For this visit only")).toBeTruthy();

	fireEvent.click(screen.getByRole("button", { name: "Change" }));
	fireEvent.change(screen.getByRole("combobox", { name: "Link an application" }), { target: { value: "job-c" } });
	expect(api.navigate).toHaveBeenCalled();
	const navigation = api.navigate.mock.calls.at(-1)?.[0];
	expect(navigation.search({ mode: "check", checkTab: "match", applicationId: "job-b" })).toEqual({
		mode: "check",
		checkTab: "match",
		applicationId: "job-c",
	});
	client.clear();
});

it("shows a failed selected posting with retry instead of matching an unrelated pasted draft", async () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	useEditorStore.setState({ pastedPosting: "Unrelated pasted posting" });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	api.load.mockRejectedValueOnce(new Error("Offline")).mockResolvedValueOnce({
		id: "job-b",
		company: "Selected company",
		role: "Analyst",
		jobDescription: "Selected posting",
	});
	render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<Match selectedId="job-b" />
			</I18nProvider>
		</QueryClientProvider>,
	);
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(screen.getByTestId("posting").textContent).toBe("");
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() => expect(screen.getByTestId("posting").textContent).toBe("Selected posting"));
	client.clear();
});
