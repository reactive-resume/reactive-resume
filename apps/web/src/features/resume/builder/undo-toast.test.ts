// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";

type Data = { entries: string[]; headline: string };
type Toast = { description: string; actionProps?: { onClick: () => void } };

const mocks = vi.hoisted(() => {
	const history: Data[] = [];
	const store = {
		resume: { id: "resume-1", data: { entries: [], headline: "" } as Data, isLocked: false },
		get undoStack() {
			return history;
		},
		update: (edit: (draft: Data) => void) => {
			history.push(store.resume.data);
			const draft = structuredClone(store.resume.data);
			edit(draft);
			store.resume = { ...store.resume, data: draft };
		},
		undo: () => {
			const before = history.pop();
			if (before) store.resume = { ...store.resume, data: before };
		},
	};
	return { store, history, toasts: [] as Toast[] };
});
vi.mock("./draft", () => ({ useResumeStore: { getState: () => mocks.store } }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: (toast: Toast) => mocks.toasts.push(toast) } }));

import { undoToast } from "./undo-toast";

i18n.loadAndActivate({ locale: "en", messages: {} });

const deleteFirst = () => {
	const deleted = mocks.store.resume.data.entries[0] ?? "";
	mocks.store.update((draft) => void draft.entries.shift());
	undoToast("Entry deleted", {
		restore: () => {
			if (mocks.store.resume.data.entries.includes(deleted)) return false;
			mocks.store.update((draft) => void draft.entries.unshift(deleted));
			return true;
		},
	});
};

beforeEach(() => {
	mocks.store.resume = { id: "resume-1", data: { entries: ["Acme", "Globex"], headline: "" }, isLocked: false };
	mocks.history.length = 0;
	mocks.toasts.length = 0;
});

it("undoes the deletion while it's the latest step", () => {
	deleteFirst();
	mocks.toasts[0]?.actionProps?.onClick();
	expect(mocks.store.resume.data.entries).toEqual(["Acme", "Globex"]);
});

it("puts the entry back when a revision from elsewhere cleared the history", () => {
	deleteFirst();
	mocks.history.length = 0;
	mocks.toasts[0]?.actionProps?.onClick();
	expect(mocks.store.resume.data.entries).toEqual(["Acme", "Globex"]);
});

it("puts the deleted entry back after a later edit, keeping that edit (L3-03)", () => {
	deleteFirst();
	mocks.store.update((draft) => void (draft.headline = "Engineer X"));
	mocks.toasts[0]?.actionProps?.onClick();
	expect(mocks.store.resume.data).toEqual({ entries: ["Acme", "Globex"], headline: "Engineer X" });
});

it("says to use Undo when the change can't be put back", () => {
	deleteFirst();
	mocks.store.update((draft) => void draft.entries.unshift("Acme"));
	mocks.toasts[0]?.actionProps?.onClick();
	expect(mocks.store.resume.data.entries).toEqual(["Acme", "Globex"]);
	expect(mocks.toasts.at(-1)?.description).toBe("You've made changes since. Use Undo to step back through them.");
});

it("leaves another resume alone", () => {
	deleteFirst();
	mocks.store.update((draft) => void (draft.headline = "Later"));
	mocks.store.resume = { ...mocks.store.resume, id: "other-resume" } as typeof mocks.store.resume;
	mocks.toasts[0]?.actionProps?.onClick();
	expect(mocks.store.resume.data.entries).toEqual(["Globex"]);
	expect(mocks.toasts).toHaveLength(1);
});

it("leaves a locked resume alone and says to use Undo", () => {
	deleteFirst();
	mocks.store.update((draft) => void (draft.headline = "Later"));
	mocks.store.resume.isLocked = true;
	mocks.toasts[0]?.actionProps?.onClick();
	expect(mocks.store.resume.data.entries).toEqual(["Globex"]);
	expect(mocks.toasts.at(-1)?.description).toBe("You've made changes since. Use Undo to step back through them.");
});
