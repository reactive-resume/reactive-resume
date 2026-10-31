import type { DbOrTx } from "@reactive-resume/db/client";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { generateId } from "@reactive-resume/utils/string";
import { getStorageService } from "./service";

// A failed attempt gets its own bounded retry with capped backoff. The row and last error stay durable while it runs.
const MAX_ATTEMPTS = 8;
const LEASE_MS = 5 * 60_000;
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 60 * 60_000;
const ENQUEUE_CHUNK = 1_000;

type StorageDeleteOutcome =
	| { status: "deleted"; removed: number }
	| { status: "missing"; removed: 0 }
	| { status: "partial"; removed: number; remaining: number }
	| { status: "failed"; error: string };

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Storage cleanup failed.");

const matchesPrefix = (storageKey: string, candidate: string) =>
	candidate === storageKey || candidate.startsWith(`${storageKey}/`);

/**
 * Deletes everything under a document or account prefix and verifies it is gone. A missing prefix completes without
 * work; a genuinely failed or partial delete keeps its target for a later retry.
 */
async function deleteStoragePrefix(storageKey: string): Promise<StorageDeleteOutcome> {
	try {
		const storage = getStorageService();
		const before = (await storage.list(storageKey)).filter((candidate) => matchesPrefix(storageKey, candidate));
		if (before.length === 0) return { status: "missing", removed: 0 };
		await storage.delete(storageKey);
		const remaining = (await storage.list(storageKey)).filter((candidate) => matchesPrefix(storageKey, candidate));
		if (remaining.length === 0) return { status: "deleted", removed: before.length };
		return { status: "partial", removed: before.length - remaining.length, remaining: remaining.length };
	} catch (error) {
		return { status: "failed", error: errorMessage(error) };
	}
}

/** Writes durable cleanup rows in the same transaction that deletes their document rows. */
export async function enqueueStorageCleanup(tx: DbOrTx, ownerId: string, storageKeys: readonly string[]) {
	const unique = [...new Set(storageKeys)];
	for (let start = 0; start < unique.length; start += ENQUEUE_CHUNK) {
		await tx
			.insert(schema.storageCleanupJob)
			.values(unique.slice(start, start + ENQUEUE_CHUNK).map((storageKey) => ({ ownerId, storageKey })))
			.onConflictDoNothing();
	}
}

type RunStorageCleanupInput = {
	ownerId?: string;
	/** Restrict an immediate post-delete pass to the keys it just enqueued. */
	storageKeys?: readonly string[];
	limit?: number;
};

export type StorageCleanupSummary = {
	completed: number;
	missing: number;
	failed: number;
	partial: number;
	abandoned: number;
};

const emptySummary = (): StorageCleanupSummary => ({ completed: 0, missing: 0, failed: 0, partial: 0, abandoned: 0 });

/** Sanitized signal for every runtime. Never logs storage keys, owner IDs or provider errors. */
export function reportStorageCleanupSummary(summary: StorageCleanupSummary) {
	if (summary.failed === 0 && summary.partial === 0 && summary.abandoned === 0) return;
	console.warn(
		"[storage-cleanup] Cleanup work remains. See docs/contributing/storage-cleanup.mdx for inspection and requeue.",
		{
			completed: summary.completed,
			missing: summary.missing,
			failed: summary.failed,
			partial: summary.partial,
			abandoned: summary.abandoned,
		},
	);
}

/** Claims one due job close to execution, with a new fence token for every attempt. */
function claimNext(input: RunStorageCleanupInput) {
	const now = new Date();
	return db.transaction(async (tx) => {
		const [job] = await tx
			.select()
			.from(schema.storageCleanupJob)
			.where(
				and(
					eq(schema.storageCleanupJob.status, "pending"),
					lte(schema.storageCleanupJob.nextAttemptAt, now),
					input.ownerId ? eq(schema.storageCleanupJob.ownerId, input.ownerId) : undefined,
					input.storageKeys ? inArray(schema.storageCleanupJob.storageKey, [...new Set(input.storageKeys)]) : undefined,
				),
			)
			.orderBy(asc(schema.storageCleanupJob.nextAttemptAt))
			.limit(1)
			.for("update", { skipLocked: true });
		if (!job) return null;
		const [claimed] = await tx
			.update(schema.storageCleanupJob)
			.set({
				attempts: job.attempts + 1,
				claimToken: generateId(),
				nextAttemptAt: new Date(now.getTime() + LEASE_MS),
			})
			.where(eq(schema.storageCleanupJob.id, job.id))
			.returning();
		return claimed ?? null;
	});
}

/** Processes a bounded run, one fenced claim at a time, so each lease starts immediately before its storage work. */
export async function runStorageCleanup(input: RunStorageCleanupInput = {}): Promise<StorageCleanupSummary> {
	const limit = input.limit ?? 200;
	const summary = emptySummary();
	if (limit <= 0) return summary;

	for (let processed = 0; processed < limit; processed += 1) {
		const job = await claimNext(input);
		if (!job?.claimToken) break;
		const claim = and(eq(schema.storageCleanupJob.id, job.id), eq(schema.storageCleanupJob.claimToken, job.claimToken));
		const outcome = await deleteStoragePrefix(job.storageKey);
		if (outcome.status === "deleted" || outcome.status === "missing") {
			const [acknowledged] = await db
				.delete(schema.storageCleanupJob)
				.where(claim)
				.returning({ id: schema.storageCleanupJob.id });
			if (!acknowledged) continue;
			if (outcome.status === "deleted") summary.completed += 1;
			else summary.missing += 1;
			continue;
		}

		const abandoned = job.attempts >= MAX_ATTEMPTS;
		const retryDelay = Math.min(RETRY_BASE_MS * 2 ** (job.attempts - 1), RETRY_MAX_MS);
		const [acknowledged] = await db
			.update(schema.storageCleanupJob)
			.set({
				status: abandoned ? "abandoned" : "pending",
				claimToken: null,
				nextAttemptAt: new Date(Date.now() + (abandoned ? 0 : retryDelay)),
				lastError:
					outcome.status === "partial"
						? `Partial storage delete: ${outcome.remaining} object(s) remain.`
						: outcome.error,
			})
			.where(claim)
			.returning({ id: schema.storageCleanupJob.id });
		if (!acknowledged) continue;
		if (outcome.status === "partial") summary.partial += 1;
		else summary.failed += 1;
		if (abandoned) summary.abandoned += 1;
	}
	return summary;
}
