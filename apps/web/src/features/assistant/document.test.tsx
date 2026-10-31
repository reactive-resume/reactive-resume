// @vitest-environment happy-dom
import type { Proposal } from "@reactive-resume/resume/proposals";
import type { CoverLetter } from "@reactive-resume/schema/cover-letter/data";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const mocks = vi.hoisted(() => ({ toast: vi.fn(), save: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [] }) }));
vi.mock("@tanstack/react-router", () => ({ useSearch: () => ({}) }));
vi.mock("@/features/applications/queries", () => ({ applicationsListQueryOptions: () => ({}) }));
vi.mock("@/libs/orpc/client", () => ({ client: { coverLetters: { update: mocks.save } }, streamClient: {} }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast } }));
vi.mock("@/features/resume/builder/draft", () => ({
	useCurrentResume: vi.fn(),
	useResumeStore: { getState: vi.fn() },
}));
vi.mock("@/features/resume/editor/check/issues", () => ({ getSectionName: vi.fn() }));
vi.mock("@/features/resume/editor/write/model", () => ({ describeEntry: vi.fn() }));

import { useLetterAssistantDocument } from "./document";
import { useLetterEditorStore } from "@/features/letters/store";
const store = () => useLetterEditorStore.getState();
const letter: CoverLetter = {
	id: "letter",
	name: "Letter",
	recipient: "",
	content: "<p>They&#39;ve said &quot;yes&quot;.</p>",
	greeting: null,
	signOff: null,
	style: copyCoverLetterStyle(defaultResumeData),
	layout: "structured",
	recipientName: "",
	recipientCompany: "",
	letterDate: null,
	sourceResumeId: null,
	sourceApplicationId: null,
	senderLinked: false,
	designLinked: false,
	isLocked: false,
	revision: 1,
	createdAt: new Date(),
	updatedAt: new Date(),
};
const edit = (id: string, after: string): Proposal => ({
	id,
	before: letter.content,
	after,
	target: { sectionId: "letter", field: "content" },
	location: "Letter",
	why: "Clearer",
	status: "pending",
	source: "assistant",
});
beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	window.localStorage.clear();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	store().load(letter);
	mocks.save.mockImplementation(async () => ({ ...store().letter, revision: 2 }));
});
afterEach(() => {
	cleanup();
	store().reset();
	vi.useRealTimers();
});

it("applies ordered additions and a rewrite through the real letter store, retaining identity through refinements, saves and explicit toast Undo", async () => {
	const { result } = renderHook(useLetterAssistantDocument);
	const doc = result.current;
	if (!doc) throw new Error("Missing letter adapter");
	const first = edit("first", `${letter.content}<p>First</p>`);
	const additions = [first, edit("second", `${letter.content}<p>Second</p>`)];
	const rewrite = edit("rewrite", "<p>Rewritten</p>");
	act(() => store().edit({ content: `<p>They've said "yes".</p>` }));
	act(() => {
		expect(doc.accept([rewrite, ...additions]).applied).toEqual([rewrite, ...additions]);
	});
	expect(store().letter?.content).toBe("<p>Rewritten</p><p>First</p><p>Second</p>");
	const undo = mocks.toast.mock.lastCall?.[0].actionProps.onClick;
	await act(async () => {
		await store().flush();
	});
	act(() => undo());
	expect(store().letter?.content).toBe(`<p>They've said "yes".</p>`);
	expect(result.current?.stateOf({ ...first, status: "accepted" })).toBe("pending");
	act(() => {
		expect(doc.accept(additions).applied).toEqual(additions);
	});
	act(() => store().edit({ content: "<p>Refined anchor</p><p>Refined first</p><p>Second</p>" }));
	expect(result.current?.stateOf(first)).toBe("accepted");
	act(() => {
		expect(doc.accept(additions)).toEqual({ applied: [], stale: [] });
	});
	await act(async () => {
		await store().flush();
	});
	const refined = store().letter;
	if (!refined) throw new Error("Missing refined letter");
	act(() => store().load(refined));
	expect(result.current?.stateOf({ ...first, status: "accepted" })).toBe("accepted");
});

it("reports genuine stale edits and refuses old callbacks after switching or locking letters", () => {
	const { result } = renderHook(useLetterAssistantDocument);
	const doc = result.current;
	if (!doc) throw new Error("Missing letter adapter");
	const rewrite = edit("rewrite", "<p>Rewritten</p>");
	const conflict = edit("conflict", "<p>Conflicting rewrite</p>");
	act(() => {
		expect(doc.accept([rewrite, conflict])).toEqual({ applied: [rewrite], stale: [conflict] });
	});
	expect(mocks.toast.mock.lastCall?.[0].description).toContain("1 edit couldn't be placed");
	act(() => store().load({ ...letter, id: "other" }));
	act(() => {
		expect(doc.accept([rewrite])).toEqual({ applied: [], stale: [] });
	});
	act(() => store().load({ ...letter, isLocked: true }));
	act(() => {
		expect(doc.accept([rewrite])).toEqual({ applied: [], stale: [] });
	});
	expect(store().letter?.isLocked).toBe(true);
	expect(store().letter?.content).toBe("<p>Rewritten</p>");
});

