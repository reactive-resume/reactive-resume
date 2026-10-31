// @vitest-environment happy-dom
import type { RouterOutput } from "@/libs/orpc/client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnswerLibrary } from "./answer-library";

const api = vi.hoisted(() => ({
	rows: [] as unknown[],
	facts: [] as unknown[],
	stories: [] as unknown[],
	save: vi.fn(),
	reuse: vi.fn(),
	remove: vi.fn(),
	use: vi.fn(),
}));
vi.mock("@/libs/orpc/client", () => {
	const query = (name: string, get: () => unknown) => ({
		key: () => [name],
		queryOptions: () => ({ queryKey: [name], queryFn: async () => get() }),
	});
	return {
		orpc: {
			career: {
				answers: {
					list: query("answers", () => api.rows),
					save: { mutationOptions: () => ({ mutationFn: api.save }) },
					reuse: { mutationOptions: () => ({ mutationFn: api.reuse }) },
					delete: { mutationOptions: () => ({ mutationFn: api.remove }) },
				},
				facts: query("facts", () => api.facts),
				stories: query("stories", () => api.stories),
			},
		},
	};
});
vi.mock("@/libs/error-message", () => ({ toastError: vi.fn() }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));
const saved = {
	id: "saved",
	question: "Describe your project",
	answer: "I restored service.",
	employer: "Harbor Labs",
	scope: "reusable",
	source: "manual",
	userId: "owner",
	createdAt: new Date(),
	updatedAt: new Date(),
	applicationId: null,
	sourceApplicationId: null,
	duplicateKey: "question-key",
	revision: 1,
	factIds: [],
	storyIds: [],
	evidence: [],
	stale: false,
	canReuse: true,
	reviewedAt: new Date(),
} as RouterOutput["career"]["answers"]["list"][number];
beforeEach(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	api.rows = [saved];
	api.facts = [];
	api.stories = [];
	api.save.mockReset().mockResolvedValue(saved);
	api.reuse.mockReset().mockResolvedValue({ text: "Adapted for this role", factIds: [] });
	api.remove.mockReset().mockResolvedValue(undefined);
	api.use.mockReset();
});
function show() {
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={queryClient}>
				<AnswerLibrary
					applicationId="second"
					company="Nova"
					current={{ id: "draft", question: "Describe your project", answer: "My draft", factIds: [] }}
					disabled={false}
					onUse={api.use}
				/>
			</QueryClientProvider>
		</I18nProvider>,
	);
}
it("requires explicit review after adaptation before using an independent answer copy", async () => {
	show();
	fireEvent.click(screen.getByRole("button", { name: "Use a saved answer" }));
	fireEvent.click(await screen.findByRole("button", { name: "Review and use" }));
	const dialog = screen.getByRole("dialog", { name: "Review for this application" });
	expect(within(dialog).getByText("Source employer", { exact: false })).toHaveTextContent("Harbor Labs");
	const use = within(dialog).getByRole("button", { name: "Use reviewed answer" });
	expect(use).toBeDisabled();
	const review = within(dialog).getByRole("checkbox", {
		name: "I reviewed this answer, its evidence and the application context.",
	});
	await userEvent.click(review);
	expect(use).toBeEnabled();
	fireEvent.change(within(dialog).getByLabelText("Answer"), { target: { value: "Adapted for this role" } });
	expect(use).toBeDisabled();
	expect(api.reuse).not.toHaveBeenCalled();
	await userEvent.click(review);
	fireEvent.click(use);
	await waitFor(() =>
		expect(api.use).toHaveBeenCalledWith({ question: saved.question, answer: "Adapted for this role", factIds: [] }),
	);
	expect(api.reuse).toHaveBeenCalledWith(
		{ id: "saved", applicationId: "second", expectedRevision: 1, answer: "Adapted for this role", reviewed: true },
		expect.anything(),
	);
});
it("defaults to employer scope and requires separate confirmation for all employers", async () => {
	show();
	fireEvent.click(screen.getByRole("button", { name: "Save for other applications" }));
	const dialog = screen.getByRole("dialog");
	expect(within(dialog).getByLabelText("Reuse scope")).toHaveValue("employer");
	fireEvent.change(within(dialog).getByLabelText("Reuse scope"), { target: { value: "reusable" } });
	const review = within(dialog).getByRole("checkbox", {
		name: "I reviewed this answer, its evidence and the application context.",
	});
	await userEvent.click(review);
	const save = within(dialog).getByRole("button", { name: "Save reviewed answer" });
	expect(save).toBeDisabled();
	await userEvent.click(
		within(dialog).getByRole("checkbox", {
			name: "I removed employer-specific wording and reviewed reuse across employers.",
		}),
	);
	await waitFor(() => expect(save).toBeEnabled());
	fireEvent.click(save);
	await waitFor(() => expect(api.save).toHaveBeenCalled());
	expect(api.save.mock.calls[0]?.[0]).toMatchObject({
		scope: "reusable",
		reviewed: true,
		noEmployerWording: true,
		source: "application",
		expectedEvidence: [],
	});
});
it("flags stale evidence and requires delete confirmation while preserving other copies", async () => {
	api.rows = [{ ...saved, stale: true, canReuse: false }];
	show();
	fireEvent.click(screen.getByRole("button", { name: "Use a saved answer" }));
	expect(await screen.findByText("Evidence changed or was removed. Edit and review before reuse.")).toBeVisible();
	expect(screen.getByRole("button", { name: "Review and use" })).toBeDisabled();
	expect(screen.getByRole("button", { name: "Edit saved answer" })).toBeEnabled();
	fireEvent.click(screen.getByRole("button", { name: "Delete" }));
	expect(api.remove).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Delete saved answer" }));
	await waitFor(() => expect(api.remove).toHaveBeenCalled());
	expect(api.remove.mock.calls[0]?.[0]).toEqual({ id: "saved", expectedRevision: 1 });
});

