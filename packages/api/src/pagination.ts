import z from "zod";

// Opt-in pagination keeps existing array responses and clients that load the full library compatible.
export const paginationShape = {
	limit: z
		.number()
		.int()
		.min(1)
		.max(100)
		.optional()
		.describe("Maximum results (1–100). Omit both pagination fields for the legacy complete list."),
	offset: z
		.number()
		.int()
		.min(0)
		.max(Number.MAX_SAFE_INTEGER)
		.optional()
		.describe("Zero-based offset. Defaults to 0; limit defaults to 20 when only offset is given."),
};

export function paginate<T>(
	items: T[],
	input: { limit?: number | undefined; offset?: number | undefined },
	headers?: Headers,
): T[] {
	headers?.set("X-Total-Count", String(items.length));
	if (input.limit === undefined && input.offset === undefined) return items;
	const limit = input.limit ?? 20;
	const offset = input.offset ?? 0;
	headers?.set("X-Limit", String(limit));
	headers?.set("X-Offset", String(offset));
	// ponytail: slice the existing per-user library in memory; move pagination into SQL if large libraries dominate memory.
	return items.slice(offset, offset + limit);
}
