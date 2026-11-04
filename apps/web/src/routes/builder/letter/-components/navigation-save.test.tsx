// @vitest-environment happy-dom
import type { LetterDraft } from "@/features/letters/store";
import { render } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { Route } from "../$coverLetterId";

const state = vi.hoisted(() => ({
	letter: { id: "letter-1", name: "Letter" },
	savedName: null,
	sessionId: "session",
	draft: { phase: "idle" } as LetterDraft,
	flush: vi.fn(async () => true),
	load: vi.fn(),
	reset: vi.fn(),
}));
const mocks = vi.hoisted(() => ({ useBlocker: vi.fn(), toast: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: object) => ({ options, useParams: () => ({ coverLetterId: "letter-1" }) }),
	redirect: vi.fn(),
	useBlocker: mocks.useBlocker,
}));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
	useSuspenseQuery: () => ({ data: state.letter }),
}));
vi.mock("@/features/letters/store", () => ({
	useLetterEditorStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), {
		getState: () => state,
	}),
}));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		coverLetters: { getById: { queryOptions: () => ({}) }, key: () => [] },
		documents: { key: () => [] },
		applications: { key: () => [] },
	},
}));
vi.mock("./letter-shell", () => ({ LetterShell: () => null }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast } }));

// Parity with the resume builder: leaving a letter whose edits haven't saved must not drop them.
it("stays on a letter until its edits save, and never leaves an unkept draft behind", async () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const Page = Route.options.component;
	if (!Page) throw new Error("The letter route needs a component.");
	render(<Page />);
	const leave = () => mocks.useBlocker.mock.lastCall?.[0].shouldBlockFn({ next: { params: {} } });

	state.flush.mockResolvedValueOnce(false);
	expect(await leave()).toBe(true);
	expect(mocks.toast).toHaveBeenLastCalledWith(expect.objectContaining({ type: "error" }));

	state.flush.mockResolvedValueOnce(true);
	expect(await leave()).toBe(false);

	state.draft = { phase: "ready" } as LetterDraft;
	state.flush.mockClear();
	expect(await leave()).toBe(true);
	expect(state.flush).not.toHaveBeenCalled();
});
