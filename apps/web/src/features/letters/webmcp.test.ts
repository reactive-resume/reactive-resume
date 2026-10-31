// @vitest-environment happy-dom

import type { WebMcpTool } from "@/libs/webmcp";
import type { CoverLetter } from "@reactive-resume/schema/cover-letter/data";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { ORPCError } from "@orpc/client";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { useLetterEditorStore } from "./store";
import { useLetterWebMcpTools } from "./webmcp";

const mocks = vi.hoisted(() => ({ update: vi.fn(), toast: { add: vi.fn(), close: vi.fn() } }));
vi.mock("@/libs/orpc/client", () => ({
	client: { coverLetters: { update: mocks.update } },
	streamClient: { coverLetters: { draft: vi.fn() } },
}));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: mocks.toast }));

const letter: CoverLetter = {
	id: "letter",
	name: "Letter",
	recipient: "",
	content: "<p>Mine</p>",
	greeting: null,
	signOff: null,
	style: copyCoverLetterStyle(defaultResumeData),
	layout: "structured",
	recipientName: "",
	recipientCompany: "",
	letterDate: null,
	sourceResumeId: "resume",
	sourceApplicationId: null,
	senderLinked: true,
	designLinked: true,
	isLocked: false,
	revision: 1,
	createdAt: new Date(),
	updatedAt: new Date(),
};

function mountTools(open: CoverLetter) {
	const tools = new Map<string, WebMcpTool>();
	Object.defineProperty(document, "modelContext", {
		value: { registerTool: (tool: WebMcpTool) => void tools.set(tool.name, tool) },
		configurable: true,
	});
	useLetterEditorStore.getState().load(open);
	renderHook(() => useLetterWebMcpTools(open.id));

	return (name: string) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`${name} wasn't registered`);
		return tool;
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	mocks.update.mockImplementation(async (input) => ({ ...letter, ...input, revision: letter.revision + 1 }));
});

afterEach(() => {
	delete (document as { modelContext?: unknown }).modelContext;
	useLetterEditorStore.getState().reset();
});

describe("cover letter editor WebMCP tools", () => {
	it("reads the letter as it is on screen", async () => {
		const tool = mountTools(letter);
		useLetterEditorStore.getState().edit({ recipientCompany: "Acme" });

		const result = JSON.parse(await tool("read_cover_letter").execute({}));

		expect(result).toMatchObject({
			id: "letter",
			layout: "structured",
			content: "<p>Mine</p>",
			recipientCompany: "Acme",
		});
		expect(result).not.toHaveProperty("style");
	});

	it("changes only the fields given, and saves them", async () => {
		const tool = mountTools(letter);

		const result = await tool("update_cover_letter").execute({ content: "<p>New body</p>", recipientName: "Dana" });

		expect(result).toBe("Changed and saved.");
		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({ id: "letter", expectedRevision: 1, content: "<p>New body</p>", recipientName: "Dana" }),
		);
		expect(mocks.update.mock.calls[0]?.[0]).not.toHaveProperty("greeting");
		expect(useLetterEditorStore.getState().letter).toMatchObject({ content: "<p>New body</p>", recipientName: "Dana" });
		expect(mocks.toast.add).toHaveBeenCalledWith(expect.objectContaining({ id: "webmcp-letter-edit" }));
	});

	it("resets the greeting to the default with null", async () => {
		const tool = mountTools({ ...letter, greeting: "Hi team," });

		await tool("update_cover_letter").execute({ greeting: null });

		expect(useLetterEditorStore.getState().letter?.greeting).toBeNull();
	});

	it("says when the letter changed elsewhere and couldn't be saved", async () => {
		mocks.update.mockRejectedValue(new ORPCError("CONFLICT"));
		const tool = mountTools(letter);

		const result = await tool("update_cover_letter").execute({ content: "<p>New body</p>" });

		expect(result).toMatch(/not saved: the letter was changed somewhere else/);
	});

	it("refuses an empty change, unknown fields and locked letters", async () => {
		const tool = mountTools(letter);
		await expect(tool("update_cover_letter").execute({})).resolves.toMatch("Give at least one field to change.");
		await expect(tool("update_cover_letter").execute({ style: {} })).resolves.toMatch(/Invalid input/);
		await expect(tool("update_cover_letter").execute({ letterDate: "next week" })).resolves.toMatch(/YYYY-MM-DD/);

		const locked = mountTools({ ...letter, isLocked: true });
		await expect(locked("update_cover_letter").execute({ content: "<p>x</p>" })).resolves.toMatch(/locked/);
		expect(mocks.update).not.toHaveBeenCalled();
	});
});
