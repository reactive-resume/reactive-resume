// @vitest-environment happy-dom
import type { Resume } from "@/features/resume/builder/draft";
import type { Proposal } from "@reactive-resume/resume/proposals";
import type { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

const mocks = vi.hoisted(() => ({
	copyForJob: vi.fn(),
	updateThread: vi.fn(),
	getThread: vi.fn(),
	trash: vi.fn(),
	saveResume: vi.fn(),
	toast: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useParams: () => ({}), useBlocker: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ setQueryData: vi.fn() }) }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast, close: vi.fn() } }));
vi.mock("@/features/applications/queries", () => ({ applicationsListQueryKey: () => ["applications"] }));
vi.mock("@/libs/orpc/client", () => ({
	client: {
		documents: { copyForJob: mocks.copyForJob, trash: mocks.trash },
		agent: { threads: { update: mocks.updateThread, get: mocks.getThread } },
	},
	orpc: {
		documents: { key: () => ["documents"] },
		agent: { threads: { list: { key: () => ["threads"] } } },
		resume: {
			getById: { queryOptions: ({ input }: { input: { id: string } }) => ({ queryKey: ["resume", input.id] }) },
			update: { call: mocks.saveResume },
		},
	},
	streamClient: { resume: { updates: { subscribe: vi.fn() } } },
}));

import { acceptOnCopy } from "./accept-on-copy";
import { useResumeStore } from "@/features/resume/builder/draft";

const BEFORE = "<p>Built accessible interfaces.</p>";
const AFTER = "<p>Built accessible interfaces for six product teams.</p>";

const resume = (id: string): Resume => {
	const data = structuredClone(defaultResumeData);
	data.summary.content = BEFORE;
	return { id, name: id, slug: id, tags: [], data, isLocked: false, createdAt: new Date(), updatedAt: new Date() };
};
const edit: Proposal = {
	id: "edit-1",
	before: BEFORE,
	after: AFTER,
	target: { sectionId: "summary", field: "content" },
	location: "Summary",
	why: "Specific",
	status: "pending",
	source: "assistant",
};
const queryClient = { invalidateQueries: vi.fn(async () => undefined) } as unknown as QueryClient;
const summary = () => useResumeStore.getState().resume?.data.summary.content;

beforeEach(() => {
	vi.clearAllMocks();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	useResumeStore.getState().initialize(resume("base"));
	mocks.saveResume.mockImplementation(async (input: { id: string }) => ({
		...resume(input.id),
		updatedAt: new Date(),
	}));
});
afterEach(() => useResumeStore.getState().initialize(null));

it("makes the copy and moves the conversation before applying the first accepted edit to the copy, not the base", async () => {
	mocks.copyForJob.mockResolvedValue("copy");
	mocks.updateThread.mockResolvedValue({});
	// The builder opens the copy as the route does: the base's store is replaced by the copy's.
	const open = vi.fn(async () => useResumeStore.getState().initialize(resume("copy")));

	await acceptOnCopy({
		threadId: "thread",
		resumeId: "base",
		posting: { id: "job" },
		proposals: [edit],
		queryClient,
		open,
	});

	expect(mocks.copyForJob).toHaveBeenCalledWith(expect.objectContaining({ resumeId: "base", applicationId: "job" }));
	expect(mocks.updateThread).toHaveBeenCalledWith({ id: "thread", workingResumeId: "copy" });
	expect(open).toHaveBeenCalledWith("copy");
	expect(useResumeStore.getState().resume?.id).toBe("copy");
	expect(summary()).toBe(AFTER);
	expect(useResumeStore.getState().proposalApplications).toMatchObject({ "edit-1": AFTER });
});

it("applies nothing and keeps the edit pending when the copy can't be made", async () => {
	mocks.copyForJob.mockRejectedValue(new Error("offline"));
	const open = vi.fn();

	await acceptOnCopy({ threadId: "thread", resumeId: "base", posting: null, proposals: [edit], queryClient, open });

	expect(mocks.updateThread).not.toHaveBeenCalled();
	expect(open).not.toHaveBeenCalled();
	expect(useResumeStore.getState().resume?.id).toBe("base");
	expect(summary()).toBe(BEFORE);
	expect(useResumeStore.getState().proposalApplications).toEqual({});
	expect(mocks.toast).toHaveBeenCalledWith(
		expect.objectContaining({
			type: "error",
			description: "Couldn't make a copy to work on. Nothing was applied; the edits are still waiting.",
		}),
	);
});
