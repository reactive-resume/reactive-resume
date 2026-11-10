import { daysLeft, destructionCounts, documentHref, parseDocumentTags } from "./model";

test("tag edits can clear all tags, deduplicate whitespace, and reject invalid writes before queuing", () => {
	expect(parseDocumentTags("  , ")).toEqual([]);
	expect(parseDocumentTags(" Design, Leadership , Design ")).toEqual(["Design", "Leadership"]);
	expect(parseDocumentTags("x".repeat(41))).toBeNull();
	expect(parseDocumentTags(Array.from({ length: 21 }, (_, index) => String(index)).join(","))).toBeNull();
});

test("document expiry rounds up remaining partial days and never becomes negative", () => {
	const trashed = new Date("2026-10-12T08:41:00Z");
	expect(daysLeft(trashed, new Date("2026-11-07T08:41:00Z"))).toBe(4);
	expect(daysLeft(trashed, new Date("2026-11-11T08:40:00Z"))).toBe(1);
	expect(daysLeft(trashed, new Date("2026-11-12T08:41:00Z"))).toBe(0);
});

test("confirmation counts every captured kind without including later arrivals", () => {
	const loaded = [
		{ type: "resume" as const, id: "resume" },
		{ type: "letter" as const, id: "letter" },
		{ type: "application" as const, id: "job", trashedAt: new Date() },
	];
	const confirmation = loaded.slice();
	loaded.push({ type: "resume", id: "newly-trashed" });
	expect(destructionCounts(confirmation)).toEqual({ documents: 2, applications: 1 });
	expect(documentHref({ type: "letter", id: "letter" })).toBe("/letter/letter");
	expect(documentHref({ type: "application", id: "job" })).toBe("/applications/job");
});
