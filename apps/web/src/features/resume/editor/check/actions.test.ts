// @vitest-environment happy-dom
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";

type Data = { summary: string };
type Toast = { description: string; actionProps?: { onClick: () => void } };

const mocks = vi.hoisted(() => {
	const history: Data[] = [];
	const store = {
		resume: { data: { summary: "" } as Data },
		get undoStack() {
			return history;
		},
		updateResumeData: (edit: (draft: Data) => void) => {
			history.push(store.resume.data);
			const draft = structuredClone(store.resume.data);
			edit(draft);
			store.resume = { data: draft };
		},
		undo: () => {
			const before = history.pop();
			if (before) store.resume = { data: before };
		},
	};
	return { store, history, toasts: [] as Toast[] };
});
vi.mock("@/features/resume/builder/draft", () => ({ useResumeStore: { getState: () => mocks.store } }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: (toast: Toast) => mocks.toasts.push(toast) } }));

import { editWithUndo } from "./actions";

i18n.loadAndActivate({ locale: "en", messages: {} });

const edit = (summary: string) => (draft: ResumeData) => {
	(draft as unknown as Data).summary = summary;
};

beforeEach(() => {
	mocks.store.resume = { data: { summary: "base" } };
	mocks.history.length = 0;
	mocks.toasts.length = 0;
});

it("takes its own change back while it is the latest one", () => {
	editWithUndo(edit("merged"), "Merged");
	mocks.toasts[0]?.actionProps?.onClick();

	expect(mocks.store.resume.data.summary).toBe("base");
});

it("leaves a later edit in place, pointing to the builder's Undo instead (R8)", () => {
	editWithUndo(edit("merged"), "Merged");
	mocks.store.updateResumeData((draft) => (draft.summary = "typed after"));
	mocks.toasts[0]?.actionProps?.onClick();

	expect(mocks.store.resume.data.summary).toBe("typed after");
	expect(mocks.toasts.at(-1)?.description).toBe("You've made changes since. Use Undo to step back through them.");
});