it("disables editing answers restricted to another employer or application", async () => {
	api.rows = [
		{ ...saved, scope: "employer", employer: "ACME", canReuse: false },
		{ ...saved, id: "application-only", scope: "application", applicationId: "first", canReuse: false },
	];
	show();
	fireEvent.click(screen.getByRole("button", { name: "Use a saved answer" }));
	const editButtons = await screen.findAllByRole("button", { name: "Edit saved answer" });
	expect(editButtons).toHaveLength(2);
	for (const button of editButtons) expect(button).toBeDisabled();
});

it("offers only stories backed by active facts and lets stale story references be removed", async () => {
	api.facts = [
		{ id: "active", applicationId: null, status: "active", text: "Active evidence" },
		{ id: "excluded", applicationId: null, status: "excluded", text: "Excluded evidence" },
	];
	api.stories = [
		{ id: "valid-story", applicationId: null, data: { title: "Current story", factIds: ["active"] } },
		{ id: "blocked-story", applicationId: null, data: { title: "Stale story", factIds: ["excluded"] } },
	];
	api.rows = [{ ...saved, storyIds: ["blocked-story"], stale: true, canReuse: false }];
	show();
	fireEvent.click(screen.getByRole("button", { name: "Use a saved answer" }));
	fireEvent.click(await screen.findByRole("button", { name: "Edit saved answer" }));
	expect(await screen.findByRole("checkbox", { name: "Active evidence" })).toBeVisible();
	expect(await screen.findByRole("checkbox", { name: "Current story" })).toBeVisible();
	expect(screen.queryByRole("checkbox", { name: "Stale story" })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Remove unavailable story reference" }));
	await userEvent.click(
		screen.getByRole("checkbox", { name: "I reviewed this answer, its evidence and the application context." }),
	);
	await userEvent.click(
		screen.getByRole("checkbox", {
			name: "I removed employer-specific wording and reviewed reuse across employers.",
		}),
	);
	fireEvent.click(screen.getByRole("button", { name: "Save reviewed answer" }));
	await waitFor(() => expect(api.save).toHaveBeenCalled());
	expect(api.save.mock.calls[0]?.[0]).toMatchObject({ storyIds: [], expectedEvidence: [] });
});
