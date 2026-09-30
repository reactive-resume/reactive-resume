import z from "zod";
import { webAccessProviderSchema } from "../features/web-access/contracts";

const capabilityTest = z.object({ success: z.boolean(), error: z.string().optional() });

export const webAccessDto = {
	status: {
		output: z.object({
			builtInReader: z.literal(true),
			configured: z.boolean(),
			provider: webAccessProviderSchema.nullable(),
			managed: z.boolean(),
			canSave: z.boolean(),
			search: z.boolean(),
			read: z.literal(true),
		}),
	},
	save: {
		input: z.object({ provider: webAccessProviderSchema, apiKey: z.string().trim().min(1).max(2_000) }),
		output: z.void(),
	},
	delete: { output: z.void() },
	test: { output: z.object({ search: capabilityTest, read: capabilityTest }) },
};
