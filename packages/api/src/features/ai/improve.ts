import { z } from "zod";
import { improveSystemPrompt, improveUserPromptTemplate } from "@reactive-resume/ai/prompts";
import { inertMarkers } from "./data-block";
import { generateJson } from "./generate-json";
import { getModel } from "./service";

const REQUESTS = {
	verb: "Stronger verb",
	result: "Add a result",
	shorter: "Make it shorter",
} as const;

export const improveInputSchema = z.object({
	aiProviderId: z.string().optional(),
	line: z.string().trim().min(1).max(2_000),
	action: z.enum(["verb", "result", "shorter", "custom"]),
	/** The user's own words: what to change for "Ask for something else…", or the result itself for "Add a result". */
	request: z.string().trim().max(500).optional(),
	/** Where the line sits, e.g. "Description · Fieldnote". */
	where: z.string().trim().max(200).default(""),
	/** The rest of the field, for tone and what's already said; its results belong to their own lines. */
	context: z.string().max(10_000).default(""),
});

type ImproveInput = z.infer<typeof improveInputSchema>;

export const improveOutputSchema = z.object({
	text: z
		.string()
		.transform((text) => text.replace(/\s+/g, " ").trim())
		.pipe(z.string().min(1)),
	why: z.string().catch(""),
	addsFacts: z.boolean().catch(true),
});

export type ImproveOutput = z.infer<typeof improveOutputSchema>;

type ImproveServiceInput = ImproveInput & {
	signal?: AbortSignal | undefined;
	provider: Parameters<typeof getModel>[0]["provider"];
	model: string;
	apiKey: string;
	baseURL: string;
};

export function buildUserPrompt(input: ImproveInput): string {
	const request =
		input.action === "custom"
			? `Something else: ${input.request || "Improve it."}`
			: input.action === "result" && input.request
				? `${REQUESTS.result}. The user says the result was: ${input.request}`
				: REQUESTS[input.action];
	const values: Record<string, string> = {
		REQUEST: request,
		WHERE: input.where || "Not given",
		LINE: inertMarkers(input.line),
		CONTEXT: inertMarkers(input.context || "None"),
	};

	// One pass, so text in the line that looks like a placeholder stays as it is.
	return improveUserPromptTemplate.replace(
		/\{\{([A-Z_]+)\}\}/g,
		(placeholder, name: string) => values[name] ?? placeholder,
	);
}

/** One suggested rewrite of one line. Nothing is written: the user replaces the line or keeps theirs. */
export function improveLine(input: ImproveServiceInput): Promise<ImproveOutput> {
	return generateJson(
		getModel(input),
		{ system: improveSystemPrompt, prompt: buildUserPrompt(input) },
		improveOutputSchema,
		input.signal,
		0,
	);
}
