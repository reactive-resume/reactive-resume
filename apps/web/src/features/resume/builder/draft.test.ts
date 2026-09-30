// @vitest-environment happy-dom

import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Resume } from "./draft";
import { act, renderHook } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { sortSectionItemsByPeriod } from "@reactive-resume/resume/section-sort";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import {
	readUnsavedResumeData,
	savePendingChanges,
	useBuilderResumeUpdateSubscription,
	useResumeCleanup,
	useResumeStore,
	useResumeUpdateSubscription,
} from "./draft";

const orpcMocks = vi.hoisted(() => ({
	getResumeById: vi.fn(),
	patchResume: vi.fn(),
	streamSubscribe: vi.fn(),
	updateResume: vi.fn(),
}));

const useBlockerMock = vi.hoisted(() => vi.fn());

const consumeEventIteratorMock = vi.hoisted(() => vi.fn());

const queryClientMock = vi.hoisted(() => ({
	setQueryData: vi.fn(),
}));

const routerParamsMock = vi.hoisted(() => ({
	value: {} as { resumeId?: string },
}));

const toastMocks = vi.hoisted(() => ({
	add: vi.fn(() => "sync-error-toast"),
	close: vi.fn(),
}));

vi.mock("@orpc/client", () => ({
	consumeEventIterator: consumeEventIteratorMock,
}));

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => queryClientMock,
}));

vi.mock("@tanstack/react-router", () => ({
	useParams: () => routerParamsMock.value,
	useBlocker: useBlockerMock,
}));

vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		resume: {
			getById: {
				call: orpcMocks.getResumeById,
				queryOptions: ({ input }: { input: { id: string } }) => ({
					queryKey: ["resume", "getById", input.id],
				}),
			},
			patch: {
				call: orpcMocks.patchResume,
			},
			update: {
				call: orpcMocks.updateResume,
			},
		},
	},
	streamClient: {
		resume: {
			updates: {
				subscribe: orpcMocks.streamSubscribe,
			},
		},
	},
}));

vi.mock("@reactive-resume/ui/components/toast", () => ({
	toast: toastMocks,
}));

function cloneResumeData(data: ResumeData): ResumeData {
	return structuredClone(data);
}

function makeResume(id: string): Resume {
	return {
		id,
		name: "Resume",
		slug: id,
		tags: [],
		data: cloneResumeData(defaultResumeData),
		isLocked: false,
		isPublic: false,
		hasPassword: false,
		createdAt: new Date("2026-05-20T09:00:00.000Z"),
		updatedAt: new Date("2026-05-26T12:00:00.000Z"),
	};
}

function withBasicsName(resume: Resume, name: string): Resume {
	return {
		...resume,
		data: {
			...resume.data,
			basics: {
				...resume.data.basics,
				name,
			},
		},
	};
}

function experienceItem(
	id: string,
	company: string,
	period: string,
): ResumeData["sections"]["experience"]["items"][number] {
	return {
		id,
		company,
		position: "Engineer",
		location: "",
		period,
		description: "",
		hidden: false,
		website: { url: "", label: "", inlineLink: false },
		roles: [],
	};
}

async function flushMicrotasks() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

