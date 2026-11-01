import type { DbOrTx } from "@reactive-resume/db/client";
import { ORPCError } from "@orpc/client";
import { eq, sql } from "drizzle-orm";
import { careerSchedule } from "@reactive-resume/db/schema";

/** Caller holds the user lock so concurrent application and schedule inserts share the same account limit. */
export async function assertScheduleCapacity(tx: DbOrTx, userId: string) {
	const [count] = await tx
		.select({ total: sql<number>`count(*)::int` })
		.from(careerSchedule)
		.where(eq(careerSchedule.userId, userId));
	if ((count?.total ?? 0) >= 100)
		throw new ORPCError("BAD_REQUEST", {
			message: "You can keep up to 100 schedules. Delete one you no longer need first.",
		});
}
