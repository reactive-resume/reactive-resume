// @vitest-environment happy-dom

import type { WebMcpTool } from "./webmcp";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import z from "zod";
import { defineWebMcpTool, getModelContext, useWebMcpTools } from "./webmcp";

type Registry = {
	registerTool: ReturnType<typeof vi.fn>;
	unregisterTool?: ReturnType<typeof vi.fn>;
};

function install(target: "document" | "navigator", registry: Registry) {
	Object.defineProperty(target === "document" ? document : navigator, "modelContext", {
		value: registry,
		configurable: true,
	});
}

afterEach(() => {
	delete (document as { modelContext?: unknown }).modelContext;
	delete (navigator as { modelContext?: unknown }).modelContext;
	vi.restoreAllMocks();
});

const echo = defineWebMcpTool({
	name: "echo",
	title: "Echo",
	description: "Returns its input.",
	input: z.object({ text: z.string().min(1).describe("What to return."), count: z.number().int().optional() }),
	annotations: { readOnlyHint: true },
	execute: (input) => input,
});

describe("getModelContext", () => {
	it("is null where the browser has no WebMCP", () => {
		expect(getModelContext()).toBeNull();
	});

	it("prefers document.modelContext over the older navigator one", () => {
		const current = { registerTool: vi.fn() };
		install("navigator", { registerTool: vi.fn() });
		install("document", current);

		expect(getModelContext()).toBe(current);
	});

	it("falls back to navigator.modelContext", () => {
		const legacy = { registerTool: vi.fn() };
		install("navigator", legacy);

		expect(getModelContext()).toBe(legacy);
	});

	it("ignores a modelContext without registerTool", () => {
		Object.defineProperty(document, "modelContext", { value: {}, configurable: true });

		expect(getModelContext()).toBeNull();
	});
});

describe("defineWebMcpTool", () => {
	it("describes the input as JSON Schema", () => {
		expect(echo.inputSchema).toEqual({
			type: "object",
			properties: {
				text: { type: "string", minLength: 1, description: "What to return." },
				count: { type: "integer", minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
			},
			required: ["text"],
		});
		expect(echo.annotations).toEqual({ readOnlyHint: true });
	});

	it("gives free-form values every JSON type", () => {
		const tool = defineWebMcpTool({
			name: "store",
			title: "Store",
			description: "Stores a value.",
			input: z.object({ value: z.unknown() }),
			execute: () => "stored",
		});

		expect(tool.inputSchema.properties).toEqual({
			value: { type: ["string", "number", "boolean", "object", "array", "null"] },
		});
	});

	it("returns objects as JSON and strings as they are", async () => {
		const text = defineWebMcpTool({
			name: "text",
			title: "Text",
			description: "Returns text.",
			input: z.object({}),
			execute: () => "plain",
		});

		await expect(echo.execute({ text: "hi", count: 2 })).resolves.toBe('{"text":"hi","count":2}');
		await expect(text.execute(undefined)).resolves.toBe("plain");
	});

	it("refuses input that doesn't match the schema, saying why", async () => {
		await expect(echo.execute({ text: "" })).resolves.toMatch(/Error: Invalid input\.[\s\S]*text/);
	});

	it("passes the call's abort signal on", async () => {
		const execute = vi.fn(() => "done");
		const tool = defineWebMcpTool({ name: "wait", title: "Wait", description: "Waits.", input: z.object({}), execute });
		const { signal } = new AbortController();

		await tool.execute({}, { signal });

		expect(execute).toHaveBeenCalledWith({}, signal);
	});

	it("reports what execute throws", async () => {
		const tool = defineWebMcpTool({
			name: "fail",
			title: "Fail",
			description: "Fails.",
			input: z.object({}),
			execute: () => {
				throw new Error("The resume is locked.");
			},
		});

		await expect(tool.execute({})).resolves.toBe("Error: The resume is locked.");
	});
	it("preserves abort rejection and never executes a pre-aborted call", async () => {
		const execute = vi.fn(() => "done");
		const tool = defineWebMcpTool({ name: "wait", title: "Wait", description: "Waits.", input: z.object({}), execute });
		const controller = new AbortController();
		const reason = new Error("Cancelled by caller");
		controller.abort(reason);
		await expect(tool.execute({}, { signal: controller.signal })).rejects.toBe(reason);
		expect(execute).not.toHaveBeenCalled();
		const abort = new DOMException("Cancelled", "AbortError");
		execute.mockImplementation(() => {
			throw abort;
		});
		await expect(tool.execute({})).rejects.toBe(abort);
	});
});

describe("useWebMcpTools", () => {
	const tools: readonly WebMcpTool[] = [echo];

	it("does nothing where the browser has no WebMCP", () => {
		expect(() => renderHook(() => useWebMcpTools(tools)).unmount()).not.toThrow();
	});

	it("registers each tool with a signal that unregisters it on unmount", () => {
		const registerTool = vi.fn(async () => {});
		install("document", { registerTool });

		const hook = renderHook(() => useWebMcpTools(tools));

		expect(registerTool).toHaveBeenCalledTimes(1);
		const [tool, options] = registerTool.mock.calls[0] as unknown as [WebMcpTool, { signal: AbortSignal }];
		expect(tool).toBe(echo);
		expect(options.signal.aborted).toBe(false);

		hook.unmount();
		expect(options.signal.aborted).toBe(true);
	});

	it("unregisters by name on browsers with the older API", () => {
		const unregisterTool = vi.fn();
		install("navigator", { registerTool: vi.fn(), unregisterTool });

		renderHook(() => useWebMcpTools(tools)).unmount();

		expect(unregisterTool).toHaveBeenCalledWith("echo");
	});

	it("keeps the page working when the browser refuses a tool", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		install("document", {
			registerTool: vi
				.fn()
				.mockImplementationOnce(() => {
					throw new DOMException("Duplicate name", "InvalidStateError");
				})
				.mockImplementationOnce(() => Promise.reject(new TypeError("Bad schema"))),
		});

		renderHook(() => useWebMcpTools([echo, echo]));
		await Promise.resolve();

		expect(warn).toHaveBeenCalledTimes(2);
	});

	it("registers nothing for an empty list", () => {
		const registerTool = vi.fn();
		install("document", { registerTool });

		renderHook(() => useWebMcpTools([]));

		expect(registerTool).not.toHaveBeenCalled();
	});
});