it("keeps a surviving letter toast inside its original editing session", () => {
	const { result } = renderHook(useLetterAssistantDocument);
	const doc = result.current;
	if (!doc) throw new Error("Missing letter adapter");
	act(() => {
		doc.accept([edit("session-rewrite", "<p>Rewritten</p>")]);
	});
	const undo = mocks.toast.mock.lastCall?.[0].actionProps.onClick;
	const saved = store().letter;
	if (!saved) throw new Error("Missing saved letter");
	const originalSession = store().sessionId;
	act(() => {
		store().reset();
		store().load(saved);
	});
	expect(store().sessionId).not.toBe(originalSession);
	act(() => undo());
	expect(store().letter?.content).toBe(saved.content);
});

it("does not record or toast a normalized no-op in the real letter adapter", () => {
	const { result } = renderHook(useLetterAssistantDocument);
	const noop = edit("noop", `<p>They've said "yes".</p>`);
	act(() => store().edit({ content: noop.after }));
	act(() => {
		expect(result.current?.accept([noop]).applied).toEqual([]);
	});
	expect(store().proposalApplications[noop.id]).toBeUndefined();
	expect(result.current?.stateOf(noop)).toBe("stale");
	expect(mocks.toast.mock.lastCall?.[0].description).not.toContain("Edit applied");
});

it("retains an offscreen letter Undo and its failed synchronization across reset/reload", async () => {
	const { result, unmount } = renderHook(useLetterAssistantDocument);
	const doc = result.current;
	if (!doc) throw new Error("Missing letter adapter");
	const rewrite = edit("durable-undo", "<p>Rewritten</p>");
	act(() => {
		doc.accept([rewrite]);
	});
	const undo = mocks.toast.mock.lastCall?.[0].actionProps.onClick;
	await act(async () => {
		await store().flush();
	});
	unmount();
	act(() => undo());
	mocks.save.mockRejectedValueOnce(new Error("Offline"));
	expect(await store().flush()).toBe(false);
	expect(mocks.save.mock.lastCall?.[0].proposalApplications).toEqual({ "durable-undo": false });
	const saved = store().letter;
	if (!saved) throw new Error("Missing undone letter");
	store().reset();
	vi.setSystemTime(Date.now() + 8 * 86_400_000);
	store().load(saved);
	expect(store().proposalApplications[rewrite.id]).toBe(false);
	expect(store().pendingProposalApplications[rewrite.id]).toBe(false);
	expect(await store().flush()).toBe(true);
	expect(mocks.save.mock.lastCall?.[0].proposalApplications).toEqual({ "durable-undo": false });
	expect(store().pendingProposalApplications).toEqual({});
});

it("keeps an unconfirmed decision at its original revision even when fetched text matches", async () => {
	const { result } = renderHook(useLetterAssistantDocument);
	act(() => {
		result.current?.accept([edit("unconfirmed", "<p>Saved</p>")]);
	});
	mocks.save.mockRejectedValueOnce(new Error("Response lost"));
	await act(async () => {
		expect(await store().flush()).toBe(false);
	});
	const saved = store().letter;
	if (!saved) throw new Error("Missing submitted letter");
	act(() => {
		store().reset();
		store().load({ ...saved, revision: saved.revision + 1 });
	});
	expect(store().status).toBe("conflict");
	expect(store().letter?.revision).toBe(saved.revision);
	expect(store().pendingProposalApplications).toEqual({ unconfirmed: true });
	mocks.save.mockClear();
	expect(await store().flush()).toBe(false);
	expect(mocks.save).not.toHaveBeenCalled();
});

it("honors explicit Reload without reviving the discarded session's unsaved content", () => {
	act(() => store().edit({ content: "<p>Unsaved</p>" }, { proposalIds: ["discarded"] }));
	act(() => store().load({ ...letter, revision: 2 }, { recover: false }));
	expect(store().letter?.content).toBe(letter.content);
	expect(store().pending).toEqual({});
	expect(store().pendingProposalApplications).toEqual({});
	act(() => {
		store().reset();
		store().load({ ...letter, revision: 2 });
	});
	expect(store().letter?.content).toBe(letter.content);
	expect(store().proposalApplications).toEqual({});
});

it("a recovered old letter Undo may not use a later same-text revision", async () => {
	const { result } = renderHook(useLetterAssistantDocument);
	act(() => {
		result.current?.accept([edit("receipt", "<p>New</p>")]);
	});
	await act(async () => {
		await store().flush();
	});
	const undo = mocks.toast.mock.lastCall?.[0].actionProps.onClick;
	act(() => undo());
	mocks.save.mockRejectedValueOnce(new Error("offline"));
	await act(async () => {
		expect(await store().flush()).toBe(false);
	});
	act(() => store().reset());
	mocks.save.mockClear();
	const remote = { ...letter, revision: 8 };
	act(() => store().load(remote));
	await act(async () => {
		await store().flush();
	});
	expect(mocks.save).not.toHaveBeenCalled();
});

it("recovers only authored letter fields alongside a queued receipt", async () => {
	const remote = { ...letter, greeting: "Hello Rowan,", signOff: "With thanks," };
	act(() => {
		store().load(remote);
		store().edit({ content: "<p>New</p>" }, { proposalIds: ["receipt"] });
	});
	act(() => {
		store().reset();
		store().load(remote);
	});
	expect(store().letter?.greeting).toBe(remote.greeting);
	expect(store().letter?.signOff).toBe(remote.signOff);
	expect(store().pending).toEqual({ content: "<p>New</p>" });
	expect(await store().flush()).toBe(true);
	expect(mocks.save.mock.lastCall?.[0]).not.toHaveProperty("greeting");
	expect(mocks.save.mock.lastCall?.[0].proposalApplications).toEqual({ receipt: true });
});
