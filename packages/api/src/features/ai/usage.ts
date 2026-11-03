import type { AIProvider } from "@reactive-resume/ai/types";
import type { DbOrTx } from "@reactive-resume/db/client";
import type { AiAction, AiUsageSummary } from "@reactive-resume/schema/ai-usage";
import { ORPCError } from "@orpc/client";
import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { aiRequest, user } from "@reactive-resume/db/schema";
import { generateId } from "@reactive-resume/utils/string";
import { assertProviderAvailable } from "../ai-providers/identity";
import { lockUser } from "../documents/ownership";
import { aiTransport } from "./url-policy";

export type AiUsage = {
	userId: string;
	operationId: string;
	action: AiAction;
	providerId: string;
	label: string;
	check?: ((reader: DbOrTx) => Promise<void>) | undefined;
};

/** Created only by authenticated server callers, before selecting an inference model. */
export function createAiUsage(
	userId: string,
	action: AiAction,
	provider: { id: string; label: string },
	check?: AiUsage["check"],
): AiUsage {
	return {
		userId,
		operationId: generateId(),
		action,
		providerId: provider.id,
		label: provider.label,
		check,
	};
}

/** Each SDK retry/tool step enters here once; consuming or replaying a stream never does. */
export function aiUsageTransport(usage: AiUsage, provider: AIProvider, model: string): { fetch: typeof fetch } {
	const transport = aiTransport().fetch ?? fetch;
	return {
		fetch: async (input, init) => {
			const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
			signal?.throwIfAborted();
			await db.transaction(async (tx) => {
				await lockUser(tx, usage.userId);
				await usage.check?.(tx);
				await assertProviderAvailable(
					{ id: usage.providerId, userId: usage.userId },
					tx,
					usage.action === "provider-test",
				);
				signal?.throwIfAborted();
				// Reserve before I/O so failed/cancelled attempts survive. A crash here can leave delivery unknown.
				await tx.insert(aiRequest).values({
					userId: usage.userId,
					operationId: usage.operationId,
					action: usage.action,
					providerId: usage.providerId,
					label: usage.label,
					provider,
					model,
				});
			});
			return transport(input, init);
		},
	};
}

/** A client may refer to a real request source; its account, action and model stay server-owned. */
export async function assertAiOperations(
	userId: string,
	operationIds: readonly string[],
	actions: readonly AiAction[],
	reader: DbOrTx,
) {
	const ids = [...new Set(operationIds)];
	if (!ids.length) return;
	const rows = await reader
		.selectDistinct({ id: aiRequest.operationId })
		.from(aiRequest)
		.where(
			and(eq(aiRequest.userId, userId), inArray(aiRequest.operationId, ids), inArray(aiRequest.action, [...actions])),
		);
	if (rows.length !== ids.length)
		throw new ORPCError("BAD_REQUEST", { message: "The AI request source is unavailable for this result." });
}

const selection = () => ({
	providerId: aiRequest.providerId,
	label: aiRequest.label,
	provider: aiRequest.provider,
	model: aiRequest.model,
});

export async function readAiUsages(userId: string, operationIds: readonly string[], reader: DbOrTx = db) {
	const summaries = new Map<string, AiUsageSummary>();
	if (!operationIds.length) return summaries;
	const rows = await reader
		.select({ operationId: aiRequest.operationId, ...selection(), requests: count() })
		.from(aiRequest)
		.where(and(eq(aiRequest.userId, userId), inArray(aiRequest.operationId, [...new Set(operationIds)])))
		.groupBy(aiRequest.operationId, aiRequest.providerId, aiRequest.label, aiRequest.provider, aiRequest.model);
	for (const { operationId, requests, ...model } of rows) {
		const summary = summaries.get(operationId) ?? { requests: 0, models: [] };
		summary.requests += requests;
		summary.models.push(model);
		summaries.set(operationId, summary);
	}
	return summaries;
}

export function combineAiUsage(summaries: Iterable<AiUsageSummary>): AiUsageSummary | null {
	const rows = [...summaries];
	if (!rows.length) return null;
	return {
		requests: rows.reduce((sum, row) => sum + row.requests, 0),
		models: [...new Map(rows.flatMap((row) => row.models).map((model) => [JSON.stringify(model), model])).values()],
	};
}

export async function readAiUsage(
	userId: string,
	operationIds: readonly string[],
	reader: DbOrTx = db,
): Promise<AiUsageSummary | null> {
	return combineAiUsage((await readAiUsages(userId, operationIds, reader)).values());
}

export async function readWeeklyAiUsage(userId: string, now = new Date(), includeWebSearch = false) {
	const [owner] = await db.select({ timezone: user.timezone }).from(user).where(eq(user.id, userId));
	if (!owner) throw new ORPCError("NOT_FOUND");
	const timezone = owner.timezone ?? "UTC";
	// PostgreSQL calendar arithmetic preserves local Monday boundaries through DST changes.
	const bounds = await db.execute<{ start: string | Date; end: string | Date }>(sql`select
		date_trunc('week', ${now.toISOString()}::timestamptz at time zone ${timezone}) at time zone ${timezone} as start,
		(date_trunc('week', ${now.toISOString()}::timestamptz at time zone ${timezone}) + interval '1 week') at time zone ${timezone} as end`);
	const boundary = bounds.rows[0];
	if (!boundary) throw new Error("AI_USAGE_WEEK_UNAVAILABLE");
	const range = { start: new Date(boundary.start), end: new Date(boundary.end) };
	// Older clients have a closed action map; current clients opt into the distinct search action.
	const action = includeWebSearch
		? aiRequest.action
		: sql<AiAction>`case when ${aiRequest.action} = 'web-search' then 'assistant' else ${aiRequest.action} end`;
	const groups = await db
		.select({ action, ...selection(), requests: count() })
		.from(aiRequest)
		.where(and(eq(aiRequest.userId, userId), gte(aiRequest.createdAt, range.start), lt(aiRequest.createdAt, range.end)))
		.groupBy(action, aiRequest.providerId, aiRequest.label, aiRequest.provider, aiRequest.model)
		.orderBy(aiRequest.label, action, aiRequest.model);
	return { ...range, timezone, requests: groups.reduce((sum, row) => sum + row.requests, 0), groups };
}