describe("builder resume autosave", () => {
	it("waits for a queued edit after an in-flight save before navigating", async () => {
		const initial = makeResume("navigation-queued");
		useResumeStore.getState().initialize(initial);
		routerParamsMock.value = { resumeId: initial.id };
		const hook = renderHook(() => useResumeCleanup());
		const completions: Array<(resume: Resume) => void> = [];
		orpcMocks.updateResume.mockImplementation(
			() =>
				new Promise<Resume>((resolve) => {
					completions.push(resolve);
				}),
		);
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "First";
		});
		await vi.advanceTimersByTimeAsync(500);
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Latest";
		});
		const blocker = useBlockerMock.mock.lastCall?.[0];
		let settled = false;
		const result = blocker.shouldBlockFn({ next: { params: {} } }).then((blocked: boolean) => {
			settled = true;
			return blocked;
		});
		assert.exists(completions[0]);
		completions[0](withBasicsName(initial, "First"));
		await flushMicrotasks();
		expect(settled).toBe(false);
		expect(orpcMocks.updateResume.mock.lastCall?.[0].data.basics.name).toBe("Latest");
		assert.exists(completions[1]);
		completions[1](withBasicsName(initial, "Latest"));
		expect(await result).toBe(false);
		expect(useResumeStore.getState().resume?.data.basics.name).toBe("Latest");
		hook.unmount();
	});

	it("ends a stalled navigation wait without aborting or discarding the pending save", async () => {
		const initial = makeResume("navigation-timeout");
		useResumeStore.getState().initialize(initial);
		routerParamsMock.value = { resumeId: initial.id };
		const hook = renderHook(() => useResumeCleanup());
		let complete!: (resume: Resume) => void;
		orpcMocks.updateResume.mockImplementationOnce(
			() =>
				new Promise<Resume>((resolve) => {
					complete = resolve;
				}),
		);
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Pending name";
		});
		const blocker = useBlockerMock.mock.lastCall?.[0];
		let settled = false;
		const result = blocker.shouldBlockFn({ next: { params: {} } }).then((blocked: boolean) => {
			settled = true;
			return blocked;
		});
		await vi.advanceTimersByTimeAsync(10000);
		expect(settled).toBe(true);
		expect(await result).toBe(true);
		expect(useResumeStore.getState().saveStatus).toBe("saving");
		expect(useResumeStore.getState().resume?.data.basics.name).toBe("Pending name");
		expect(orpcMocks.updateResume.mock.lastCall?.[1].signal.aborted).toBe(false);

		orpcMocks.updateResume.mockResolvedValueOnce(withBasicsName(initial, "Latest name"));
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Latest name";
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(orpcMocks.updateResume).toHaveBeenCalledTimes(1);
		complete(withBasicsName(initial, "Pending name"));
		await flushMicrotasks();
		expect(useResumeStore.getState().saveStatus).toBe("saved");
		expect(useResumeStore.getState().resume?.data.basics.name).toBe("Latest name");
		expect(await blocker.shouldBlockFn({ next: { params: {} } })).toBe(false);
		expect(orpcMocks.updateResume).toHaveBeenCalledTimes(2);
		hook.unmount();
	});

	beforeEach(() => {
		vi.useFakeTimers();
		orpcMocks.getResumeById.mockReset();
		useBlockerMock.mockReset();
		orpcMocks.patchResume.mockReset();
		orpcMocks.streamSubscribe.mockReset();
		orpcMocks.updateResume.mockReset();
		consumeEventIteratorMock.mockReset();
		queryClientMock.setQueryData.mockClear();
		routerParamsMock.value = {};
		i18n.loadAndActivate({ locale: "en-US", messages: {} });
		toastMocks.add.mockClear();
		toastMocks.close.mockClear();
		useResumeStore.getState().reset();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		useResumeStore.getState().reset();
	});

	it("keeps a failed draft in the builder and retries on the next navigation", async () => {
		const initial = makeResume("navigation-error");
		useResumeStore.getState().initialize(initial);
		routerParamsMock.value = { resumeId: initial.id };
		const hook = renderHook(() => useResumeCleanup());
		orpcMocks.updateResume.mockRejectedValueOnce(new Error("Offline"));
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Keep this draft";
		});
		const blocker = useBlockerMock.mock.lastCall?.[0];
		expect(blocker).toBeDefined();
		expect(await blocker.shouldBlockFn({ next: { params: {} } })).toBe(true);
		expect(useResumeStore.getState().resume?.data.basics.name).toBe("Keep this draft");
		expect(blocker.enableBeforeUnload()).toBe(true);
		orpcMocks.updateResume.mockResolvedValueOnce(withBasicsName(initial, "Keep this draft"));
		expect(await blocker.shouldBlockFn({ next: { params: {} } })).toBe(false);
		expect(blocker.enableBeforeUnload()).toBe(false);
		hook.unmount();
	});

	it("coalesces rapid local edits into one full-data update", async () => {
		const initial = makeResume("resume-rapid");
		const updated = withBasicsName(initial, "Latest Name");
		orpcMocks.updateResume.mockResolvedValue(updated);
		useResumeStore.getState().initialize(initial);

		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "First Name";
		});
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Latest Name";
		});

		vi.advanceTimersByTime(500);
		await flushMicrotasks();

		expect(orpcMocks.updateResume).toHaveBeenCalledTimes(1);
		expect(orpcMocks.updateResume).toHaveBeenCalledWith(
			{ id: initial.id, data: updated.data, sessionId: expect.any(String) },
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(orpcMocks.patchResume).not.toHaveBeenCalled();
	});

	it("saves the latest pending snapshot after an in-flight save resolves", async () => {
		const initial = makeResume("resume-in-flight");
		const first = withBasicsName(initial, "First Name");
		const latest = withBasicsName(initial, "Latest Name");
		let resolveFirst!: (resume: Resume) => void;

		orpcMocks.updateResume
			.mockReturnValueOnce(
				new Promise<Resume>((resolve) => {
					resolveFirst = resolve;
				}),
			)
			.mockResolvedValueOnce(latest);

		useResumeStore.getState().initialize(initial);
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "First Name";
		});

		vi.advanceTimersByTime(500);
		await flushMicrotasks();

		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Latest Name";
		});
		vi.advanceTimersByTime(500);
		await flushMicrotasks();

		expect(orpcMocks.updateResume).toHaveBeenCalledTimes(1);

		resolveFirst(first);
		await flushMicrotasks();

		expect(orpcMocks.updateResume).toHaveBeenCalledTimes(2);
		expect(orpcMocks.updateResume.mock.calls[0]?.[0]).toEqual({
			id: initial.id,
			data: first.data,
			sessionId: expect.any(String),
		});
		expect(orpcMocks.updateResume.mock.calls[1]?.[0]).toEqual({
			id: initial.id,
			data: latest.data,
			sessionId: expect.any(String),
		});
		expect(orpcMocks.patchResume).not.toHaveBeenCalled();
	});

	it("reports offline, keeps the draft on this device and sends it when the connection returns", async () => {
		const initial = makeResume("resume-offline");
		const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
		orpcMocks.updateResume.mockRejectedValueOnce(new TypeError("Failed to fetch"));
		useResumeStore.getState().initialize(initial);

		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Written offline";
		});
		vi.advanceTimersByTime(500);
		await flushMicrotasks();

		expect(useResumeStore.getState().saveStatus).toBe("offline");
		expect(readUnsavedResumeData("resume-offline")?.basics.name).toBe("Written offline");
		orpcMocks.updateResume.mockRejectedValueOnce(new TypeError("Failed to fetch"));
		expect(await savePendingChanges("resume-offline")).toBe(false);
		expect(toastMocks.add).toHaveBeenCalledWith(
			expect.objectContaining({ id: "resume-offline-navigation", description: expect.stringContaining("Reconnect") }),
		);

		onLine.mockReturnValue(true);
		orpcMocks.updateResume.mockImplementation((input: { id: string; data: ResumeData }) =>
			Promise.resolve({ ...makeResume(input.id), data: input.data }),
		);
		window.dispatchEvent(new Event("online"));
		await flushMicrotasks();
		await flushMicrotasks();

		expect(orpcMocks.updateResume).toHaveBeenLastCalledWith(
			expect.objectContaining({ id: "resume-offline" }),
			expect.anything(),
		);
		expect(useResumeStore.getState().saveStatus).toBe("saved");
		expect(readUnsavedResumeData("resume-offline")).toBeUndefined();
		onLine.mockRestore();
	});

	it("restores changes kept on this device when the editor opens again", async () => {
		const initial = makeResume("resume-restore");
		window.localStorage.setItem(
			"reactive-resume:unsaved:resume-restore",
			JSON.stringify({ data: withBasicsName(initial, "Kept locally").data, storedAt: 1 }),
		);
		orpcMocks.updateResume.mockImplementation((input: { id: string; data: ResumeData }) =>
			Promise.resolve({ ...makeResume(input.id), data: input.data }),
		);

		useResumeStore.getState().initialize(initial);
		await flushMicrotasks();

		expect(useResumeStore.getState().resume?.data.basics.name).toBe("Kept locally");
		expect(orpcMocks.updateResume).toHaveBeenCalledWith(
			expect.objectContaining({ id: "resume-restore" }),
			expect.anything(),
		);
		expect(toastMocks.add).toHaveBeenCalledWith(
			expect.objectContaining({ description: "Restored changes that hadn't been saved yet." }),
		);
	});
});

