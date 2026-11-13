import type { Application } from "@/features/applications/types";
// @vitest-environment happy-dom
import type { ApplicationReview } from "@reactive-resume/ai/application-review";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { PrepareReview } from "./prepare-review";

const workspace = vi.hoisted(() => ({
	answers: [{ id: "written", question: "Why us?", answer: "Written by hand", factIds: [] as string[] }],
	save: vi.fn(async (next: { answers: { id: string; question: string; answer: string; factIds: string[] }[] }) => {
		workspace.answers = next.answers;
		return true;
	}),
}));

vi.mock("../hooks", async (importOriginal) => ({
	...(await importOriginal<typeof import("../hooks")>()),
	useDefaultProvider: () => ({ provider: {} }),
	useWorkspace: () => ({ settled: async () => ({ answers: workspace.answers }), save: workspace.save }),
}));
vi.mock("@tanstack/react-router", () => ({
	Link: () => null,
	useRouteContext: () => ({ session: { user: { id: "owner" } } }),
}));
vi.mock("@/features/resume/editor/proposals/proposal-list", () => ({ ChangeSet: () => null }));
vi.mock("@/libs/orpc/client", () => ({ client: {}, orpc: {} }));

// A prepared answer joins the ones already written; keeping it must never replace them.
it("keeps a prepared answer beside the existing answers", async () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const review: ApplicationReview = {
		threadId: null,
		assistantText: "",
		generationStatus: "ready",
		resume: { id: "resume", data: defaultResumeData, updatedAt: new Date(), isLocked: false },
		sets: [],
		letter: null,
		answers: [{ question: "Notice period?", answer: { answer: "Two weeks", factIds: [] }, note: null }],
		failed: [],
	};
	sessionStorage.setItem("career-draft:owner:prepare-review:job", JSON.stringify(review));
	render(
		<I18nProvider i18n={i18n}>
			<PrepareReview application={{ id: "job" } as Application} disabled={false} />
		</I18nProvider>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Prepare drafts" }));
	expect(workspace.save).not.toHaveBeenCalled();
	fireEvent.click(await screen.findByRole("button", { name: "Keep answer" }));
	await waitFor(() => expect(workspace.save).toHaveBeenCalled());
	expect(await screen.findByText("Kept")).toBeVisible();
	expect(
		screen.queryByRole("textbox", { name: "Questions from the employer's form · optional" }),
	).not.toBeInTheDocument();
	expect(screen.getByRole("button", { name: "Done" })).toBeVisible();
	const saved = workspace.save.mock.lastCall;
	expect(saved).toEqual([
		{
			answers: [
				{ id: "written", question: "Why us?", answer: "Written by hand", factIds: [] },
				{ id: expect.any(String), question: "Notice period?", answer: "Two weeks", factIds: [] },
			],
		},
		{ answers: [{ id: "written", question: "Why us?", answer: "Written by hand", factIds: [] }] },
	]);

	fireEvent.click(screen.getByRole("button", { name: "Undo" }));
	await screen.findByRole("button", { name: "Keep answer" });
	expect(workspace.answers).toEqual([{ id: "written", question: "Why us?", answer: "Written by hand", factIds: [] }]);
});
