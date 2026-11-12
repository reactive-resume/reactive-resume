import z from "zod";
import { isAPIKeyOptional } from "@reactive-resume/ai/defaults";
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

export const providerInput = providerFields.refine(
	(input) => isAPIKeyOptional(input.provider) || input.apiKey.length > 0,
	{
		message: "Enter an API key for this provider.",
		path: ["apiKey"],
	},
);

export const updateProviderInput = providerFields
	.partial()
	.extend({ id: z.string(), enabled: z.boolean().optional() })
	.refine((input) => Object.keys(input).some((key) => key !== "id"), {
		message: "At least one field must be provided.",
	});
