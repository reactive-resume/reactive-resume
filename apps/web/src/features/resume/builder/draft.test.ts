// @vitest-environment happy-dom

import type { Resume } from "./draft";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { act, renderHook } from "@testing-library/react";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { ORPCError } from "@orpc/client";
import { sortSectionItemsByPeriod } from "@reactive-resume/resume/section-sort";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import {
	clearResumeDrafts,
	readUnsavedResumeData,
	savePendingChanges,
	saveResumeMetadata,
	useBuilderResumeUpdateSubscription,
	useResumeCleanup,
	useResumeStore,
	useResumeUpdateSubscription,
} from "./draft";

const orpcMocks = vi.hoisted(() => ({
	getResumeById: vi.fn(),
	importResume: vi.fn(),
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

vi.mock("@orpc/client", async (importOriginal) => ({
	ORPCError: (await importOriginal<typeof import("@orpc/client")>()).ORPCError,
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
		documents: { key: () => ["documents"] },
		resume: {
			getById: {
				call: orpcMocks.getResumeById,
				queryOptions: ({ input }: { input: { id: string } }) => ({
					queryKey: ["resume", "getById", input.id],
				}),
			},
			import: { call: orpcMocks.importResume },
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

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
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
		orpcMocks.importResume.mockReset();
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
		clearResumeDrafts();
		window.localStorage.clear();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		clearResumeDrafts();
		window.localStorage.clear();
	});

	it("keeps edits during a rename until its revision is acknowledged, preserving Undo", async () => {
		const store = useResumeStore.getState;
		const initial = makeResume("metadata-write");
		store().initialize(initial);
		const response = deferred<Resume>();
		const write = vi.fn(() => response.promise);
		const renaming = saveResumeMetadata(initial.id, write);
		await flushMicrotasks();
		expect(write).toHaveBeenCalledTimes(1);
		store().updateResumeData((draft) => {
			draft.basics.name = "Later name";
		});
		const renamed = { ...initial, name: "Renamed again", updatedAt: new Date(initial.updatedAt.getTime() + 1000) };
		const saved = { ...withBasicsName(renamed, "Later name"), updatedAt: new Date(renamed.updatedAt.getTime() + 1000) };
		orpcMocks.updateResume.mockResolvedValueOnce(saved);
		await vi.advanceTimersByTimeAsync(500);
		expect(orpcMocks.updateResume).not.toHaveBeenCalled();
		response.resolve(renamed);
		await renaming;
		await flushMicrotasks();
		expect(orpcMocks.updateResume.mock.lastCall?.[0].expectedUpdatedAt).toEqual(renamed.updatedAt);
		expect(store().saveStatus).toBe("saved");
		expect(store().resume).toMatchObject({ name: "Renamed again", data: { basics: { name: "Later name" } } });
		store().replaceResumeFromServer(saved);
		expect(store().undoStack).toHaveLength(1);
	});

	it("finishes an in-flight body save before renaming, then saves from the rename revision", async () => {
		const initial = makeResume("metadata-inflight");
		useResumeStore.getState().initialize(initial);
		const body = deferred<Resume>();
		const saved = {
			...withBasicsName(initial, "Before rename"),
			updatedAt: new Date(initial.updatedAt.getTime() + 1000),
		};
		const flushed = { ...saved, updatedAt: new Date(saved.updatedAt.getTime() + 1000) };
		orpcMocks.updateResume.mockImplementationOnce(() => body.promise).mockResolvedValueOnce(flushed);
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Before rename";
		});
		await vi.advanceTimersByTimeAsync(500);
		const renamed = { ...flushed, name: "Manual title", updatedAt: new Date(flushed.updatedAt.getTime() + 1000) };
		const write = vi.fn(async (expectedUpdatedAt?: Date) => {
			if (expectedUpdatedAt?.getTime() !== flushed.updatedAt.getTime()) throw new ORPCError("RESUME_VERSION_CONFLICT");
			return renamed;
		});
		const renaming = saveResumeMetadata(initial.id, write);
		await flushMicrotasks();
		expect(write).not.toHaveBeenCalled();
		body.resolve(saved);
		await renaming;
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.headline = "After rename";
		});
		orpcMocks.updateResume.mockResolvedValueOnce({ ...renamed, data: useResumeStore.getState().resume?.data });
		await vi.advanceTimersByTimeAsync(500);
		expect(orpcMocks.updateResume.mock.lastCall?.[0].expectedUpdatedAt).toEqual(renamed.updatedAt);
		expect(useResumeStore.getState().resume?.name).toBe("Manual title");
	});

	it("waits for an own metadata response before applying its early stream echo", async () => {
		const initial = makeResume("metadata-early-echo");
		routerParamsMock.value = { resumeId: initial.id };
		useResumeStore.getState().initialize(initial);
		const saved = { ...withBasicsName(initial, "Saved name"), updatedAt: new Date(initial.updatedAt.getTime() + 1000) };
		orpcMocks.updateResume.mockResolvedValueOnce(saved);
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Saved name";
		});
		await vi.advanceTimersByTimeAsync(500);
		const response = deferred<Resume>();
		const renamed = { ...saved, name: "Manual title", updatedAt: new Date(saved.updatedAt.getTime() + 1000) };
		const writing = saveResumeMetadata(initial.id, () => response.promise);
		await flushMicrotasks();
		orpcMocks.getResumeById.mockResolvedValueOnce(renamed);
		consumeEventIteratorMock.mockReturnValueOnce(async () => undefined);
		const hook = renderHook(() => useBuilderResumeUpdateSubscription());
		const handler = consumeEventIteratorMock.mock.lastCall?.[1].onEvent;
		assert(handler);
		const event = handler({ mutation: "update" });
		await flushMicrotasks();
		expect(useResumeStore.getState().undoStack).toHaveLength(1);
		expect(useResumeStore.getState().resume?.name).toBe(saved.name);
		response.resolve(renamed);
		await writing;
		await event;
		expect(useResumeStore.getState().undoStack).toHaveLength(1);
		expect(useResumeStore.getState().resume?.name).toBe("Manual title");
		hook.unmount();
	});

	it("releases a stalled metadata request and stream, ignoring its late answer", async () => {
		const initial = makeResume("metadata-stalled");
		routerParamsMock.value = { resumeId: initial.id };
		useResumeStore.getState().initialize(initial);
		const answer = deferred<Resume>();
		const write = vi.fn((_expected?: Date, _options?: { signal: AbortSignal }) => answer.promise);
		let failure: unknown;
		const writing = saveResumeMetadata(initial.id, write).catch((error: unknown) => {
			failure = error;
		});
		await flushMicrotasks();
		const remote = {
			...withBasicsName(initial, "Remote body"),
			name: "Remote title",
			updatedAt: new Date(initial.updatedAt.getTime() + 2000),
		};
		orpcMocks.getResumeById.mockResolvedValueOnce(remote);
		consumeEventIteratorMock.mockReturnValueOnce(async () => undefined);
		const hook = renderHook(() => useBuilderResumeUpdateSubscription());
		const event = consumeEventIteratorMock.mock.lastCall?.[1].onEvent({ mutation: "update" });
		await flushMicrotasks();
		expect(useResumeStore.getState().resume?.data.basics.name).toBe(initial.data.basics.name);
		await vi.advanceTimersByTimeAsync(10_000);
		expect(failure).toMatchObject({ name: "TimeoutError" });
		await writing;
		await event;
		expect(write.mock.lastCall?.[1]?.signal.aborted).toBe(true);
		expect(useResumeStore.getState().resume).toMatchObject(remote);
		answer.resolve({ ...initial, name: "Late title", updatedAt: new Date(initial.updatedAt.getTime() + 1000) });
		await flushMicrotasks();
		expect(useResumeStore.getState().resume).toMatchObject(remote);
		const next = { ...remote, name: "Next title", updatedAt: new Date(remote.updatedAt.getTime() + 1000) };
		const nextWrite = vi.fn(async (expected?: Date) => {
			expect(expected).toEqual(remote.updatedAt);
			return next;
		});
		await saveResumeMetadata(initial.id, nextWrite);
		expect(useResumeStore.getState().resume?.name).toBe(next.name);
		hook.unmount();
	});

	it("refuses an unversioned metadata write without an open draft", async () => {
		const answer = deferred<Resume>();
		const write = vi.fn((_expected?: Date, _options?: { signal: AbortSignal }) => answer.promise);
		let failure: unknown;
		const writing = saveResumeMetadata("library-rename", write).catch((error: unknown) => {
			failure = error;
		});
		await vi.advanceTimersByTimeAsync(10_000);
		expect(failure).toMatchObject({ name: "AbortError" });
		await writing;
		expect(write).not.toHaveBeenCalled();
		answer.resolve(makeResume("library-rename"));
	});

	it("invalidates unproven same-body revisions after metadata timeout, including receipt history", async () => {
		const store = useResumeStore.getState;
		const initial = makeResume("metadata-unproven-echo");
		routerParamsMock.value = { resumeId: initial.id };
		store().initialize(initial);
		let server = initial;
		orpcMocks.updateResume.mockImplementation(async ({ data }: { data: ResumeData }) => {
			server = { ...server, data, updatedAt: new Date(server.updatedAt.getTime() + 1000) };
			return server;
		});
		store().updateResumeData(
			(draft) => {
				draft.summary.content = "<p>Accepted</p>";
			},
			{ newStep: true, applied: [{ id: "edit", after: "<p>Accepted</p>" }] },
		);
		expect(await savePendingChanges(initial.id)).toBe(true);
		store().updateResumeData(
			(draft) => {
				draft.basics.headline = "Later edit";
			},
			{ newStep: true },
		);
		expect(await savePendingChanges(initial.id)).toBe(true);
		store().undo();
		expect(await savePendingChanges(initial.id)).toBe(true);
		expect(store().undoStack).toHaveLength(1);
		expect(store().redoStack).toHaveLength(1);
		expect(store().proposalApplications).toEqual({ edit: "<p>Accepted</p>" });

		const answer = deferred<Resume>();
		const writing = saveResumeMetadata(initial.id, () => answer.promise);
		const rejected = expect(writing).rejects.toMatchObject({ name: "TimeoutError" });
		await flushMicrotasks();
		// This read is indistinguishable from a rename followed by another client's receipt-only Undo.
		const remote = { ...server, name: "Unproven rename", updatedAt: new Date(server.updatedAt.getTime() + 1000) };
		orpcMocks.getResumeById.mockResolvedValueOnce(remote);
		consumeEventIteratorMock.mockReturnValueOnce(async () => undefined);
		const hook = renderHook(() => useBuilderResumeUpdateSubscription());
		const event = consumeEventIteratorMock.mock.lastCall?.[1].onEvent({ mutation: "update" });
		await vi.advanceTimersByTimeAsync(10_000);
		await rejected;
		await event;
		expect(store().resume?.data).toEqual(server.data);
		expect(store().undoStack).toEqual([]);
		expect(store().redoStack).toEqual([]);
		expect(store().proposalApplications).toEqual({});
		answer.resolve(remote);
		await flushMicrotasks();
		store().redo();
		expect(store().proposalApplications).toEqual({});
		expect(orpcMocks.updateResume).toHaveBeenCalledTimes(3);
		hook.unmount();
	});

	it("keeps pending edits and receipts on the old revision after an uncertain metadata timeout", async () => {
		const initial = makeResume("metadata-stalled-draft");
		useResumeStore.getState().initialize(initial);
		const answer = deferred<Resume>();
		let failure: unknown;
		const writing = saveResumeMetadata(initial.id, () => answer.promise).catch((error: unknown) => {
			failure = error;
		});
		await flushMicrotasks();
		useResumeStore.getState().updateResumeData(
			(draft) => {
				draft.summary.content = "<p>Keep this proposal</p>";
			},
			{ newStep: true, applied: [{ id: "pending-proposal", after: "<p>Keep this proposal</p>" }] },
		);
		orpcMocks.updateResume.mockRejectedValueOnce(new ORPCError("RESUME_VERSION_CONFLICT"));
		await vi.advanceTimersByTimeAsync(10_000);
		expect(failure).toMatchObject({ name: "TimeoutError" });
		await writing;
		expect(orpcMocks.updateResume).toHaveBeenCalledTimes(1);
		expect(orpcMocks.updateResume.mock.lastCall?.[0].expectedUpdatedAt).toEqual(initial.updatedAt);
		expect(useResumeStore.getState().saveStatus).toBe("conflict");
		expect(useResumeStore.getState().undoStack).toHaveLength(1);
		expect(useResumeStore.getState().resume?.data.summary.content).toBe("<p>Keep this proposal</p>");
		const recovery = Object.entries(window.localStorage).find(([key]) => key.includes(initial.id));
		assert(recovery);
		expect(JSON.parse(recovery[1])).toMatchObject({
			baseUpdatedAt: initial.updatedAt.toISOString(),
			pendingProposalApplications: { "pending-proposal": "<p>Keep this proposal</p>" },
		});
		answer.resolve({ ...initial, name: "Late title", updatedAt: new Date(initial.updatedAt.getTime() + 1000) });
		await flushMicrotasks();
		expect(useResumeStore.getState().resume?.name).toBe(initial.name);
		expect(useResumeStore.getState().saveStatus).toBe("conflict");
		expect(orpcMocks.updateResume).toHaveBeenCalledTimes(1);
	});

	it("keeps the draft and does not send metadata if its earlier body save failed", async () => {
		const initial = makeResume("metadata-flush-error");
		useResumeStore.getState().initialize(initial);
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Unsaved name";
		});
		orpcMocks.updateResume.mockRejectedValueOnce(new Error("Network failure"));
		const write = vi.fn(async () => initial);
		await expect(saveResumeMetadata(initial.id, write)).rejects.toThrow("Couldn't save your changes");
		expect(write).not.toHaveBeenCalled();
		expect(useResumeStore.getState().resume?.data.basics.name).toBe("Unsaved name");
		expect(useResumeStore.getState().saveStatus).toBe("error");
	});

	it.each([false, true])("serializes separate metadata requests after earlier failure=%s", async (fails) => {
		const initial = makeResume("metadata-serialized");
		useResumeStore.getState().initialize(initial);
		const first = deferred<Resume>();
		const earlier = saveResumeMetadata(initial.id, () => first.promise).catch((error: unknown) => error);
		const renamed = { ...initial, name: "Second request", updatedAt: new Date(initial.updatedAt.getTime() + 2000) };
		const write = vi.fn(async (expected?: Date) => {
			expect(expected).toEqual(fails ? initial.updatedAt : new Date(initial.updatedAt.getTime() + 1000));
			return renamed;
		});
		const later = saveResumeMetadata(initial.id, write);
		await flushMicrotasks();
		expect(write).not.toHaveBeenCalled();
		if (fails) first.reject(new Error("Metadata rejected"));
		else first.resolve({ ...initial, name: "First request", updatedAt: new Date(initial.updatedAt.getTime() + 1000) });
		await earlier;
		await later;
		expect(write).toHaveBeenCalledTimes(1);
		expect(useResumeStore.getState().resume?.name).toBe("Second request");
	});

	it("never sends a queued metadata write after its visit is cleared", async () => {
		const initial = makeResume("metadata-cancelled");
		useResumeStore.getState().initialize(initial);
		const first = deferred<Resume>();
		const earlier = saveResumeMetadata(initial.id, () => first.promise);
		const earlierRejected = expect(earlier).rejects.toMatchObject({ name: "AbortError" });
		await flushMicrotasks();
		const write = vi.fn(async () => initial);
		const later = saveResumeMetadata(initial.id, write);
		const rejected = expect(later).rejects.toMatchObject({ name: "AbortError" });
		clearResumeDrafts();
		first.resolve(initial);
		await earlierRejected;
		await rejected;
		expect(write).not.toHaveBeenCalled();
	});

	it("never applies an old visit's delayed metadata stream event to a new visit", async () => {
		const initial = makeResume("metadata-stream-visit");
		routerParamsMock.value = { resumeId: initial.id };
		useResumeStore.getState().initialize(initial);
		const response = deferred<Resume>();
		const writing = saveResumeMetadata(initial.id, () => response.promise);
		const rejected = expect(writing).rejects.toMatchObject({ name: "AbortError" });
		await flushMicrotasks();
		const old = { ...withBasicsName(initial, "Old visit"), updatedAt: new Date(initial.updatedAt.getTime() + 1000) };
		orpcMocks.getResumeById.mockResolvedValueOnce(old);
		consumeEventIteratorMock.mockReturnValueOnce(async () => undefined);
		const hook = renderHook(() => useBuilderResumeUpdateSubscription());
		const event = consumeEventIteratorMock.mock.lastCall?.[1].onEvent({ mutation: "update" });
		await flushMicrotasks();
		clearResumeDrafts();
		const current = withBasicsName(initial, "New visit");
		useResumeStore.getState().initialize(current);
		await rejected;
		await event;
		response.resolve(old);
		await flushMicrotasks();
		expect(useResumeStore.getState().resume).toMatchObject(current);
		hook.unmount();
	});

	it("does not send metadata if its visit ends while the pending-save check settles", async () => {
		const initial = makeResume("metadata-flush-cancelled");
		useResumeStore.getState().initialize(initial);
		const write = vi.fn(async () => initial);
		const saving = saveResumeMetadata(initial.id, write);
		const rejected = expect(saving).rejects.toMatchObject({ name: "AbortError" });
		await Promise.resolve();
		clearResumeDrafts();
		await rejected;
		expect(write).not.toHaveBeenCalled();
	});

	it("recognizes a metadata-only write when stored data still needs read normalization", async () => {
		const initial = makeResume("metadata-legacy");
		const raw = cloneResumeData(initial.data);
		delete raw.summary.showHeading;
		for (const section of Object.values(raw.sections)) delete section.showHeading;
		initial.data = parseResumeData(raw);
		useResumeStore.getState().initialize(initial);
		const renamed = {
			...initial,
			data: raw,
			name: "Renamed legacy",
			updatedAt: new Date(initial.updatedAt.getTime() + 1000),
		};
		await saveResumeMetadata(initial.id, async () => renamed);
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.headline = "After legacy rename";
		});
		orpcMocks.updateResume.mockResolvedValueOnce({ ...renamed, data: useResumeStore.getState().resume?.data });
		await vi.advanceTimersByTimeAsync(500);
		expect(orpcMocks.updateResume.mock.lastCall?.[0].expectedUpdatedAt).toEqual(renamed.updatedAt);
	});

	it("does not certify an unseen receipt-only revision through a metadata write", async () => {
		const store = useResumeStore.getState;
		const initial = makeResume("metadata-foreign-receipt");
		initial.data.summary.content = "<p>Original</p>";
		store().initialize(initial);
		let server = initial;
		orpcMocks.updateResume.mockImplementation(async ({ data }: { data: ResumeData }) => {
			server = { ...server, data, updatedAt: new Date(server.updatedAt.getTime() + 1000) };
			return server;
		});
		store().updateResumeData(
			(draft) => {
				draft.summary.content = "<p>Accepted</p>";
			},
			{ newStep: true, applied: [{ id: "edit", after: "<p>Accepted</p>" }] },
		);
		expect(await savePendingChanges(initial.id)).toBe(true);
		store().updateResumeData((draft) => {
			draft.summary.content = initial.data.summary.content;
		});
		expect(await savePendingChanges(initial.id)).toBe(true);
		const acceptedRevision = server.updatedAt;
		// Another client undoes only the receipt; body equality cannot prove the revision is ours.
		server = { ...server, updatedAt: new Date(server.updatedAt.getTime() + 1000) };
		const write = vi.fn(async (expectedUpdatedAt?: Date) => {
			if (expectedUpdatedAt && expectedUpdatedAt.getTime() !== server.updatedAt.getTime())
				throw new ORPCError("RESUME_VERSION_CONFLICT");
			server = { ...server, name: "Renamed", updatedAt: new Date(server.updatedAt.getTime() + 1000) };
			return server;
		});
		await expect(saveResumeMetadata(initial.id, write)).rejects.toMatchObject({ code: "RESUME_VERSION_CONFLICT" });
		expect(write).toHaveBeenCalledTimes(1);
		expect(server.name).toBe(initial.name);
		expect(store().resume?.updatedAt).toEqual(acceptedRevision);
		store().replaceResumeFromServer(server);
		expect(store().proposalApplications).toEqual({});
		expect(store().undoStack).toEqual([]);
		const recovery = Object.entries(window.localStorage).filter(([key]) => key.includes(initial.id));
		expect(recovery).toEqual([]);
	});

	it.each([
		[
			"another write came in between",
			(resume: Resume) => withBasicsName(resume, "From another tab"),
			1000,
			false,
			"Renamed",
		],
		["it answers an earlier visit", (resume: Resume) => resume, 1000, true, "Resume"],
		["the visit already holds a newer revision", (resume: Resume) => resume, -1000, false, "Resume"],
	])("keeps the autosave revision when a rename response %s", async (_, server, ms, revisit, name) => {
		const initial = makeResume("metadata-write-guarded");
		useResumeStore.getState().initialize(initial);
		const answer = deferred<Resume>();
		const writing = saveResumeMetadata(initial.id, () => answer.promise);
		const result = revisit ? expect(writing).rejects.toMatchObject({ name: "AbortError" }) : writing;
		await flushMicrotasks();
		if (revisit) {
			clearResumeDrafts();
			useResumeStore.getState().initialize(initial);
		}
		answer.resolve({ ...server(initial), name: "Renamed", updatedAt: new Date(initial.updatedAt.getTime() + ms) });
		await result;
		expect(useResumeStore.getState().resume?.name).toBe(name);
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.headline = "Later headline";
		});
		orpcMocks.updateResume.mockResolvedValueOnce(initial);
		await vi.advanceTimersByTimeAsync(500);

		expect(orpcMocks.updateResume.mock.lastCall?.[0].expectedUpdatedAt).toEqual(initial.updatedAt);
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

	it("initializes and autosaves rapid edits without crypto.randomUUID (HTTP LAN origins)", async () => {
		vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
		const initial = makeResume("resume-rapid");
		const updated = withBasicsName(initial, "Latest Name");
		orpcMocks.updateResume.mockResolvedValue(updated);
		useResumeStore.getState().initialize(initial);
		expect(useResumeStore.getState().isReady).toBe(true);

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
			{
				id: initial.id,
				data: updated.data,
				expectedUpdatedAt: initial.updatedAt,
				sessionId: expect.any(String),
				proposalSafety: "v1",
			},
			expect.objectContaining({ signal: expect.any(AbortSignal) }),
		);
		expect(orpcMocks.patchResume).not.toHaveBeenCalled();
		expect(useResumeStore.getState().saveStatus).toBe("saved");
	});

	it("saves the latest pending snapshot after an in-flight save resolves", async () => {
		const initial = makeResume("resume-in-flight");
		const first = { ...withBasicsName(initial, "First Name"), updatedAt: new Date(initial.updatedAt.getTime() + 1) };
		const latest = { ...withBasicsName(initial, "Latest Name"), updatedAt: new Date(first.updatedAt.getTime() + 1) };
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
			expectedUpdatedAt: initial.updatedAt,
			sessionId: expect.any(String),
			proposalSafety: "v1",
		});
		expect(orpcMocks.updateResume.mock.calls[1]?.[0]).toEqual({
			id: initial.id,
			data: latest.data,
			expectedUpdatedAt: first.updatedAt,
			sessionId: expect.any(String),
			proposalSafety: "v1",
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

	it("does not recreate private recovery data after account cleanup during a failed save", async () => {
		let failSave = (_error: Error): void => {
			throw new Error("Save did not start");
		};
		const pending = new Promise<Resume>((_resolve, reject) => {
			failSave = reject;
		});
		orpcMocks.updateResume.mockReturnValueOnce(pending);
		useResumeStore.getState().initialize(makeResume("departing"));
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Private";
		});
		vi.advanceTimersByTime(500);
		await flushMicrotasks();
		clearResumeDrafts();
		window.localStorage.clear();
		failSave(new Error("late network failure"));
		await flushMicrotasks();
		expect(readUnsavedResumeData("departing")).toBeUndefined();
		expect(useResumeStore.getState().resume).toBeNull();
	});

	it("pauses a conflicted draft across typing, retry, reconnect and navigation", async () => {
		const initial = makeResume("version-conflict");
		useResumeStore.getState().initialize(initial);
		orpcMocks.updateResume.mockRejectedValue(new ORPCError("RESUME_VERSION_CONFLICT", { status: 409 }));
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Mine";
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(useResumeStore.getState().saveStatus).toBe("conflict");
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Still mine";
		});
		await vi.advanceTimersByTimeAsync(500);
		useResumeStore.getState().retrySave();
		window.dispatchEvent(new Event("online"));
		expect(await savePendingChanges(initial.id)).toBe(false);
		expect(orpcMocks.updateResume).toHaveBeenCalledTimes(1);
		expect(useResumeStore.getState().saveStatus).toBe("conflict");
		expect(readUnsavedResumeData(initial.id)?.basics.name).toBe("Still mine");
	});

	it.each(["stale", "legacy"])("does not send a %s recovered draft over newer server data", async (kind) => {
		const initial = makeResume(`recovery-${kind}`);
		window.localStorage.setItem(
			`reactive-resume:unsaved:${initial.id}`,
			JSON.stringify({
				data: withBasicsName(initial, "Recovered typing").data,
				storedAt: Date.now(),
				...(kind === "stale" ? { baseUpdatedAt: new Date(initial.updatedAt.getTime() - 1) } : {}),
			}),
		);
		useResumeStore.getState().initialize(initial);
		await flushMicrotasks();
		expect(orpcMocks.updateResume).not.toHaveBeenCalled();
		expect(useResumeStore.getState().saveStatus).toBe("conflict");
		expect(useResumeStore.getState().resume?.data.basics.name).toBe("Recovered typing");
	});

	it.each(["success", "failure", "typing"])("keeps local edits safe when reload ends with %s", async (outcome) => {
		const initial = makeResume(`reload-${outcome}`);
		const remote = { ...withBasicsName(initial, "Theirs"), updatedAt: new Date(initial.updatedAt.getTime() + 1) };
		useResumeStore.getState().initialize(initial);
		orpcMocks.updateResume.mockRejectedValueOnce(new ORPCError("RESUME_VERSION_CONFLICT", { status: 409 }));
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Mine";
		});
		await vi.advanceTimersByTimeAsync(500);
		let finishCopy!: (id: string) => void;
		orpcMocks.importResume.mockReturnValueOnce(
			new Promise<string>((resolve) => {
				finishCopy = resolve;
			}),
		);
		orpcMocks.updateResume.mockResolvedValue(withBasicsName(initial, "Mine"));
		orpcMocks.getResumeById.mockImplementation(() =>
			outcome === "failure" ? Promise.reject(new Error("Network error")) : Promise.resolve(remote),
		);
		const reload = useResumeStore.getState().reloadFromServer();
		if (outcome === "typing")
			useResumeStore.getState().updateResumeData((draft) => {
				draft.basics.name = "More typing";
			});
		finishCopy("my-copy");
		if (outcome === "success") {
			await reload;
			expect(useResumeStore.getState().resume?.data.basics.name).toBe("Theirs");
			expect(useResumeStore.getState().saveStatus).toBe("saved");
			expect(readUnsavedResumeData(initial.id)).toBeUndefined();
		} else {
			await expect(reload).rejects.toThrow(outcome === "failure" ? "Network error" : "Your changes are still open");
			expect(useResumeStore.getState().saveStatus).toBe("conflict");
			expect(readUnsavedResumeData(initial.id)?.basics.name).toBe(outcome === "typing" ? "More typing" : "Mine");
			orpcMocks.getResumeById.mockResolvedValue(remote);
			await useResumeStore.getState().reloadFromServer();
			expect(orpcMocks.importResume).toHaveBeenCalledTimes(1);
		}
		expect(orpcMocks.updateResume.mock.lastCall?.[0]).toMatchObject({
			id: "my-copy",
			name: "Resume (mine)",
			data: { basics: { name: outcome === "typing" ? "More typing" : "Mine" } },
		});
	});

	it("recovers queued typing against the version returned by its earlier in-flight save", async () => {
		const initial = makeResume("queued-recovery");
		const first = { ...withBasicsName(initial, "First"), updatedAt: new Date(initial.updatedAt.getTime() + 1) };
		let finishFirst!: (resume: Resume) => void;
		orpcMocks.updateResume
			.mockReturnValueOnce(
				new Promise<Resume>((resolve) => {
					finishFirst = resolve;
				}),
			)
			.mockRejectedValueOnce(new Error("Connection lost"));
		useResumeStore.getState().initialize(initial);
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "First";
		});
		await vi.advanceTimersByTimeAsync(500);
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Latest";
		});
		await vi.advanceTimersByTimeAsync(500);
		finishFirst(first);
		await flushMicrotasks();
		clearResumeDrafts();
		orpcMocks.updateResume.mockImplementation((input: { data: ResumeData; expectedUpdatedAt?: Date }) => {
			if (input.expectedUpdatedAt?.getTime() !== first.updatedAt.getTime())
				throw new ORPCError("RESUME_VERSION_CONFLICT", { status: 409 });
			return Promise.resolve({ ...first, data: input.data });
		});
		useResumeStore.getState().initialize(first);
		await flushMicrotasks();
		expect(useResumeStore.getState().saveStatus).toBe("saved");
		expect(useResumeStore.getState().resume?.data.basics.name).toBe("Latest");
	});

	it("leaves another visit's recovery intact after saving", async () => {
		const initial = makeResume("other-visit");
		useResumeStore.getState().initialize(initial);
		const recovery = JSON.stringify({
			data: withBasicsName(initial, "Other typing").data,
			baseUpdatedAt: initial.updatedAt,
			storedAt: Date.now(),
		});
		window.localStorage.setItem(`reactive-resume:unsaved:${initial.id}:other`, recovery);
		orpcMocks.updateResume.mockResolvedValue(withBasicsName(initial, "Mine"));
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Mine";
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(useResumeStore.getState().saveStatus).toBe("saved");
		expect(window.localStorage.getItem(`reactive-resume:unsaved:${initial.id}:other`)).toBe(recovery);
	});

	it("expires local recovery after seven days", () => {
		window.localStorage.setItem(
			"reactive-resume:unsaved:expired",
			JSON.stringify({ data: defaultResumeData, storedAt: Date.now() - 8 * 86_400_000 }),
		);
		expect(readUnsavedResumeData("expired")).toBeUndefined();
		expect(window.localStorage.getItem("reactive-resume:unsaved:expired")).toBeNull();
	});

	it("restores changes kept on this device when the editor opens again", async () => {
		const initial = makeResume("resume-restore");
		window.localStorage.setItem(
			"reactive-resume:unsaved:resume-restore",
			JSON.stringify({
				data: withBasicsName(initial, "Kept locally").data,
				storedAt: Date.now(),
				baseUpdatedAt: initial.updatedAt,
			}),
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

	it("never vouches for what an older app kept: it goes out unchecked until the server takes it", async () => {
		const initial = makeResume("resume-older-recovery");
		// An older app's recovery record: no proposalSafety, and a decision it never sent.
		window.localStorage.setItem(
			`reactive-resume:unsaved:${initial.id}`,
			JSON.stringify({
				data: withBasicsName(initial, "Older app").data,
				storedAt: Date.now(),
				baseUpdatedAt: initial.updatedAt,
				pendingProposalApplications: { held: true },
			}),
		);
		orpcMocks.updateResume.mockRejectedValueOnce(new ORPCError("RESUME_VERSION_CONFLICT", { status: 409 }));
		useResumeStore.getState().initialize(initial);
		await flushMicrotasks();
		expect(orpcMocks.updateResume.mock.calls[0]?.[0]).not.toHaveProperty("proposalSafety");
		expect(orpcMocks.updateResume.mock.calls[0]?.[0]).toMatchObject({ proposalApplications: { held: true } });
		// Refused: the draft stays, still marked as the older app's, for Keep as a copy.
		expect(useResumeStore.getState().saveStatus).toBe("conflict");
		expect(useResumeStore.getState().resume?.data.basics.name).toBe("Older app");
		const kept = Object.entries(window.localStorage).find(([key]) =>
			key.startsWith(`reactive-resume:unsaved:${initial.id}`),
		);
		expect(JSON.parse(kept?.[1] ?? "{}")).not.toHaveProperty("proposalSafety");

		// Where the server takes it, what's typed next is this app's own.
		clearResumeDrafts();
		window.localStorage.clear();
		orpcMocks.updateResume.mockReset();
		orpcMocks.updateResume.mockImplementation((input: { id: string; data: ResumeData }) =>
			Promise.resolve({ ...initial, data: input.data }),
		);
		window.localStorage.setItem(
			`reactive-resume:unsaved:${initial.id}`,
			JSON.stringify({
				data: withBasicsName(initial, "Older app").data,
				storedAt: Date.now(),
				baseUpdatedAt: initial.updatedAt,
			}),
		);
		useResumeStore.getState().initialize(initial);
		await flushMicrotasks();
		expect(orpcMocks.updateResume.mock.calls[0]?.[0]).not.toHaveProperty("proposalSafety");
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Typed after updating";
		});
		await vi.advanceTimersByTimeAsync(500);
		expect(orpcMocks.updateResume.mock.calls[1]?.[0]).toMatchObject({ proposalSafety: "v1" });

		// This app's own recovery keeps its mark.
		clearResumeDrafts();
		window.localStorage.clear();
		orpcMocks.updateResume.mockClear();
		window.localStorage.setItem(
			`reactive-resume:unsaved:${initial.id}`,
			JSON.stringify({
				data: withBasicsName(initial, "This app").data,
				storedAt: Date.now(),
				baseUpdatedAt: initial.updatedAt,
				proposalSafety: "v1",
			}),
		);
		useResumeStore.getState().initialize(initial);
		await flushMicrotasks();
		expect(orpcMocks.updateResume.mock.calls[0]?.[0]).toMatchObject({ proposalSafety: "v1" });
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
		clearResumeDrafts();
		window.localStorage.clear();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		clearResumeDrafts();
		window.localStorage.clear();
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
		expect(store().undoStack.length > 0).toBe(true);
		expect(store().redoStack.length > 0).toBe(false);
		expect(store().resume?.data.basics.name).toBe("Second");

		store().undo();
		expect(store().resume?.data.basics.name).toBe(defaultResumeData.basics.name);
		expect(store().undoStack.length > 0).toBe(false);
		expect(store().redoStack.length > 0).toBe(true);

		store().redo();
		expect(store().resume?.data.basics.name).toBe("Second");
		expect(store().redoStack.length > 0).toBe(false);
	});

	it("keeps an accepted AI replacement as its own step after rapid typing and starts a new step for later typing", () => {
		const store = useResumeStore.getState;
		store().initialize(makeResume("undo-improve"));

		store().updateResumeData(
			(draft) => {
				draft.summary.content = "Owned";
			},
			{ coalesceKey: "summary.content" },
		);
		store().updateResumeData(
			(draft) => {
				draft.summary.content = "Owned synthetic delivery.";
			},
			{ coalesceKey: "summary.content" },
		);
		// The accepted AI replacement arrives inside the typing coalesce window and must still be its own step.
		store().updateResumeData(
			(draft) => {
				draft.summary.content = "Led fictional delivery work.";
			},
			{ coalesceKey: "summary.content", newStep: true },
		);

		expect(store().undoStack.length).toBe(2);
		store().undo();
		expect(store().resume?.data.summary.content).toBe("Owned synthetic delivery.");
		store().redo();
		expect(store().resume?.data.summary.content).toBe("Led fictional delivery work.");

		// Typing immediately after the replacement is a new step, not merged back into the AI one.
		store().updateResumeData(
			(draft) => {
				draft.summary.content = "Led fictional delivery work. More";
			},
			{ coalesceKey: "summary.content" },
		);
		expect(store().undoStack.length).toBe(3);
		store().undo();
		expect(store().resume?.data.summary.content).toBe("Led fictional delivery work.");
		store().undo();
		expect(store().resume?.data.summary.content).toBe("Owned synthetic delivery.");
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
		expect(store().undoStack.length > 0).toBe(false);
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
		expect(store().redoStack.length > 0).toBe(true);

		store().updateResumeData((draft) => {
			draft.basics.name = "Two";
		});

		expect(store().redoStack.length > 0).toBe(false);
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
		expect(store().undoStack.length > 0).toBe(true);
		// The same object stays, so the preview doesn't render the identical document again.
		expect(store().resume?.data).toBe(current.data);
	});

	it("clears the undo stack when the server sends different data (external rebase)", async () => {
		const store = useResumeStore.getState;
		store().initialize(makeResume("rebase-external"));
		orpcMocks.updateResume.mockImplementation(async (input) => ({ ...makeResume(input.id), data: input.data }));

		store().updateResumeData((draft) => {
			draft.basics.name = "Edited";
		});
		expect(store().undoStack.length).toBe(1);

		const current = store().resume;
		if (!current) throw new Error("expected a current resume");
		expect(await savePendingChanges(current.id)).toBe(true);
		// External / AI rebase: incoming data differs, so the local undo history no longer applies.
		store().replaceResumeFromServer(withBasicsName(current, "External Name"));

		expect(store().undoStack.length).toBe(0);
		expect(store().undoStack.length > 0).toBe(false);
	});
});

