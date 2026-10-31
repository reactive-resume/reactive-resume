import type { ToolCallRepairFunction, ToolSet } from "ai";
import { jsonrepair } from "jsonrepair";
import { proposeEditsInputSchema, proposeResumeEditsInputSchema } from "@reactive-resume/ai/tools/agent-tool-contracts";

// Repairs sloppy propose_edits calls from weaker BYOK models: fix broken JSON with jsonrepair, then re-validate
// against the shared schema. Returning null falls back to the SDK's re-ask.

/** Pure core, exported for tests: returns the repaired stringified input or null. */
function repairProposeEditsInput(rawInput: string): string | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(jsonrepair(rawInput));
	} catch {
		return null;
	}

	const validated = proposeEditsInputSchema.or(proposeResumeEditsInputSchema).safeParse(parsed);
	return validated.success ? JSON.stringify(validated.data) : null;
}

export const repairAgentToolCall: ToolCallRepairFunction<ToolSet> = ({ toolCall }) => {
	if (toolCall.toolName !== "propose_edits") return Promise.resolve(null);

	const repairedInput = repairProposeEditsInput(toolCall.input);
	if (repairedInput === null || repairedInput === toolCall.input) return Promise.resolve(null);

	return Promise.resolve({ ...toolCall, input: repairedInput });
};
