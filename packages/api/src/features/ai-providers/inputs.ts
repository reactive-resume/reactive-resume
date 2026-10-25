import z from "zod";
import { aiProviderSchema } from "@reactive-resume/ai/types";

const providerFields = z.object({
	label: z.string().trim().min(1),
	provider: aiProviderSchema,
	model: z.string().trim().min(1),
	baseURL: z.string().trim().optional(),
	apiKey: z.string().trim(),
});

export const providerInput = providerFields.refine((input) => input.provider === "ollama" || input.apiKey.length > 0, {
	message: "Enter an API key for this provider.",
	path: ["apiKey"],
});

export const updateProviderInput = providerFields
	.partial()
	.extend({ id: z.string(), enabled: z.boolean().optional() })
	.refine((input) => input.apiKey === undefined || input.apiKey.length > 0 || input.provider === "ollama", {
		message: "Enter an API key for this provider.",
		path: ["apiKey"],
	})
	.refine((input) => Object.keys(input).some((key) => key !== "id"), {
		message: "At least one field must be provided.",
	});
