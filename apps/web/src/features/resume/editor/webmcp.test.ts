// @vitest-environment happy-dom

import type { Resume } from "@/features/resume/builder/draft";
import type { WebMcpTool } from "@/libs/webmcp";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { produce } from "immer";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { assignChanged, useResumeWebMcpTools } from "./webmcp";
import { useResumeStore } from "@/features/resume/builder/draft";

const updateResume = vi.hoisted(() => vi.fn());
const toastMocks = vi.hoisted(() => ({ add: vi.fn(), close: vi.fn() }));
const routerParams = vi.hoisted(() => ({ value: {} as { resumeId?: string } }));

vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ setQueryData: vi.fn() }) }));
vi.mock("@tanstack/react-router", () => ({ useParams: () => routerParams.value, useBlocker: vi.fn() }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: toastMocks }));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		resume: {
			getById: { queryOptions: ({ input }: { input: { id: string } }) => ({ queryKey: ["resume", input.id] }) },
			update: { call: updateResume },
		},
	},
	streamClient: {},
}));

describe("assignChanged", () => {
	it("writes the new value and keeps the references of what didn't change", () => {
		const before = {
			basics: { name: "Ada", email: "ada@example.com" },
			skills: [
				{ id: "a", name: "Go" },
				{ id: "b", name: "Rust" },
			],
			tags: ["one"],
			removed: true,
		};
		const next = {
			basics: { name: "Ada", email: "ada@example.com" },
			skills: [
				{ id: "a", name: "Go" },
				{ id: "b", name: "Zig" },
			],
			tags: ["one", "two"],
			added: { nested: 1 },
		};

		const result = produce(before as Record<string, unknown>, (draft) => assignChanged(draft, before, next));

		expect(result).toEqual(next);
		expect(result.basics).toBe(before.basics);
		expect((result.skills as unknown[])[0]).toBe(before.skills[0]);
		expect((result.skills as unknown[])[1]).not.toBe(before.skills[1]);
	});
});

function makeResume(overrides: Partial<Resume> = {}): Resume {
	return {
		id: "resume-1",
		name: "Engineer",
		slug: "engineer",
		tags: [],
		data: structuredClone(defaultResumeData),
		isLocked: false,
		isPublic: false,
		createdAt: new Date("2026-10-01T09:00:00.000Z"),
		updatedAt: new Date("2026-10-02T09:00:00.000Z"),
		...overrides,
	};
}

function mountTools(resume: Resume) {
	const tools = new Map<string, WebMcpTool>();
	Object.defineProperty(document, "modelContext", {
		value: { registerTool: (tool: WebMcpTool) => void tools.set(tool.name, tool) },
		configurable: true,
	});
	useResumeStore.getState().initialize(resume);
	routerParams.value = { resumeId: resume.id };
	renderHook(() => useResumeWebMcpTools(resume.id));

	return (name: string) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`${name} wasn't registered`);
		return tool;
	};
}

