import { expect, it } from "vite-plus/test";
import { groupDocumentsByApplication, groupIsExpanded } from "./document-groups";

const job = (id: string, status: "saved" | "applied" | "closed") => ({
	id,
	company: `${id} Co`,
	role: "Engineer",
	status,
});

const resume = (id: string, applicationId: string | null, status: "saved" | "applied" | "closed" = "applied") => ({
	id,
	type: "resume" as const,
	application: applicationId ? job(applicationId, status) : null,
});

const letter = (id: string, applicationId: string | null, status: "saved" | "applied" | "closed" = "applied") => ({
	id,
	type: "letter" as const,
	application: applicationId ? job(applicationId, status) : null,
});

it("puts a job's resume and letter together where its first document appears", () => {
	const groups = groupDocumentsByApplication([
		resume("base", null),
		resume("job-resume", "northwind"),
		letter("loose", null),
		letter("job-letter", "northwind"),
	]);

	expect(groups.map((group) => group.kind)).toEqual(["document", "application", "document"]);
	expect(groups[1]?.documents.map((document) => document.id)).toEqual(["job-resume", "job-letter"]);
	expect(groups[0]?.documents.map((document) => document.id)).toEqual(["base"]);
	expect(groups[2]?.documents.map((document) => document.id)).toEqual(["loose"]);
});

it("keeps the first-seen order even when the library alternates jobs", () => {
	const groups = groupDocumentsByApplication([
		resume("one", "first"),
		resume("two", "second"),
		letter("one-letter", "first"),
		letter("two-letter", "second"),
	]);

	expect(groups.map((group) => group.key)).toEqual(["application:first", "application:second"]);
	expect(groups[0]?.documents.map((document) => document.id)).toEqual(["one", "one-letter"]);
	expect(groups[1]?.documents.map((document) => document.id)).toEqual(["two", "two-letter"]);
});

it("marks closed jobs collapsed by default and lets an explicit choice win", () => {
	const groups = groupDocumentsByApplication([resume("closed", "old", "closed")]);
	const group = groups[0];
	expect(group?.closed).toBe(true);
	if (!group) throw new Error("missing group");

	expect(groupIsExpanded(group.closed, new Map(), group.key)).toBe(false);
	expect(groupIsExpanded(group.closed, new Map([[group.key, true]]), group.key)).toBe(true);
	expect(groupIsExpanded(false, new Map([[group.key, false]]), group.key)).toBe(false);
});
