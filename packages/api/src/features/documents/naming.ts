import { ORPCError } from "@orpc/client";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import { coverLetter, resume } from "@reactive-resume/db/schema";

/** A name-only lookup across the owner's whole library, independent of the visible page and filters. */
export async function suggestDuplicateName(input: { userId: string; type: "resume" | "letter"; id: string }) {
	const table = input.type === "resume" ? resume : coverLetter;
	const [source] = await db
		.select({ name: table.name })
		.from(table)
		.where(and(eq(table.userId, input.userId), eq(table.id, input.id), isNull(table.trashedAt)));
	if (!source) throw new ORPCError("NOT_FOUND");
	const rows = await db
		.select({ name: resume.name })
		.from(resume)
		.where(eq(resume.userId, input.userId))
		.unionAll(db.select({ name: coverLetter.name }).from(coverLetter).where(eq(coverLetter.userId, input.userId)));
	const names = new Set(rows.map(({ name }) => name.toLowerCase()));
	let base = source.name.trim().replace(/(?: \(copy\))+$/i, "");
	const numbered = /^(.*) ([1-9]\d*)$/.exec(base);
	if (numbered?.[1]) {
		const stem = numbered[1];
		// Recognize copies of a 100-character name too, where the suffix displaced the end of the original.
		const original = rows.find(
			({ name }) =>
				name.toLowerCase() === stem.toLowerCase() ||
				(name.length === 100 &&
					name
						.slice(0, 100 - (base.length - stem.length))
						.trimEnd()
						.toLowerCase() === stem.toLowerCase()),
		);
		if (original) base = original.name;
	}
	for (let number = 2; ; number++) {
		const suffix = ` ${number}`;
		const candidate = `${base
			.slice(0, 100 - suffix.length)
			.replace(/[\uD800-\uDBFF]$/u, "")
			.trimEnd()}${suffix}`;
		if (!names.has(candidate.toLowerCase())) return candidate;
	}
}
