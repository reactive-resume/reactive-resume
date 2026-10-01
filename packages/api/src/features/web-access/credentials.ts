import type { WebAccessConnection, WebAccessProvider } from "./contracts";
import { ORPCError } from "@orpc/client";
import { eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { webAccessCredential } from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { decryptCredential, encryptCredential } from "../ai/credentials";

function serverConfig(): WebAccessConnection | null {
	if (env.WEB_ACCESS_PROVIDER) {
		return {
			provider: env.WEB_ACCESS_PROVIDER,
			apiKey: env.WEB_ACCESS_API_KEY || "",
			...(env.WEB_ACCESS_PROVIDER === "firecrawl"
				? { apiUrl: env.WEB_ACCESS_API_URL || "https://api.firecrawl.dev" }
				: {}),
		};
	}
	return null;
}

async function savedCredential(userId: string) {
	const [credential] = await db
		.select()
		.from(webAccessCredential)
		.where(eq(webAccessCredential.userId, userId))
		.limit(1);
	return credential;
}

function assertPersonalKeysAllowed() {
	if (serverConfig()) throw new ORPCError("FORBIDDEN", { message: "Web access is managed by the server." });
	if (!env.ENCRYPTION_SECRET)
		throw new ORPCError("PRECONDITION_FAILED", { message: "Credential encryption is not configured." });
}

export const webAccessService = {
	status: async (userId: string) => {
		const global = serverConfig();
		const saved = !global && env.ENCRYPTION_SECRET ? await savedCredential(userId) : undefined;
		const provider = global?.provider ?? saved?.provider ?? null;
		return {
			builtInReader: true as const,
			configured: provider !== null,
			provider,
			managed: !!global,
			canSave: !global && !!env.ENCRYPTION_SECRET,
			search: provider !== null,
			read: true as const,
		};
	},
	resolve: async (userId: string): Promise<WebAccessConnection | null> => {
		const global = serverConfig();
		if (global) return global;
		if (!env.ENCRYPTION_SECRET) return null;
		const saved = await savedCredential(userId);
		return saved
			? {
					provider: saved.provider,
					apiKey: decryptCredential(saved.encryptedApiKey),
					...(saved.provider === "firecrawl" ? { apiUrl: "https://api.firecrawl.dev" } : {}),
				}
			: null;
	},
	save: async (userId: string, provider: WebAccessProvider, apiKey: string) => {
		assertPersonalKeysAllowed();
		const { encryptedApiKey } = encryptCredential(apiKey.trim());
		await db
			.insert(webAccessCredential)
			.values({ userId, provider, encryptedApiKey })
			.onConflictDoUpdate({ target: webAccessCredential.userId, set: { provider, encryptedApiKey } });
	},
	delete: async (userId: string) => {
		assertPersonalKeysAllowed();
		await db.delete(webAccessCredential).where(eq(webAccessCredential.userId, userId));
	},
};