describe("resume editor WebMCP tools", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		i18n.loadAndActivate({ locale: "en-US", messages: {} });
		updateResume.mockReset();
		updateResume.mockImplementation(async (input: { data: Resume["data"] }) => ({ ...makeResume(), ...input }));
		toastMocks.add.mockClear();
		useResumeStore.getState().reset();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		delete (document as { modelContext?: unknown }).modelContext;
		useResumeStore.getState().reset();
	});

	it("registers the editor's tools", () => {
		const tool = mountTools(makeResume());

		for (const name of ["read_resume", "read_resume_schema", "apply_resume_patch", "check_resume"])
			expect(tool(name).name).toBe(name);
		expect(tool("read_resume").annotations.readOnlyHint).toBe(true);
		expect(tool("apply_resume_patch").annotations.readOnlyHint).toBeUndefined();
	});

	it("reads the resume as it is on screen", async () => {
		const tool = mountTools(makeResume());
		useResumeStore.getState().updateResumeData((draft) => {
			draft.basics.name = "Unsaved Name";
		});

		const result = JSON.parse(await tool("read_resume").execute({}));

		expect(result).toMatchObject({ id: "resume-1", name: "Engineer", isLocked: false, isPublic: false });
		expect(result.data.basics.name).toBe("Unsaved Name");
	});

	it("returns the resume data schema", async () => {
		const tool = mountTools(makeResume());

		const schema = JSON.parse(await tool("read_resume_schema").execute({}));

		expect(schema.properties).toHaveProperty("sections");
	});

	it("applies a patch as one undoable step that saves", async () => {
		const resume = makeResume();
		const tool = mountTools(resume);

		const result = await tool("apply_resume_patch").execute({
			operations: [
				{ op: "replace", path: "/basics/name", value: "Ada Lovelace" },
				{ op: "replace", path: "/basics/headline", value: "Analyst" },
			],
		});

		const state = useResumeStore.getState();
		expect(result).toBe("Applied 2 operations. The change saves automatically.");
		expect(state.resume?.data.basics).toMatchObject({ name: "Ada Lovelace", headline: "Analyst" });
		expect(state.resume?.data.sections).toBe(resume.data.sections);
		expect(state.undoStack).toHaveLength(1);
		expect(toastMocks.add).toHaveBeenCalledWith(expect.objectContaining({ id: "webmcp-resume-edit" }));

		await vi.advanceTimersByTimeAsync(500);
		expect(updateResume).toHaveBeenCalledTimes(1);
		expect(updateResume.mock.calls[0]?.[0].data.basics.name).toBe("Ada Lovelace");

		useResumeStore.getState().undo();
		expect(useResumeStore.getState().resume?.data.basics.name).toBe(resume.data.basics.name);
	});

	it("changes nothing when an operation fails", async () => {
		const tool = mountTools(makeResume());

		await expect(
			tool("apply_resume_patch").execute({
				operations: [
					{ op: "replace", path: "/basics/name", value: "Ada" },
					{ op: "replace", path: "/basics/nope/deeper", value: "x" },
				],
			}),
		).resolves.toMatch(/The replace operation at \/basics\/nope\/deeper failed: .* Nothing was changed\./);

		expect(useResumeStore.getState().resume?.data.basics.name).toBe(defaultResumeData.basics.name);
		expect(useResumeStore.getState().undoStack).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(500);
		expect(updateResume).not.toHaveBeenCalled();
	});

	it("returns malformed-input errors without scheduling a save", async () => {
		const tool = mountTools(makeResume());
		await expect(tool("apply_resume_patch").execute({ operations: "nope" })).resolves.toMatch(/Error: Invalid input/);
		expect(useResumeStore.getState().resume?.data).toEqual(defaultResumeData);
		expect(useResumeStore.getState().undoStack).toHaveLength(0);
		await vi.advanceTimersByTimeAsync(500);
		expect(updateResume).not.toHaveBeenCalled();
	});

	it("rejects values the resume schema doesn't allow", async () => {
		const tool = mountTools(makeResume());

		await expect(
			tool("apply_resume_patch").execute({
				operations: [{ op: "replace", path: "/metadata/template", value: "nope" }],
			}),
		).resolves.toMatch(/Patch produced invalid resume data/);
	});

	it("refuses to edit a locked resume", async () => {
		const tool = mountTools(makeResume({ isLocked: true }));

		await expect(
			tool("apply_resume_patch").execute({ operations: [{ op: "replace", path: "/basics/name", value: "Ada" }] }),
		).resolves.toMatch(/locked/);
		expect(toastMocks.add).not.toHaveBeenCalled();
	});

	it("checks the resume, pointing at what to fix", async () => {
		const tool = mountTools(makeResume());

		const report = JSON.parse(await tool("check_resume").execute({}));

		expect(report.score).toBeGreaterThanOrEqual(0);
		expect(report.issues.length).toBeGreaterThan(0);
		expect(report.issues[0]).toEqual({
			severity: expect.any(String),
			category: expect.any(String),
			title: expect.any(String),
			detail: expect.any(String),
			pointer: expect.stringMatching(/^\//),
		});
	});

	it("fails once another resume replaced the open one", async () => {
		const tool = mountTools(makeResume());
		useResumeStore.getState().reset();

		await expect(tool("read_resume").execute({})).resolves.toMatch("The resume is no longer open in the editor.");
	});
});
