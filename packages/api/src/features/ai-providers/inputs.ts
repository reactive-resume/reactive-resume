import z from "zod";
import { aiProviderSchema } from "@reactive-resume/ai/types";

const providerFields = z.object({
	label: z.string().trim().min(1),
	provider: aiProviderSchema,
	model: z.string().trim(),
	baseURL: z.string().trim().optional(),
	apiKey: z.string().trim(),
});

// OrcaRouter's model is chosen from its live catalog after the key is stored, so the row may briefly
// hold no model. Every other provider needs one up front.
const requiresModel = (input: { provider: string; model: string }) =>
	input.provider === "orcarouter" || input.model.length > 0;

export const providerInput = providerFields
	.refine((input) => input.provider === "ollama" || input.apiKey.length > 0, {
		message: "An API key is required for this provider.",
		path: ["apiKey"],
	})
	.refine(requiresModel, { message: "A model is required for this provider.", path: ["model"] });

export const updateProviderInput = providerFields
	.partial()
	.extend({
		id: z.string(),
		enabled: z.boolean().optional(),
		// "pkce" records that the stored key came from the OrcaRouter connect flow.
		credentialMethod: z.enum(["api_key", "pkce"]).optional(),
	})
	.refine((input) => input.apiKey === undefined || input.apiKey.length > 0 || input.provider === "ollama", {
		message: "An API key is required for this provider.",
		path: ["apiKey"],
	})
	.refine((input) => Object.keys(input).some((key) => key !== "id"), {
		message: "At least one field must be provided.",
	});
