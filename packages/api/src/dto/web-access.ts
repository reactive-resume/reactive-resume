import z from "zod";
import { webAccessProviderSchema } from "../features/web-access/contracts";

const capabilityTest = z.object({ success: z.boolean(), error: z.string().optional() });

export const webAccessDto = {
	status: {
		output: z.object({
			revision: z.string(),
			builtInReader: z.literal(true),
			configured: z.boolean(),
			testResult: z.object({ search: capabilityTest, read: capabilityTest }).nullable(),
			lastTestedAt: z.date().nullable(),
			provider: webAccessProviderSchema.nullable(),
			managed: z.boolean(),
			canSave: z.boolean(),
			search: z.boolean(),
			/** Searches go to the server's SearXNG rather than the connection. Older servers leave it out. */
			searxng: z.boolean(),
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
