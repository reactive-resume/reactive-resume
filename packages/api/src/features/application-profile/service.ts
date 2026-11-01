import type { DbOrTx } from "@reactive-resume/db/client";
import type { ApplicationProfileData } from "@reactive-resume/schema/application-profile";
import { ORPCError } from "@orpc/client";
import { eq } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { applicationProfile } from "@reactive-resume/db/schema";
import { applicationProfileDataSchema } from "@reactive-resume/schema/application-profile";
import { generateId } from "@reactive-resume/utils/string";
import { lockUser } from "../documents/ownership";

export const applicationProfileService = {
	get: async (userId: string, reader: DbOrTx = db) => {
		const [row] = await reader.select().from(applicationProfile).where(eq(applicationProfile.userId, userId));
		return row
			? {
					data: applicationProfileDataSchema.parse(row.data),
					reviewedAt: row.reviewedAt.toISOString(),
					revision: row.revision,
				}
			: null;
	},
	save: (userId: string, input: { data: ApplicationProfileData; expectedRevision: string | null }) => {
		const data = applicationProfileDataSchema.parse(input.data);
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [stored] = await tx.select().from(applicationProfile).where(eq(applicationProfile.userId, userId));
			if ((stored?.revision ?? null) !== input.expectedRevision)
				throw new ORPCError("CONFLICT", { message: "The application profile changed. Reload it before saving." });
			const record = { data, reviewedAt: new Date(), revision: generateId() };
			await tx
				.insert(applicationProfile)
				.values({ userId, ...record })
				.onConflictDoUpdate({ target: applicationProfile.userId, set: record });
			return { ...record, reviewedAt: record.reviewedAt.toISOString() };
		});
	},
	delete: (userId: string, expectedRevision: string) =>
		db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [stored] = await tx.select().from(applicationProfile).where(eq(applicationProfile.userId, userId));
			if (!stored) return;
			if (stored.revision !== expectedRevision)
				throw new ORPCError("CONFLICT", { message: "The application profile changed. Reload it before deleting." });
			await tx.delete(applicationProfile).where(eq(applicationProfile.userId, userId));
		}),
};
