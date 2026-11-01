// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { useEditorStore } from "../store";

const api = vi.hoisted(() => ({ review: vi.fn(), read: vi.fn(), id: "resume-a" }));
vi.mock("@/features/resume/builder/draft", () => ({
	useResumeStore: Object.assign((select: (state: unknown) => unknown) => select({ resume: { id: api.id } }), {
		getState: () => ({ resume: { id: api.id } }),
	}),
}));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		ai: {
			atsReview: { mutationOptions: () => ({ mutationFn: api.review }) },
			writingReview: {
				queryKey: ({ input }: { input: { resumeId: string } }) => ["writing", input.resumeId],
				queryOptions: ({ input }: { input: { resumeId: string } }) => ({
					queryKey: ["writing", input.resumeId],
					queryFn: () => api.read(input.resumeId),
				}),
			},
		},
	},
}));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({
		hasUsableProvider: true,
		usableProviders: [{ id: "provider", label: "Fictional", model: "stub" }],
	}),
}));
vi.mock("@/features/assistant/provider-setup", () => ({ SetUpAi: () => null }));
vi.mock("../proposals/proposal-list", () => ({ ProposalList: () => null }));
import { WritingTab } from "./writing-tab";

beforeEach(() => {
	vi.resetAllMocks();
	api.id = "resume-a";
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	useEditorStore.setState({ writingReview: null, proposals: [] });
});
afterEach(cleanup);
it("publishes only the document's saved review when an older unmounted request finishes last", async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const data = structuredClone(defaultResumeData);
	data.summary.content = "<p>Fictional original</p>";
	const review = (summary: string) => ({ summary, suggestions: [], strengths: [], jdAlignment: null });
	let saved: unknown = null;
	api.read.mockImplementation(async () => saved);
	let old!: (value: unknown) => void;
	let newer!: (value: unknown) => void;
	api.review
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					old = resolve;
				}),
		)
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					newer = resolve;
				}),
		);
	const mount = () =>
		render(
			<I18nProvider i18n={i18n}>
				<QueryClientProvider client={client}>
					<WritingTab data={data} issues={[]} />
				</QueryClientProvider>
			</I18nProvider>,
		);
	const first = mount();
	fireEvent.click(screen.getByRole("button", { name: "Review writing" }));
	await waitFor(() => expect(api.review).toHaveBeenCalledTimes(1));
	first.unmount();
	mount();
	fireEvent.click(screen.getByRole("button", { name: "Review writing" }));
	await waitFor(() => expect(api.review).toHaveBeenCalledTimes(2));
	saved = {
		inputText: "original",
		passages: [],
		review: review("Latest saved review"),
		reviewedAt: new Date("2030-01-01T00:00:02Z"),
	};
	await act(async () => {
		newer(review("Latest saved review"));
	});
	await waitFor(() => expect(screen.getByText("Latest saved review")).toBeDefined());
	await act(async () => {
		old(review("Older discarded response"));
	});
	expect(useEditorStore.getState().writingReview?.summary).toBe("Latest saved review");
	expect(screen.queryByText("Older discarded response")).toBeNull();
	client.clear();
});
