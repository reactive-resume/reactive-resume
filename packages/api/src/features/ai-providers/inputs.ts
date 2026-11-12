import z from "zod";
import { aiProviderSchema } from "@reactive-resume/ai/types";

const providerFields = z.object({
	label: z.string().trim().min(1),
	provider: aiProviderSchema,
	model: z.string().trim().min(1),
	fastModel: z.string().trim().max(200).optional(),
	capableModel: z.string().trim().max(200).optional(),
	baseURL: z.string().trim().optional(),
	apiKey: z.string().trim(),
});

// Local OpenAI-compatible servers such as LM Studio often run without authentication.
const keylessProvider = (provider: string | undefined) => provider === "ollama" || provider === "openai-compatible";

export const providerInput = providerFields.refine(
	(input) => keylessProvider(input.provider) || input.apiKey.length > 0,
	{
		message: "Enter an API key for this provider.",
		path: ["apiKey"],
	},
);

export const updateProviderInput = providerFields
	.partial()
	.extend({ id: z.string(), enabled: z.boolean().optional() })
	.refine((input) => input.apiKey === undefined || input.apiKey.length > 0 || keylessProvider(input.provider), {
		message: "Enter an API key for this provider.",
		path: ["apiKey"],
	})
	.refine((input) => Object.keys(input).some((key) => key !== "id"), {
		message: "At least one field must be provided.",
	});