describe("resume update stream subscription", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		orpcMocks.streamSubscribe.mockReset();
		orpcMocks.updateResume.mockReset();
		consumeEventIteratorMock.mockReset();
		orpcMocks.getResumeById.mockReset();
		orpcMocks.importResume.mockReset();
		queryClientMock.setQueryData.mockClear();
		routerParamsMock.value = {};
		i18n.loadAndActivate({ locale: "en-US", messages: {} });
		clearResumeDrafts();
		window.localStorage.clear();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		clearResumeDrafts();
		window.localStorage.clear();
	});

	it.each([
		{ name: "resubscribes after the stream drops", error: new Error("stream dropped"), subscribes: 2, reported: 1 },
		// A signed-out tab would otherwise send a 401 every 2.5 s until it closes.
		{ name: "stops once the session is signed out", error: new ORPCError("UNAUTHORIZED"), subscribes: 1, reported: 0 },
	])("$name", ({ error, subscribes, reported }) => {
		const onUpdate = vi.fn().mockResolvedValue(undefined);
		const onError = vi.fn();
		consumeEventIteratorMock.mockReturnValue(vi.fn().mockResolvedValue(undefined));

		renderHook(() => useResumeUpdateSubscription({ resumeId: "resume-retry", onUpdate, onError }));
		expect(orpcMocks.streamSubscribe).toHaveBeenCalledTimes(1);

		const handlers = consumeEventIteratorMock.mock.calls[0]?.[1] as { onError: (error: unknown) => void };
		act(() => handlers.onError(error));
		expect(onError).toHaveBeenCalledTimes(reported);
		act(() => {
			vi.advanceTimersByTime(2500);
		});
		expect(orpcMocks.streamSubscribe).toHaveBeenCalledTimes(subscribes);
	});

	it("replaces the builder draft from the server when there are no pending local edits", async () => {
		const initial = makeResume("resume-clean");
		const remote = { ...withBasicsName(initial, "Remote Name"), updatedAt: new Date(initial.updatedAt.getTime() + 1) };
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

	it.each(["conflict", "saved"])(
		"does not apply an obsolete deferred snapshot after a local save is %s",
		async (outcome) => {
			const initial = makeResume(`focused-${outcome}`);
			let server = { ...withBasicsName(initial, "Theirs"), updatedAt: new Date(initial.updatedAt.getTime() + 1) };
			useResumeStore.getState().initialize(initial);
			routerParamsMock.value = { resumeId: initial.id };
			const input = document.createElement("input");
			document.body.append(input);
			input.focus();
			orpcMocks.getResumeById.mockResolvedValue(server);
			consumeEventIteratorMock.mockReturnValue(vi.fn().mockResolvedValue(undefined));
			const hook = renderHook(() => useBuilderResumeUpdateSubscription());
			const onEvent = consumeEventIteratorMock.mock.lastCall?.[1].onEvent;
			await act(async () => {
				await onEvent({ mutation: "update" });
			});
			// Simulate a newer accepted version with the same remote data before typing.
			if (outcome === "saved")
				useResumeStore
					.getState()
					.replaceResumeFromServer({ ...server, updatedAt: new Date(server.updatedAt.getTime() + 1) });
			orpcMocks.updateResume.mockImplementation((submitted: { data: ResumeData; expectedUpdatedAt?: Date }) => {
				if (outcome === "conflict" && submitted.expectedUpdatedAt?.getTime() !== server.updatedAt.getTime())
					throw new ORPCError("RESUME_VERSION_CONFLICT", { status: 409 });
				server = { ...server, data: submitted.data, updatedAt: new Date(server.updatedAt.getTime() + 2) };
				return Promise.resolve(server);
			});
			act(() => {
				useResumeStore.getState().updateResumeData((draft) => {
					draft.basics.location = "My typing";
				});
			});
			await act(async () => {
				await vi.advanceTimersByTimeAsync(500);
			});
			input.blur();
			await act(async () => {
				await vi.advanceTimersByTimeAsync(0);
			});
			expect(useResumeStore.getState().resume?.data.basics.location).toBe("My typing");
			expect(useResumeStore.getState().saveStatus).toBe(outcome);
			expect(server.data.basics.name).toBe("Theirs");
			expect(server.data.basics.location).toBe(outcome === "saved" ? "My typing" : initial.data.basics.location);
			input.remove();
			hook.unmount();
		},
	);

	it("does not overwrite pending local builder edits when a remote update arrives", async () => {
		const initial = makeResume("resume-pending");
		const remote = { ...withBasicsName(initial, "Remote Name"), updatedAt: new Date(initial.updatedAt.getTime() + 1) };
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
		orpcMocks.updateResume.mockImplementation((input: { expectedUpdatedAt?: Date }) => {
			if (input.expectedUpdatedAt?.getTime() !== remote.updatedAt.getTime())
				throw new ORPCError("RESUME_VERSION_CONFLICT", { status: 409 });
			return Promise.resolve(remote);
		});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(500);
		});
		expect(useResumeStore.getState().saveStatus).toBe("conflict");
		expect(useResumeStore.getState().resume?.data.basics.name).toBe("Local Name");
	});
});

