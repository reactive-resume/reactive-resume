import type { ResumeData } from "@reactive-resume/schema/resume/data";
let mockScope = "storyboard";
let mockApplication: unknown;
const mockRun = jest.fn(async (..._args: unknown[]) => ({ text: "Proposal", why: "", addsFacts: false }));
const mockValues = new Map<string, string>();
jest.mock("expo-sqlite/kv-store", () => ({
	__esModule: true,
	default: {
		getItemSync: (key: string) => mockValues.get(key) ?? null,
		setItemSync: (key: string, value: string) => mockValues.set(key, value),
		removeItemSync: (key: string) => mockValues.delete(key),
	},
}));
jest.mock("./provider", () => ({
	useDataBackend: () => ({ scope: mockScope, backend: { kind: "fake" } }),
	useApplication: () => ({ data: mockApplication, isPending: false }),
}));
jest.mock("./scope", () => ({
	activeDataScope: () => mockScope,
	assertDataScope: (scope: string) => {
		if (scope !== mockScope) throw new Error("Account changed");
	},
}));
jest.mock("./actions", () => ({ usePlatformActions: () => ({ run: (...args: unknown[]) => mockRun(...args) }) }));
jest.mock("@tanstack/react-query", () => ({ useQuery: () => ({ isPending: false }) }));
jest.mock("./platform", () => ({ useCareerLibrary: () => ({ data: [] }) }));
jest.mock("./collections", () => ({ useSettings: () => ({}) }));
jest.mock("./client", () => ({ dataClient: {} }));
jest.mock("@/api/client", () => ({ streamClient: {} }));
jest.mock("@/render/page-renderer", () => ({
	pageRenderer: { render: jest.fn(async () => ({ pdfFile: "file:///sample.pdf" })) },
}));
import { act, renderHook } from "@testing-library/react-native";
import { completeStep, undoStep, isStepComplete, interviewCalendar, hadNoResponse } from "./application-tools";
import { atsSampleFile } from "./ats-sample";
import { validatePhoto, useImprove, useJobMatch } from "./builder";
import { questionResponse, replyPayload, replySources } from "./conversation";
import { seed, fakeBackend } from "./fixtures";
import { storyboardImportPreview } from "./import-fixture";
import { keepSharedIntake, pendingSharedIntake, consumeSharedIntake } from "./intake";
import { useCoachDraft, useAssistantDraft } from "./local-state";
import { notificationPlan } from "./notification-plan";
import { validateFrequency, scheduleNextRun } from "./schedules";
import { pageRenderer } from "@/render/page-renderer";

beforeEach(() => {
	mockScope = "storyboard";
	seed("storyboard");
	mockValues.clear();
	mockRun.mockClear();
});

