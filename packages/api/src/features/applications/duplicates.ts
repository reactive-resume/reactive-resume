import type { DbOrTx } from "@reactive-resume/db/client";
import { ORPCError } from "@orpc/client";
import { eq } from "drizzle-orm";
import * as tables from "@reactive-resume/db/schema";
import { canonicalOpportunityUrl } from "@reactive-resume/schema/applications/posting-url";

export async function findTrackedPosting(
	db: DbOrTx,
	userId: string,
	sourceUrl: string | null | undefined,
	excludeId?: string,
) {
	const url = sourceUrl && canonicalOpportunityUrl(sourceUrl);
	if (!url) return null;
	// Existing rows keep original URLs; normalize both sides so old clients and saved tracking links still match.
	const rows = await db
		.select({
			id: tables.application.id,
			company: tables.application.company,
			role: tables.application.role,
			sourceUrl: tables.application.sourceUrl,
		})
		.from(tables.application)
		.where(eq(tables.application.userId, userId));
	return (
		rows.find((row) => row.id !== excludeId && row.sourceUrl && canonicalOpportunityUrl(row.sourceUrl) === url) ?? null
	);
}

export async function assertUntrackedPosting(
	db: DbOrTx,
	userId: string,
	url: string | null | undefined,
	excludeId?: string,
) {
	if (await findTrackedPosting(db, userId, url, excludeId))
		throw new ORPCError("CONFLICT", {
			message: "This posting is already tracked. Open the existing application to update it.",
		});
}