it("restores proposal decisions only at their explicit undo checkpoints, preserving refinements and redo", () => {
	const store = () => useResumeStore.getState();
	store().initialize(makeResume("proposal-history"));
	store().updateResumeData(
		(draft) => {
			draft.summary.content = "<p>Accepted</p>";
		},
		{ newStep: true, applied: [{ id: "edit", after: "<p>Accepted</p>" }] },
	);
	store().updateResumeData(
		(draft) => {
			draft.summary.content = "<p>Refined</p>";
		},
		{ newStep: true },
	);
	expect(store().proposalApplications).toEqual({ edit: "<p>Accepted</p>" });
	store().undo();
	expect(store().proposalApplications).toEqual({ edit: "<p>Accepted</p>" });
	expect(store().resume?.data.summary.content).toBe("<p>Accepted</p>");
	store().undo();
	expect(store().proposalApplications).toEqual({ edit: false });
	store().redo();
	expect(store().proposalApplications).toEqual({ edit: "<p>Accepted</p>" });
	store().redo();
	expect(store().resume?.data.summary.content).toBe("<p>Refined</p>");
	expect(store().proposalApplications).toEqual({ edit: "<p>Accepted</p>" });
});

it("retains offscreen resume Undo and pending synchronization through a failed save and builder reload", async () => {
	vi.useFakeTimers();
	window.localStorage.clear();
	const store = () => useResumeStore.getState();
	const initial = makeResume("closed-assistant-undo");
	initial.data.summary.content = "<p>Original</p>";
	try {
		orpcMocks.updateResume.mockImplementation(async (input: { data: ResumeData }) => ({
			...initial,
			data: input.data,
		}));
		store().initialize(initial);
		store().updateResumeData(
			(draft) => {
				draft.summary.content = "<p>Rewritten</p>";
			},
			{ newStep: true, applied: [{ id: "edit", after: "<p>Rewritten</p>" }] },
		);
		expect(await savePendingChanges(initial.id)).toBe(true);
		// No Conversation is mounted. Document owner must save the decision with Undo's content.
		store().undo();
		orpcMocks.updateResume.mockRejectedValueOnce(new Error("Offline"));
		expect(await savePendingChanges(initial.id)).toBe(false);
		expect(orpcMocks.updateResume).toHaveBeenCalledWith(
			expect.objectContaining({ proposalApplications: { edit: false } }),
			expect.anything(),
		);
		vi.setSystemTime(Date.now() + 8 * 86_400_000);
		clearResumeDrafts();
		store().initialize(initial);
		expect(store().proposalApplications).toEqual({ edit: false });
		expect(await savePendingChanges(initial.id)).toBe(true);
		expect(orpcMocks.updateResume).toHaveBeenCalledWith(
			expect.objectContaining({ proposalApplications: { edit: false } }),
			expect.anything(),
		);
		const saved = store().resume;
		if (!saved) throw new Error("Missing saved resume");
		clearResumeDrafts();
		store().initialize(saved);
		expect(store().proposalApplications).toEqual({ edit: false });
	} finally {
		clearResumeDrafts();
		window.localStorage.clear();
		vi.clearAllTimers();
		vi.useRealTimers();
	}
});

