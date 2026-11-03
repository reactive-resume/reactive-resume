import type { DbOrTx } from "@reactive-resume/db/client";
import { createHmac } from "node:crypto";
import { ORPCError } from "@orpc/client";
import { and, eq } from "drizzle-orm";
import { aiProvider } from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";

export const serverProviderId = (userId: string) => `server-ai:${userId}`;

/** Stable across tests and usage; credential replacement requires fresh recipient approval. */
export function recipientVersion(row: typeof aiProvider.$inferSelect, credentialRevision = row.encryptedApiKey) {
	return createHmac("sha256", env.AUTH_SECRET)
		.update(
			JSON.stringify([
				"ai-recipient-v1",
				row.userId,
				row.id,
				row.provider,
				row.model,
				// Existing single-model approvals retain their version until a task override exists.
				...(row.fastModel || row.capableModel ? [row.fastModel, row.capableModel] : []),
				row.baseUrl,
				credentialRevision,
			]),
		)
		.digest("hex");
}

/** Recheck availability of a captured recipient without resolving replacement credentials or settings. */
export async function assertProviderAvailable(input: { id: string; userId: string }, reader: DbOrTx, testing = false) {
	if (input.id === serverProviderId(input.userId)) {
		if (!env.AI_PROVIDER || !env.AI_MODEL)
			throw new ORPCError("BAD_REQUEST", { message: "AI is no longer configured on this server." });
		return;
	}
	const [provider] = await reader
		.select({ enabled: aiProvider.enabled, testStatus: aiProvider.testStatus })
		.from(aiProvider)
		.where(and(eq(aiProvider.id, input.id), eq(aiProvider.userId, input.userId)))
		.for("share");
	if (!provider) throw new ORPCError("NOT_FOUND");
	if (!testing && (!provider.enabled || provider.testStatus !== "success"))
		throw new ORPCError("BAD_REQUEST", { message: "Test and turn on this AI provider before using it." });
}
