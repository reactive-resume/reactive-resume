import type { WebAccessConnection, WebAccessProvider } from "./contracts";
import { ORPCError } from "@orpc/client";
import { and, eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { firecrawlCredential, webAccessCredential } from "@reactive-resume/db/schema";
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
	return env.FIRECRAWL_API_URL || env.FIRECRAWL_API_KEY
		? {
				provider: "firecrawl",
				apiUrl: env.FIRECRAWL_API_URL || "https://api.firecrawl.dev",
				apiKey: env.FIRECRAWL_API_KEY || "",
			}
		: null;
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

const legacyConflict = () =>
	new ORPCError("CONFLICT", {
		message: "A different web provider is selected. Manage this connection through /integrations/web-access.",
	});

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
	/** Legacy writes may only change Firecrawl, including when racing a generic provider change. */
	save: async (userId: string, provider: WebAccessProvider, apiKey: string, legacyFirecrawl = false) => {
		assertPersonalKeysAllowed();
		const { encryptedApiKey } = encryptCredential(apiKey.trim());
		await db.transaction(async (tx) => {
			const saved = await tx
				.insert(webAccessCredential)
				.values({ userId, provider, encryptedApiKey })
				.onConflictDoUpdate({
					target: webAccessCredential.userId,
					set: { provider, encryptedApiKey },
					...(legacyFirecrawl ? { setWhere: eq(webAccessCredential.provider, "firecrawl") } : {}),
				})
				.returning({ userId: webAccessCredential.userId });
			if (saved.length === 0) throw legacyConflict();
			await tx.delete(firecrawlCredential).where(eq(firecrawlCredential.userId, userId));
		});
	},
	delete: async (userId: string, legacyFirecrawl = false) => {
		assertPersonalKeysAllowed();
		await db.transaction(async (tx) => {
			const [saved] = await tx
				.select()
				.from(webAccessCredential)
				.where(eq(webAccessCredential.userId, userId))
				.limit(1)
				.for("update");
			if (legacyFirecrawl && saved && saved.provider !== "firecrawl") throw legacyConflict();
			await tx
				.delete(webAccessCredential)
				.where(
					and(
						eq(webAccessCredential.userId, userId),
						legacyFirecrawl ? eq(webAccessCredential.provider, "firecrawl") : undefined,
					),
				);
			await tx.delete(firecrawlCredential).where(eq(firecrawlCredential.userId, userId));
		});
	},
};
