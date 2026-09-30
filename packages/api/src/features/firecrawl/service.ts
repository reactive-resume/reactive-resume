import { ORPCError } from "@orpc/client";
import { eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { firecrawlCredential } from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { decryptCredential, encryptCredential } from "../ai/credentials";

export type FirecrawlConfig = { apiUrl: string; apiKey: string };

const serverConfig = (): FirecrawlConfig | null =>
	env.FIRECRAWL_API_URL || env.FIRECRAWL_API_KEY
		? { apiUrl: env.FIRECRAWL_API_URL || "https://api.firecrawl.dev", apiKey: env.FIRECRAWL_API_KEY || "" }
		: null;

async function savedCredential(userId: string) {
	const [credential] = await db
		.select()
		.from(firecrawlCredential)
		.where(eq(firecrawlCredential.userId, userId))
		.limit(1);
	return credential;
}

function assertPersonalKeysAllowed() {
	if (serverConfig()) throw new ORPCError("FORBIDDEN", { message: "Firecrawl is managed by the server." });
	if (!env.ENCRYPTION_SECRET)
		throw new ORPCError("PRECONDITION_FAILED", { message: "Credential encryption is not configured." });
}

export const firecrawlService = {
	status: async (userId: string) => {
		const managed = !!serverConfig();
		const configured = managed || (!!env.ENCRYPTION_SECRET && !!(await savedCredential(userId)));
		return { managed, configured, canSave: !managed && !!env.ENCRYPTION_SECRET };
	},
	resolve: async (userId: string): Promise<FirecrawlConfig | null> => {
		const global = serverConfig();
		if (global) return global;
		if (!env.ENCRYPTION_SECRET) return null;
		const saved = await savedCredential(userId);
		return saved ? { apiUrl: "https://api.firecrawl.dev", apiKey: decryptCredential(saved.encryptedApiKey) } : null;
	},
	save: async (userId: string, apiKey: string) => {
		assertPersonalKeysAllowed();
		const { encryptedApiKey } = encryptCredential(apiKey.trim());
		await db.insert(firecrawlCredential).values({ userId, encryptedApiKey }).onConflictDoUpdate({
			target: firecrawlCredential.userId,
			set: { encryptedApiKey },
		});
	},
	delete: async (userId: string) => {
		assertPersonalKeysAllowed();
		await db.delete(firecrawlCredential).where(eq(firecrawlCredential.userId, userId));
	},
};
