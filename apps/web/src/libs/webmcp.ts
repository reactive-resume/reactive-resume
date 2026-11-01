import { useEffect } from "react";
import z from "zod";

/**
 * WebMCP (https://webmachinelearning.github.io/webmcp/) lets a page offer tools to the AI agent in the user's browser,
 * which calls them in the page with the user's session instead of clicking through the UI. Chrome ships it behind an
 * origin trial and chrome://flags/#enable-webmcp-testing; elsewhere the API is missing and everything here does
 * nothing.
 */

type WebMcpToolAnnotations = {
	/** The tool changes nothing. */
	readOnlyHint?: boolean;
	/** The result can hold text the agent didn't write (imported or pasted content), to read as data, not instructions. */
	untrustedContentHint?: boolean;
	/** The tool's effect is hard to take back, so the agent should confirm with the user first. */
	consequentialHint?: boolean;
};

type ModelContextExecuteOptions = { signal?: AbortSignal };

/** A tool as the browser takes it: JSON Schema in, a string out. */
export type WebMcpTool = {
	name: string;
	title: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations: WebMcpToolAnnotations;
	execute: (input: unknown, options?: ModelContextExecuteOptions) => Promise<string>;
};

type ModelContext = {
	registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => unknown;
	/** Drafts before May 2026 (Chrome 149's `navigator.modelContext`) unregistered by name instead of by signal. */
	unregisterTool?: (name: string) => unknown;
};

type WithModelContext = { modelContext?: ModelContext };

const isModelContext = (value: unknown): value is ModelContext =>
	typeof value === "object" && value !== null && typeof (value as ModelContext).registerTool === "function";

/** The page's tool registry: `document.modelContext`, or `navigator.modelContext` where only the older draft ships. */
export function getModelContext(): ModelContext | null {
	if (typeof document === "undefined") return null;
	const current = (document as Document & WithModelContext).modelContext;
	if (isModelContext(current)) return current;
	// Read only as a fallback: Chrome 150–152 log a deprecation warning when the navigator alias is touched.
	const legacy =
		typeof navigator === "undefined" ? undefined : (navigator as Navigator & WithModelContext).modelContext;
	return isModelContext(legacy) ? legacy : null;
}

// Directories and models reject parameters without a type, so free-form JSON values list every JSON type.
const anyJsonTypes = (["string", "number", "boolean", "object", "array", "null"] as const).map((type) => ({ type }));

function toInputSchema(schema: z.ZodType): Record<string, unknown> {
	const { $schema: _, ...jsonSchema } = z.toJSONSchema(schema, {
		io: "input",
		reused: "inline",
		unrepresentable: "any",
		override: ({ zodSchema, jsonSchema }) => {
			const type = zodSchema._zod.def.type;
			if (type === "unknown" || type === "any") jsonSchema.anyOf = anyJsonTypes;
		},
	});
	return jsonSchema;
}

type WebMcpToolDefinition<Input extends z.ZodObject> = {
	/** Lowercase snake_case, unique on the page. */
	name: string;
	title: string;
	/** What the tool does and when to use it, written for the agent. */
	description: string;
	input: Input;
	annotations?: WebMcpToolAnnotations;
	/** Returns what the agent reads: a string as is, anything else as JSON. Failures return an error string; aborts still reject. */
	execute: (input: z.output<Input>, signal: AbortSignal | undefined) => unknown;
};

/** A tool whose input is checked against its Zod schema before `execute` runs; the agent sees why a call was refused. */
export function defineWebMcpTool<Input extends z.ZodObject>(definition: WebMcpToolDefinition<Input>): WebMcpTool {
	return {
		name: definition.name,
		title: definition.title,
		description: definition.description,
		inputSchema: toInputSchema(definition.input),
		annotations: definition.annotations ?? {},
		execute: async (input, options) => {
			const signal = options?.signal;
			try {
				signal?.throwIfAborted();
				const parsed = definition.input.safeParse(input ?? {});
				if (!parsed.success) throw new Error(`Invalid input.\n${z.prettifyError(parsed.error)}`);

				const result = await definition.execute(parsed.data, signal);
				return typeof result === "string" ? result : JSON.stringify(result);
			} catch (error) {
				// Chrome hides thrown tool errors. Return failures as text so the agent can correct its call.
				signal?.throwIfAborted();
				if (error instanceof Error && error.name === "AbortError") throw error;
				return `Error: ${error instanceof Error ? error.message : String(error)}`;
			}
		},
	};
}

function registerTool(modelContext: ModelContext, tool: WebMcpTool, signal: AbortSignal) {
	const warn = (error: unknown) => console.warn(`[webmcp] Couldn't register the ${tool.name} tool:`, error);

	let registration: unknown;
	try {
		registration = modelContext.registerTool(tool, { signal });
	} catch (error) {
		warn(error);
		return;
	}
	void Promise.resolve(registration).catch(warn);

	// Older drafts ignore the signal. Listening now, not after the registration settles, keeps a quick unmount and
	// remount (React's Strict Mode) from removing the remounted tool.
	const { unregisterTool } = modelContext;
	if (typeof unregisterTool !== "function") return;
	signal.addEventListener(
		"abort",
		() => {
			try {
				unregisterTool.call(modelContext, tool.name);
			} catch {
				// The signal already removed it.
			}
		},
		{ once: true },
	);
}

/**
 * Offers `tools` to the browser's agent while the calling component is mounted. Pass a stable array (a module constant
 * or a memo): a new array registers the tools again.
 */
export function useWebMcpTools(tools: readonly WebMcpTool[]) {
	useEffect(() => {
		const modelContext = getModelContext();
		if (!modelContext || tools.length === 0) return;

		const controller = new AbortController();
		for (const tool of tools) registerTool(modelContext, tool, controller.signal);
		return () => controller.abort();
	}, [tools]);
}
