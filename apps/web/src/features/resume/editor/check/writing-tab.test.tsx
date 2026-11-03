// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { collectPassages } from "@reactive-resume/resume/proposals";
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
	const passages = collectPassages(data, {
		summary: "Summary",
		sectionTitle: () => "Section",
		entryTitle: () => "Entry",
		bullet: String,
		paragraph: String,
	});
	const passage = passages[0];
	if (!passage) throw new Error("Missing fictional passage");
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
		inputText: buildMarkdown(data).trim(),
		passages: [{ id: passage.id, where: passage.location, text: passage.text }],
		review: {
			...review("Latest saved review"),
			suggestions: [
				{
					section: "Summary",
					passageId: passage.id,
					issue: "Clearer",
					rewrite: "Fictional reviewed wording",
					impact: "medium",
				},
			],
		},
		reviewedAt: new Date("2030-01-01T00:00:02Z"),
		aiOperationIds: ["saved-writing-source"],
		aiUsage: {
			requests: 2,
			models: [{ providerId: "old-provider", label: "Recorded AI", provider: "openai", model: "recorded-model" }],
		},
	};
	await act(async () => {
		newer(review("Latest saved review"));
	});
	await waitFor(() => expect(screen.getByText("Latest saved review")).toBeDefined());
	expect(useEditorStore.getState().proposals).toHaveLength(1);
	expect(useEditorStore.getState().proposals[0]?.aiOperationIds).toEqual(["saved-writing-source"]);
	await act(async () => {
		old(review("Older discarded response"));
	});
	expect(useEditorStore.getState().writingReview?.summary).toBe("Latest saved review");
	expect(useEditorStore.getState().proposals[0]?.aiOperationIds).toEqual(["saved-writing-source"]);
	expect(screen.queryByText("Older discarded response")).toBeNull();
	expect(screen.getByText("AI request attempts: 2")).toBeVisible();
	expect(screen.getByText("Recorded AI · openai · recorded-model")).toBeVisible();
	const { aiOperationIds: _sources, ...legacy } = saved as Record<string, unknown>;
	saved = { ...legacy, reviewedAt: new Date("2030-01-01T00:00:03Z") };
	await act(async () => {
		await client.invalidateQueries({ queryKey: ["writing", api.id] });
	});
	await waitFor(() => expect(useEditorStore.getState().proposals[0]?.aiOperationIds).toBeUndefined());
	expect(useEditorStore.getState().proposals).toHaveLength(1);
	expect(api.review).toHaveBeenCalledTimes(2);
	client.clear();
});
