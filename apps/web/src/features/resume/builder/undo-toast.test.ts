// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";

type Data = { entries: string[]; headline: string };
type Toast = { description: string; actionProps?: { onClick: () => void } };

const mocks = vi.hoisted(() => {
	const history: Data[] = [];
	const store = {
		resume: { data: { entries: [], headline: "" } as Data, isLocked: false },
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
		restore: () => mocks.store.update((draft) => void draft.entries.unshift(deleted)),
	});
};

beforeEach(() => {
	mocks.store.resume = { data: { entries: ["Acme", "Globex"], headline: "" }, isLocked: false };
	mocks.history.length = 0;
	mocks.toasts.length = 0;
});

it("undoes the deletion while it's the latest step", () => {
	deleteFirst();
	mocks.toasts[0]?.actionProps?.onClick();
	expect(mocks.store.resume.data.entries).toEqual(["Acme", "Globex"]);
});

it("puts the deleted entry back after a later edit, keeping that edit (L3-03)", () => {
	deleteFirst();
	mocks.store.update((draft) => void (draft.headline = "Engineer X"));
	mocks.toasts[0]?.actionProps?.onClick();
	expect(mocks.store.resume.data).toEqual({ entries: ["Acme", "Globex"], headline: "Engineer X" });
});

it("leaves a locked resume alone and says to use Undo", () => {
	deleteFirst();
	mocks.store.update((draft) => void (draft.headline = "Later"));
	mocks.store.resume.isLocked = true;
	mocks.toasts[0]?.actionProps?.onClick();
	expect(mocks.store.resume.data.entries).toEqual(["Globex"]);
	expect(mocks.toasts.at(-1)?.description).toBe("You've made changes since. Use Undo to step back through them.");
});