test("Improve keeps original words on failure and Stop aborts its request", async () => {
	const hook = await renderHook(() => useImprove());
	mockRun.mockRejectedValueOnce(new Error("Provider unavailable"));
	await act(async () => {
		await expect(hook.result.current.improve({ line: "My words", action: "shorter" })).rejects.toThrow(
			"Provider unavailable",
		);
	});
	expect(hook.result.current).toMatchObject({ original: "My words", progress: "failed" });
	let signal: AbortSignal | undefined;
	mockRun.mockImplementationOnce(async (_operation, _input, value) => {
		signal = value as AbortSignal;
		await new Promise<void>((_resolve, reject) =>
			signal?.addEventListener("abort", () => reject(new Error("Stopped")), { once: true }),
		);
		throw new Error("Unreachable");
	});
	let pending: Promise<unknown> | undefined;
	await act(() => {
		pending = hook.result.current.improve({ line: "Still mine", action: "shorter" }).catch(() => undefined);
	});
	await act(async () => {
		hook.result.current.stop();
		await pending;
	});
	expect(signal?.aborted).toBe(true);
	expect(hook.result.current).toMatchObject({ progress: "stopped", original: "Still mine" });
});
test("weekday frequency stays explicit and next run uses schedule zone", () => {
	expect(validateFrequency({ kind: "weekdays", days: [1, 3, 5] })).toEqual({ kind: "weekdays", days: [1, 3, 5] });
	expect(() => validateFrequency({ kind: "weekdays", days: [1, 1] })).toThrow();
	expect(() => validateFrequency({ kind: "interval", days: 0 })).toThrow();
	expect(
		scheduleNextRun({ enabled: true, nextRunAt: new Date("2026-11-10T09:00:00Z"), timezone: "Europe/Berlin" }).label,
	).toContain("10:00");
});
test("Lumen job match carries B10 terms and changes only when resume words change", async () => {
	mockApplication = await fakeBackend.read("application", { id: "lumen" });
	const resume = await fakeBackend.read("resume", { id: "resume-product" });
	const hook = await renderHook(({ data }: { data: ResumeData }) => useJobMatch(data, "lumen"), {
		initialProps: { data: resume.data },
	});
	expect(hook.result.current.result).toMatchObject({ total: 14 });
	expect(hook.result.current.result?.found).toHaveLength(9);
	expect(hook.result.current.result?.missing.map((row) => row.label)).toEqual([
		"Accessibility audits",
		"Design tokens",
		"Workshop facilitation",
	]);
	const changed = structuredClone(resume.data);
	changed.summary.content += "<p>Design tokens</p>";
	await hook.rerender({ data: changed });
	expect(hook.result.current.result?.found).toHaveLength(10);
});
test("unsent drafts survive unmount, isolate account/thread and keep assistant separate", async () => {
	const coach = await renderHook(() => useCoachDraft("thread"));
	await act(() => coach.result.current.setText("Keep my words"));
	await coach.unmount();
	const restored = await renderHook(() => useCoachDraft("thread"));
	expect(restored.result.current.text).toBe("Keep my words");
	expect((await renderHook(() => useAssistantDraft("thread"))).result.current.text).toBe("");
	expect((await renderHook(() => useCoachDraft("other-thread"))).result.current.text).toBe("");
	mockScope = "other-account";
	await restored.rerender({});
	expect(restored.result.current.text).toBe("");
});
test("step undo rejects old handles and cross-account writes", () => {
	const first = completeStep({ applicationId: "lumen", kind: "interview" });
	expect(isStepComplete(first)).toBe(true);
	const second = completeStep(first);
	expect(() => undoStep(first)).toThrow("changed");
	undoStep(second);
	undoStep(first);
	expect(isStepComplete(first)).toBe(false);
	mockScope = "other-account";
	expect(() => undoStep(first)).toThrow("Account");
});
test("calendar is portable ICS, escapes fields, and requires no calendar permission", async () => {
	const app = await fakeBackend.read("application", { id: "lumen" });
	const payload = interviewCalendar({ ...app, company: "A, B; C\nD" }, "lumen-interview");
	expect(payload.text).toContain("DTSTART:20261110T090000Z\r\n");
	expect(payload.text).toContain("A\\, B\\; C\\nD");
	expect(() => interviewCalendar(app, "missing")).toThrow("unavailable");
});
test("scheduler covers Settings categories with stable identities and honors switches", async () => {
	const apps = await fakeBackend.read("applications", {});
	const input = {
		applications: apps,
		offers: await fakeBackend.read("offers", { kind: "offer" }),
		notices: [],
		feedback: [],
	};
	const first = notificationPlan(input);
	expect(first.map((row) => row.id)).toEqual(notificationPlan(input).map((row) => row.id));
	expect(new Set(first.map((row) => row.id)).size).toBe(first.length);
	expect(first.some((row) => row.category === "interviews")).toBe(true);
	expect(first.some((row) => row.category === "followUps")).toBe(true);
	expect(first.some((row) => row.category === "offers")).toBe(true);
	expect(
		notificationPlan({ ...input, categories: { interviews: false } }).some((row) => row.category === "interviews"),
	).toBe(false);
	const unanswered = apps.find((row) => row.closedReason === "no-response");
	if (!unanswered) throw new Error("Missing no-response fixture");
	expect(hadNoResponse(unanswered)).toBe(true);
});
test("new role and feedback notices keep ids while content changes, excluding read/resolved rows", async () => {
	const at = new Date("2026-11-07T08:41:00Z");
	const notice = {
		id: "roles",
		userId: "alex",
		applicationId: null,
		key: "roles",
		notice: { type: "opportunities" as const, count: 1, query: "Designer" },
		url: null,
		readAt: null,
		emailedAt: null,
		emailAttemptedAt: null,
		title: "New roles",
		body: "One role",
		createdAt: at,
		updatedAt: at,
	};
	const link = await fakeBackend.read("feedbackLink", { id: "feedback-0" });
	link.comments = [
		{ id: "comment", linkId: link.id, authorName: "Mentor", body: "Feedback", resolvedAt: null, createdAt: at },
	];
	const input = { applications: [], offers: [], notices: [notice], feedback: [link] };
	expect(notificationPlan(input).map((row) => row.category)).toEqual(["feedback", "newRoles"]);
	expect(notificationPlan(input).map((row) => row.id)).toEqual(
		notificationPlan({ ...input, notices: [{ ...notice, body: "Updated role" }] }).map((row) => row.id),
	);
	expect(
		notificationPlan({
			...input,
			notices: [{ ...notice, readAt: at }],
			feedback: [{ ...link, comments: link.comments.map((row) => ({ ...row, resolvedAt: at })) }],
		}),
	).toEqual([]);
});
test("question responses carry the assistant tool identity; copy/share and citations retain content", () => {
	expect(questionResponse("tool", "My answer", "message")).toMatchObject({
		id: "message",
		role: "assistant",
		parts: [{ type: "tool-ask_user_question", toolCallId: "tool", state: "output-available", output: "My answer" }],
	});
	expect(replyPayload("Original reply")).toEqual({ copy: "Original reply", share: { message: "Original reply" } });
	expect(replySources([{ type: "source-url", url: "https://example.org" }, { type: "text-delta" }])).toHaveLength(1);
});
test("photo validation rejects oversized and non-image files", () => {
	expect(() => validatePhoto(10, "image/png")).not.toThrow();
	expect(() => validatePhoto(11 * 1024 * 1024, "image/png")).toThrow("10 MB");
	expect(() => validatePhoto(0, "image/png")).toThrow();
	expect(() => validatePhoto(10, "application/pdf")).toThrow("Unsupported");
});
test("D4 review is independent of saved resume, with drawn parsed section sizes", async () => {
	const preview = await storyboardImportPreview();
	expect(preview.data.basics).toMatchObject({ name: "Alex Morgan", headline: "Product designer", location: "Lisbon" });
	expect(preview.summary.sections.map((row) => row.entries)).toEqual([1, 4, 2, 12, 3]);
	expect(preview.summary.notImported).toHaveLength(1);
	expect((await fakeBackend.read("resume", { id: "resume-product" })).data.sections.experience.items).toHaveLength(2);
});
test("shared intake waits for sign-in and same server, consumption detects replacements", () => {
	const item = keepSharedIntake("https://example.org", { kind: "url", url: "https://jobs.example.org/job" });
	expect(pendingSharedIntake("https://another.example.org")).toBe(null);
	expect(pendingSharedIntake("https://example.org")).toEqual(item);
	expect(() => consumeSharedIntake("wrong", "https://example.org")).toThrow("changed");
	expect(consumeSharedIntake(item.id, "https://example.org")).toEqual(item);
	expect(pendingSharedIntake("https://example.org")).toBe(null);
	expect(() => keepSharedIntake("https://example.org", { kind: "url", url: "javascript:alert(1)" })).toThrow();
});
test("ATS sample renders public sample without selecting an owned document", async () => {
	expect(await atsSampleFile()).toMatchObject({ uri: "file:///sample.pdf", name: "sample-resume.pdf" });
	expect(pageRenderer.render).toHaveBeenCalledWith(expect.objectContaining({ public: true, id: "ats-public-sample" }));
});