describe("concurrent receipt ownership", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		clearResumeDrafts();
		window.localStorage.clear();
		orpcMocks.updateResume.mockReset();
		i18n.loadAndActivate({ locale: "en-US", messages: {} });
	});
	afterEach(() => {
		clearResumeDrafts();
		vi.clearAllTimers();
		vi.useRealTimers();
	});
	const s = () => useResumeStore.getState();
	it("newer remote Undo must supersede clean local acceptance, including after restart", async () => {
		const initial = makeResume("remote-undo");
		initial.data.summary.content = "<p>Old</p>";
		const p = {
			id: "receipt",
			target: { sectionId: "summary", field: "content" },
			before: "<p>Old</p>",
			after: "<p>New</p>",
			status: "pending" as const,
			source: "assistant" as const,
			location: "Summary",
			why: "Rewrite",
		};
		const { getProposalState } = await import("@reactive-resume/resume/proposals");
		s().initialize(initial);
		orpcMocks.updateResume.mockImplementation(async (input) => ({
			...initial,
			data: input.data,
			updatedAt: new Date(initial.updatedAt.getTime() + 1),
		}));
		s().updateResumeData(
			(d) => {
				d.summary.content = p.after;
			},
			{ newStep: true, applied: [p] },
		);
		await vi.advanceTimersByTimeAsync(500);
		expect(s().saveStatus).toBe("saved");
		const own = s().resume;
		assert.exists(own);
		// A different revision invalidates confirmed decisions even if the authored text matches.
		s().replaceResumeFromServer({ ...own, updatedAt: new Date(initial.updatedAt.getTime() + 2) });
		expect(s().proposalApplications).toEqual({});
		// Another client explicitly undoes this proposal and commits content+pending receipt at newer revision.
		const remote = { ...initial, updatedAt: new Date(initial.updatedAt.getTime() + 3) };
		s().replaceResumeFromServer(remote);
		const afterRebase = getProposalState(s().resume?.data ?? initial.data, p, s().proposalApplications);
		clearResumeDrafts();
		s().initialize(remote);
		const afterRestart = getProposalState(s().resume?.data ?? initial.data, p, s().proposalApplications);
		expect({ afterRebase, afterRestart }).toEqual({ afterRebase: "pending", afterRestart: "pending" });
	});
	it("an old pending decision cannot attach itself to a newer matching server revision", async () => {
		const initial = makeResume("stale-pending");
		initial.data.summary.content = "<p>Old</p>";
		s().initialize(initial);
		orpcMocks.updateResume.mockRejectedValue(new Error("offline"));
		s().updateResumeData(
			(d) => {
				d.summary.content = "<p>New</p>";
			},
			{ newStep: true, applied: [{ id: "receipt", after: "<p>New</p>" }] },
		);
		s().undo();
		await vi.advanceTimersByTimeAsync(500);
		// A different client has a later historical acceptance, then manually restores Old text.
		// Same content is not proof the failed Undo request committed.
		const remote = { ...initial, updatedAt: new Date(initial.updatedAt.getTime() + 10) };
		clearResumeDrafts();
		orpcMocks.updateResume
			.mockReset()
			.mockResolvedValue({ ...remote, updatedAt: new Date(remote.updatedAt.getTime() + 1) });
		s().initialize(remote);
		await flushMicrotasks();
		expect(orpcMocks.updateResume).not.toHaveBeenCalled();
		expect(s().saveStatus).toBe("conflict");
	});
	it("later Undo while acceptance save is in flight is sent after the earlier acknowledgement", async () => {
		const initial = makeResume("inflight");
		initial.data.summary.content = "<p>Old</p>";
		s().initialize(initial);
		let done: (resume: Resume) => void = () => {
			throw new Error("Save did not start");
		};
		orpcMocks.updateResume
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						done = resolve;
					}),
			)
			.mockImplementation(async (input) => ({
				...initial,
				data: input.data,
				updatedAt: new Date(initial.updatedAt.getTime() + 2),
			}));
		s().updateResumeData(
			(d) => {
				d.summary.content = "<p>New</p>";
			},
			{ newStep: true, applied: [{ id: "receipt", after: "<p>New</p>" }] },
		);
		await vi.advanceTimersByTimeAsync(500);
		s().undo();
		await vi.advanceTimersByTimeAsync(500);
		done({
			...initial,
			data: { ...initial.data, summary: { ...initial.data.summary, content: "<p>New</p>" } },
			updatedAt: new Date(initial.updatedAt.getTime() + 1),
		});
		await flushMicrotasks();
		await vi.advanceTimersByTimeAsync(0);
		expect(orpcMocks.updateResume.mock.calls.map((c) => c[0].proposalApplications)).toEqual([
			{ receipt: "<p>New</p>" },
			{ receipt: false },
		]);
		expect(s().resume?.data.summary.content).toBe("<p>Old</p>");
	});
});
