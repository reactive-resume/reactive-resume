import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { getPublicResumeCardData } from "./social-meta";

// The real lookup query, run against a stand-in `pg` client that records the SQL and returns `rows`.
const pg = vi.hoisted(() => ({ queries: [] as { text: string; params: unknown[] }[], rows: [] as unknown[][] }));
vi.mock("@reactive-resume/db/client", async () => {
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const client = {
		query: ({ text }: { text: string }, params: unknown[]) => {
			pg.queries.push({ text, params });
			return Promise.resolve({ rows: pg.rows });
		},
	};
	return { db: drizzle({ client: client as never }) };
});

describe("getPublicResumeCardData", () => {
	beforeEach(() => {
		pg.queries = [];
		pg.rows = [];
	});

	it("cards only public, password-free resumes outside Trash, showing what an anonymous visitor sees", async () => {
		const data = structuredClone(sampleResumeData);
		data.basics.name = "";
		data.summary.hidden = true;
		// Columns in select order: data, hideContactDetails, isPrimary, customDomain.
		pg.rows = [[data, false, false, null]];

		const card = await getPublicResumeCardData({ username: "jane", slug: "resume" });

		const [query] = pg.queries;
		expect(query?.text).toContain('"resume"."is_public" = $4');
		expect(query?.params[3]).toBe(true);
		expect(query?.text).toContain('"resume"."password" is null');
		expect(query?.text).toContain('"resume"."trashed_at" is null');
		expect(card?.data.summary.content).toBe("");
		expect(card?.data.basics.headline).toBe(data.basics.headline);
	});

	it("matches renamed slugs via resumeSlugRedirect when redirect is active", async () => {
		const data = structuredClone(sampleResumeData);
		data.basics.name = "Jane Doe";
		pg.rows = [[data, false, false, null]];

		const card = await getPublicResumeCardData({ username: "jane", slug: "old-slug" });

		const [query] = pg.queries;
		expect(query?.text).toContain('"resume_slug_redirect"');
		expect(query?.text).toContain('"resume_slug_redirect"."expires_at" > now()');
		expect(query?.text).toContain('"resume_slug_redirect"."user_id" = "resume"."user_id"');
		expect(query?.text).toContain('order by "resume"."slug" = $5 desc');
		expect(query?.params[0]).toBe("old-slug");
		expect(query?.params[1]).toBe("old-slug");
		expect(query?.params[2]).toBe("jane");
		expect(query?.params[4]).toBe("old-slug");
		expect(card?.data.basics.name).toBe("Jane Doe");
	});

	it("returns null when redirect or resume does not exist", async () => {
		const card = await getPublicResumeCardData({ username: "jane", slug: "missing-slug" });
		expect(card).toBeNull();
	});
});
