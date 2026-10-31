import type { DbOrTx } from "@reactive-resume/db/client";
import { ORPCError } from "@orpc/client";
import { and, desc, eq, inArray } from "drizzle-orm";
import * as tables from "@reactive-resume/db/schema";
import { followUpInstant } from "@reactive-resume/schema/applications/follow-up";

type Application = typeof tables.application.$inferSelect;
/** Caller holds user → application locks. Application fields own the follow-up; schedule is its delivery index. */
export async function syncFollowUp(
	tx: DbOrTx,
	application: Application,
	options?: { timezone?: string; enabled?: boolean; email?: boolean; locale?: string },
) {
	const rows = await tx
		.select()
		.from(tables.careerSchedule)
		.where(
			and(
				eq(tables.careerSchedule.userId, application.userId),
				eq(tables.careerSchedule.applicationId, application.id),
				eq(tables.careerSchedule.kind, "follow-up"),
			),
		)
		.orderBy(desc(tables.careerSchedule.updatedAt), desc(tables.careerSchedule.id))
		.for("update");
	const [current, ...duplicates] = rows;
	let timezone = application.followUpDateOnly ? undefined : (options?.timezone ?? rows[0]?.timezone);
	if (!timezone) {
		const [user] = await tx
			.select({ timezone: tables.user.timezone })
			.from(tables.user)
			.where(eq(tables.user.id, application.userId));
		timezone = user?.timezone ?? "UTC";
	}
	const at = followUpInstant(application, timezone);
	if (application.followUpAt && !at)
		throw new ORPCError("BAD_REQUEST", { message: "This follow-up date does not exist in your timezone." });

	const ids = rows.map((row) => row.id);
	const changed = !current || current.nextRunAt.getTime() !== at?.getTime();
	if (ids.length && (changed || options?.enabled === false))
		await tx
			.update(tables.careerJob)
			.set({ status: "canceled", lease: null, leaseUntil: null })
			.where(and(inArray(tables.careerJob.scheduleId, ids), inArray(tables.careerJob.status, ["queued", "running"])));
	if (!at) {
		if (ids.length) await tx.delete(tables.careerSchedule).where(inArray(tables.careerSchedule.id, ids));
		return null;
	}
	for (const duplicate of duplicates)
		await tx
			.update(tables.careerSchedule)
			.set({ enabled: false, updatedAt: duplicate.updatedAt })
			.where(eq(tables.careerSchedule.id, duplicate.id));
	const values = {
		nextRunAt: at,
		query: application.followUpNote ?? "",
		timezone,
		enabled: options?.enabled ?? current?.enabled ?? true,
		email: options?.email ?? current?.email ?? false,
		...(options?.locale ? { locale: options.locale } : {}),
		lastQueuedAt: changed ? null : (current?.lastQueuedAt ?? null),
	};
	const [row] = current
		? await tx.update(tables.careerSchedule).set(values).where(eq(tables.careerSchedule.id, current.id)).returning()
		: await tx
				.insert(tables.careerSchedule)
				.values({ userId: application.userId, applicationId: application.id, kind: "follow-up", ...values })
				.returning();
	return row ?? null;
}
