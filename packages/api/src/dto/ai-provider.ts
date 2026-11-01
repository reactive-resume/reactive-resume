import z from "zod";
import { aiProviderSchema } from "@reactive-resume/ai/types";

export const aiProviderResponseSchema = z.object({
	managed: z.boolean(),
	id: z.string(),
	label: z.string(),
	provider: aiProviderSchema,
	model: z.string(),
	baseURL: z.string().nullable(),
	enabled: z.boolean(),
	/** Used whenever no connection is chosen, while it's switched on and tested. */
	isDefault: z.boolean(),
	testStatus: z.string(),
	testError: z.string().nullable(),
	testErrorKind: z.string().nullable(),
	apiKeyPreview: z.string(),
	apiKeyFingerprint: z.string(),
	recipientVersion: z.string().regex(/^[a-f0-9]{64}$/),
	lastTestedAt: z.date().nullable(),
	lastUsedAt: z.date().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
