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
	testStatus: z.string(),
	testError: z.string().nullable(),
	apiKeyPreview: z.string(),
	apiKeyFingerprint: z.string(),
	credentialMethod: z.string(),
	credentialScope: z.string().nullable(),
	needsReauth: z.boolean(),
	reauthReason: z.string().nullable(),
	reauthAt: z.date().nullable(),
	lastTestedAt: z.date().nullable(),
	lastUsedAt: z.date().nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});
