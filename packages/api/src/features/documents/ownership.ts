import type { DbOrTx } from "@reactive-resume/db/client";
import { ORPCError } from "@orpc/client";
import { eq } from "drizzle-orm";
import * as schema from "@reactive-resume/db/schema";

/**
 * Locks the user's row so one user's writers run one at a time (owner first, before document or application writes)
 * without blocking foreign-key checks against it. NOT_FOUND when the user is gone.
 */
export async function lockUser(tx: DbOrTx, userId: string) {
	const [owner] = await tx
		.select({ id: schema.user.id })
		.from(schema.user)
		.where(eq(schema.user.id, userId))
		.for("no key update");
	if (!owner) throw new ORPCError("NOT_FOUND");
}