describe("builder resume undo/redo", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		orpcMocks.updateResume.mockReset();
		// Echo the submitted data back so the autosave completion doesn't count as an external rebase.
		orpcMocks.updateResume.mockImplementation((input: { id: string; data: ResumeData }) =>
			Promise.resolve({ ...makeResume(input.id), data: input.data }),
		);
		routerParamsMock.value = {};
		i18n.loadAndActivate({ locale: "en-US", messages: {} });
		useResumeStore.getState().reset();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		useResumeStore.getState().reset();
	});

	it("coalesces rapid edits into a single undo step and restores the pre-burst state", () => {
		const store = useResumeStore.getState;
		store().initialize(makeResume("undo-coalesce"));

		store().updateResumeData((draft) => {
			draft.basics.name = "First";
		});
		store().updateResumeData((draft) => {
			draft.basics.name = "Second";
		});

		expect(store().undoStack.length).toBe(1);
		expect(store().canUndo).toBe(true);
		expect(store().canRedo).toBe(false);
		expect(store().resume?.data.basics.name).toBe("Second");

		store().undo();
		expect(store().resume?.data.basics.name).toBe(defaultResumeData.basics.name);
		expect(store().canUndo).toBe(false);
		expect(store().canRedo).toBe(true);

		store().redo();
		expect(store().resume?.data.basics.name).toBe("Second");
		expect(store().canRedo).toBe(false);
	});

	it("merges typing in one field into one step, but not edits to different fields", () => {
		const store = useResumeStore.getState;
		store().initialize(makeResume("undo-fields"));

		store().updateResumeData(
			(draft) => {
				draft.basics.name = "J";
			},
			{ coalesceKey: "basics.name" },
		);
		store().updateResumeData(
			(draft) => {
				draft.basics.name = "Jo";
			},
			{ coalesceKey: "basics.name" },
		);
		store().updateResumeData(
			(draft) => {
				draft.basics.headline = "Designer";
			},
			{ coalesceKey: "basics.headline" },
		);

		expect(store().undoStack.length).toBe(2);
		store().undo();
		expect(store().resume?.data.basics.headline).toBe(defaultResumeData.basics.headline);
		expect(store().resume?.data.basics.name).toBe("Jo");
		store().undo();
		expect(store().resume?.data.basics.name).toBe(defaultResumeData.basics.name);
	});

	it("keeps structural actions as steps of their own", () => {
		const store = useResumeStore.getState;
		store().initialize(makeResume("undo-structural"));

		store().updateResumeData((draft) => {
			draft.basics.name = "A";
		});
		store().updateResumeData(
			(draft) => {
				draft.sections.skills.hidden = true;
			},
			{ newStep: true },
		);
		store().updateResumeData((draft) => {
			draft.basics.name = "B";
		});

		expect(store().undoStack.length).toBe(3);
	});

	it("merges a multi-edit action with the same key into one step, however long it takes", () => {
		const store = useResumeStore.getState;
		store().initialize(makeResume("undo-same-step"));
		const now = vi.spyOn(Date, "now");

		now.mockReturnValue(1_000);
		store().updateResumeData(
			(draft) => {
				draft.metadata.page.gapY = 4;
			},
			{ coalesceKey: "fit:1", sameStep: true },
		);
		now.mockReturnValue(9_000);
		store().updateResumeData(
			(draft) => {
				draft.metadata.page.marginX = 10;
			},
			{ coalesceKey: "fit:1", sameStep: true },
		);
		now.mockRestore();

		expect(store().undoStack).toHaveLength(1);
		store().undo();
		expect(store().resume?.data.metadata.page).toMatchObject({ gapY: 6, marginX: 14 });
	});

	it("restores the exact authored Experience order with one undo after a one-shot sort", () => {
		const store = useResumeStore.getState;
		const initial = makeResume("sort-undo");
		initial.data.sections.experience.items = [
			experienceItem("unknown", "Mystery Co", "Recently"),
			experienceItem("older", "Older Co", "2018 - 2020"),
			experienceItem("current", "Current Co", "2023 - Present"),
		];
		const authoredItems = cloneResumeData(initial.data).sections.experience.items;
		store().initialize(initial);

		store().updateResumeData((draft) => {
			draft.sections.experience.items = sortSectionItemsByPeriod(
				draft.sections.experience.items,
				draft.metadata.page.locale,
			).items;
		});

		expect(store().resume?.data.sections.experience.items.map(({ id }) => id)).toEqual(["current", "older", "unknown"]);
		expect(store().undoStack).toHaveLength(1);

		store().undo();
		expect(store().resume?.data.sections.experience.items).toEqual(authoredItems);
		expect(store().canUndo).toBe(false);
	});

	it("retains the chosen order through autosave/reload and never resorts later field edits", async () => {
		const store = useResumeStore.getState;
		const initial = makeResume("sort-persistence");
		initial.data.sections.experience.items = [
			experienceItem("older", "Older Co", "2018 - 2020"),
			experienceItem("current", "Current Co", "2023 - Present"),
		];
		let savedResume: Resume | undefined;
		orpcMocks.updateResume.mockImplementation((input: { id: string; data: ResumeData }) => {
			savedResume = { ...makeResume(input.id), data: cloneResumeData(input.data) };
			return Promise.resolve(savedResume);
		});
		store().initialize(initial);

		store().updateResumeData((draft) => {
			draft.sections.experience.items = sortSectionItemsByPeriod(
				draft.sections.experience.items,
				draft.metadata.page.locale,
			).items;
		});
		vi.advanceTimersByTime(500);
		await flushMicrotasks();

		expect(orpcMocks.updateResume).toHaveBeenCalledTimes(1);
		expect(savedResume?.data.sections.experience.items.map(({ id }) => id)).toEqual(["current", "older"]);
		if (!savedResume) throw new Error("expected the sorted resume to be saved");

		store().reset();
		store().initialize(savedResume);
		store().updateResumeData((draft) => {
			const currentItem = draft.sections.experience.items.find(({ id }) => id === "current");
			if (currentItem) currentItem.period = "2010 - 2011";
		});

		expect(store().resume?.data.sections.experience.items.map(({ id }) => id)).toEqual(["current", "older"]);
	});

	it("separates edits outside the coalesce window into distinct undo steps", async () => {
		const store = useResumeStore.getState;
		store().initialize(makeResume("undo-boundary"));

		store().updateResumeData((draft) => {
			draft.basics.name = "A";
		});

		// Let the autosave flush (echoes the data back) and advance past the coalesce window.
		vi.advanceTimersByTime(600);
		await flushMicrotasks();

		store().updateResumeData((draft) => {
			draft.basics.name = "B";
		});

		expect(store().undoStack.length).toBe(2);

		store().undo();
		expect(store().resume?.data.basics.name).toBe("A");

		store().undo();
		expect(store().resume?.data.basics.name).toBe(defaultResumeData.basics.name);
	});

	it("clears the redo branch when a new edit follows an undo", () => {
		const store = useResumeStore.getState;
		store().initialize(makeResume("undo-redo-clear"));

		store().updateResumeData((draft) => {
			draft.basics.name = "One";
		});
		store().undo();
		expect(store().canRedo).toBe(true);

		store().updateResumeData((draft) => {
			draft.basics.name = "Two";
		});

		expect(store().canRedo).toBe(false);
		expect(store().redoStack.length).toBe(0);
	});

	it("preserves the undo stack when the server echoes the current data (autosave)", () => {
		const store = useResumeStore.getState;
		store().initialize(makeResume("rebase-echo"));

		store().updateResumeData((draft) => {
			draft.basics.name = "Edited";
		});
		expect(store().undoStack.length).toBe(1);

		const current = store().resume;
		if (!current) throw new Error("expected a current resume");
		// Autosave echo: the server returns data identical to what's already in the store.
		store().replaceResumeFromServer({ ...current, data: cloneResumeData(current.data) });

		expect(store().undoStack.length).toBe(1);
		expect(store().canUndo).toBe(true);
	});

	it("clears the undo stack when the server sends different data (external rebase)", () => {
		const store = useResumeStore.getState;
		store().initialize(makeResume("rebase-external"));

		store().updateResumeData((draft) => {
			draft.basics.name = "Edited";
		});
		expect(store().undoStack.length).toBe(1);

		const current = store().resume;
		if (!current) throw new Error("expected a current resume");
		// External / AI rebase: incoming data differs, so the local undo history no longer applies.
		store().replaceResumeFromServer(withBasicsName(current, "External Name"));

		expect(store().undoStack.length).toBe(0);
		expect(store().canUndo).toBe(false);
	});
});

