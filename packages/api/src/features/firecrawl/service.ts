import { ORPCError } from "@orpc/client";
import { webAccessService } from "../web-access/credentials";

export type FirecrawlConfig = { apiUrl: string; apiKey: string };

async function assertFirecrawlSelected(userId: string) {
	const status = await webAccessService.status(userId);
	if (status.provider && status.provider !== "firecrawl")
		throw new ORPCError("CONFLICT", {
			message: "A different web provider is selected. Manage this connection through /integrations/web-access.",
		});
}

/** Compatibility endpoints never read the retired Firecrawl credential table. */
export const firecrawlService = {
	status: async (userId: string) => {
		const status = await webAccessService.status(userId);
		return {
			managed: status.managed,
			configured: status.provider === "firecrawl",
			canSave: status.canSave && (!status.provider || status.provider === "firecrawl"),
		};
	},
	resolve: async (userId: string): Promise<FirecrawlConfig | null> => {
		if ((await webAccessService.status(userId)).provider !== "firecrawl") return null;
		const connection = await webAccessService.resolve(userId);
		return connection?.provider === "firecrawl"
			? { apiUrl: connection.apiUrl || "https://api.firecrawl.dev", apiKey: connection.apiKey || "" }
			: null;
	},
	save: async (userId: string, apiKey: string) => {
		await assertFirecrawlSelected(userId);
		await webAccessService.save(userId, "firecrawl", apiKey, true);
	},
	delete: async (userId: string) => {
		await assertFirecrawlSelected(userId);
		await webAccessService.delete(userId, true);
	},
};