describe("resume update stream subscription", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		orpcMocks.streamSubscribe.mockReset();
		consumeEventIteratorMock.mockReset();
		orpcMocks.getResumeById.mockReset();
		queryClientMock.setQueryData.mockClear();
		routerParamsMock.value = {};
		i18n.loadAndActivate({ locale: "en-US", messages: {} });
		useResumeStore.getState().reset();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		useResumeStore.getState().reset();
	});

	it("resubscribes after the stream errors", () => {
		const onUpdate = vi.fn().mockResolvedValue(undefined);
		const onError = vi.fn();
		consumeEventIteratorMock.mockReturnValue(vi.fn().mockResolvedValue(undefined));

		renderHook(() => useResumeUpdateSubscription({ resumeId: "resume-retry", onUpdate, onError }));
		expect(orpcMocks.streamSubscribe).toHaveBeenCalledTimes(1);

		const handlers = consumeEventIteratorMock.mock.calls[0]?.[1] as { onError: (error: unknown) => void };
		act(() => handlers.onError(new Error("stream dropped")));
		expect(onError).toHaveBeenCalledTimes(1);

		act(() => {
			vi.advanceTimersByTime(2500);
		});
		expect(orpcMocks.streamSubscribe).toHaveBeenCalledTimes(2);
	});

	it("replaces the builder draft from the server when there are no pending local edits", async () => {
		const initial = makeResume("resume-clean");
		const remote = withBasicsName(initial, "Remote Name");
		const cancel = vi.fn().mockResolvedValue(undefined);
		consumeEventIteratorMock.mockReturnValue(cancel);
		orpcMocks.getResumeById.mockResolvedValue(remote);
		routerParamsMock.value = { resumeId: initial.id };
		useResumeStore.getState().initialize(initial);

		renderHook(() => useBuilderResumeUpdateSubscription());
		const handlers = consumeEventIteratorMock.mock.calls[0]?.[1] as { onEvent: () => Promise<void> } | undefined;

		await act(async () => {
			await handlers?.onEvent();
		});

		expect(queryClientMock.setQueryData).toHaveBeenCalledWith(["resume", "getById", initial.id], remote);
		expect(useResumeStore.getState().resume?.data.basics.name).toBe("Remote Name");
	});

	it("does not overwrite pending local builder edits when a remote update arrives", async () => {
		const initial = makeResume("resume-pending");
		const remote = withBasicsName(initial, "Remote Name");
		const cancel = vi.fn().mockResolvedValue(undefined);
		consumeEventIteratorMock.mockReturnValue(cancel);
		orpcMocks.getResumeById.mockResolvedValue(remote);
		routerParamsMock.value = { resumeId: initial.id };
		useResumeStore.getState().initialize(initial);
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Local Name";
		});

		renderHook(() => useBuilderResumeUpdateSubscription());
		const handlers = consumeEventIteratorMock.mock.calls[0]?.[1] as { onEvent: () => Promise<void> } | undefined;

		await act(async () => {
			await handlers?.onEvent();
		});

		expect(queryClientMock.setQueryData).toHaveBeenCalledWith(["resume", "getById", initial.id], remote);
		expect(useResumeStore.getState().resume?.data.basics.name).toBe("Local Name");
	});
});
