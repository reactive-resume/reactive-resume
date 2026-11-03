import type { RouterClient } from "@orpc/server";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const fixture = vi.hoisted(() => ({ db: undefined as ReturnType<typeof drizzle> | undefined }));
vi.mock("@reactive-resume/db/client", () => ({
	get db() {
		return fixture.db;
	},
}));
vi.mock("../../context", async () => {
	const { os } = await vi.importActual<typeof import("@orpc/server")>("@orpc/server");
	return { protectedProcedure: os.$context<{ user: { id: string }; resHeaders: Headers }>() };
});
vi.mock("../resume/service", () => ({ resumeService: {} }));
vi.mock("../cover-letters/service", () => ({ coverLetterService: {} }));
vi.mock("../applications/service", () => ({ applicationService: {} }));

// Disposable database only; the test owns and drops its isolated schema.
describe.skipIf(!process.env.COVER_LETTER_TEST_DATABASE_URL)("document SQL pages on a large account", () => {
	const schemaName = `documents_test_${randomUUID().replaceAll("-", "")}`;
	let admin: Pool;
	let pool: Pool;
	let api: RouterClient<typeof import("./router").documentsRouter>;
	let headers: Headers;

	beforeAll(async () => {
		admin = new Pool({ connectionString: process.env.COVER_LETTER_TEST_DATABASE_URL });
		await admin.query(`CREATE SCHEMA ${schemaName}`);
		pool = new Pool({
			connectionString: process.env.COVER_LETTER_TEST_DATABASE_URL,
			options: `-c search_path=${schemaName}`,
		});
		fixture.db = drizzle({ client: pool });
		const migrations = new URL("../../../../../migrations/", import.meta.url);
		for (const name of (await readdir(migrations)).filter((name) => /^\d+_/.test(name)).sort()) {
			await pool.query(
				(await readFile(new URL(`${name}/migration.sql`, migrations), "utf8")).replaceAll('"public".', ""),
			);
		}
		// Pinned timestamps keep the type and id tie breakers decisive; "orders edits" restores these values.
		await pool.query(`
   INSERT INTO "user" (id, name, email, username, display_username)
    SELECT id, id, id || '@example.test', id, id FROM unnest(ARRAY['owner','stranger','large','naming','duplicates']) id;
   INSERT INTO application (id, user_id, company, role, status) VALUES
    ('job', 'owner', 'Orbital', 'Design lead', 'closed'), ('foreign-job', 'stranger', 'Secret', 'Private', 'saved');
   INSERT INTO resume (id, user_id, name, slug, data, tags, is_public, application_id, created_at, updated_at, edited_at) VALUES
    ('same', 'owner', 'Alpha', 'same', '{}', ARRAY['design','shared'], true, 'job', '2026-01-01', '2026-01-01', '2026-01-01'),
    ('foreign-link', 'owner', 'Beta', 'foreign-link', '{}', ARRAY['shared'], false, 'foreign-job', '2026-01-01', '2026-01-01', '2026-01-01'),
    ('foreign', 'stranger', 'Private document', 'foreign', '{}', ARRAY['secret'], true, 'foreign-job', '2026-01-01', '2026-01-01', '2026-01-01');
   INSERT INTO cover_letter (id, user_id, name, style, tags, source_application_id, created_at, updated_at, edited_at) VALUES
    ('same', 'owner', 'Gamma 100%_\\path', '{}', ARRAY['design','shared'], 'job', '2026-01-01', '2026-01-01', '2026-01-01');
   INSERT INTO cover_letter (id, user_id, name, style, tags, trashed_at)
    SELECT 'large-' || lpad(i::text, 5, '0'), 'large', 'Letter ' || i, '{}', ARRAY['tag-' || i],
     CASE WHEN i > 19500 THEN now() ELSE null END FROM generate_series(1, 39000) i;
   INSERT INTO resume (id, user_id, name, slug, data, trashed_at) VALUES
    ('trash', 'owner', 'Trash', 'trash', '{}', now()), ('expired', 'owner', 'Expired', 'expired', '{}', now() - interval '31 days');
  `);
		const { documentsRouter } = await import("./router");
		headers = new Headers();
		api = createRouterClient(documentsRouter, { context: { user: { id: "owner" }, resHeaders: headers } as never });
	}, 30_000);
	afterAll(async () => {
		await pool?.end();
		await admin?.query(`DROP SCHEMA ${schemaName} CASCADE`);
		await admin?.end();
	});

	it("preserves legacy arrays and headers; SQL pages interleave types with unique tie breakers", async () => {
		const legacy = await api.list();
		expect(legacy.map((row) => `${row.type}:${row.id}`)).toEqual(["letter:same", "resume:foreign-link", "resume:same"]);
		expect(headers.get("X-Total-Count")).toBe("3");
		expect(headers.has("X-Limit")).toBe(false);
		const pages = await Promise.all([0, 1, 2, 3].map((offset) => api.list({ limit: 1, offset })));
		expect(pages.flat()).toEqual(legacy);
		expect(pages[3]).toEqual([]);
		expect(headers.get("X-Total-Count")).toBe("3");
		expect(headers.get("X-Limit")).toBe("1");
		expect((await api.list({ offset: 1 })).length).toBe(2);
		expect(headers.get("X-Limit")).toBe("20");
		expect(legacy.find((row) => row.id === "foreign-link")?.application).toBeNull();
		expect(legacy.find((row) => row.type === "letter")?.slug).toBeNull();
		expect(legacy.find((row) => row.id === "same")?.application).toEqual({
			id: "job",
			company: "Orbital",
			role: "Design lead",
			status: "closed",
		});
	});

	it("says which public links ask for a password, without the password itself", async () => {
		await pool.query(`UPDATE resume SET password = 'hash' WHERE id = 'same' AND user_id = 'owner'`);
		try {
			const rows = await api.list();
			expect(rows.map((row) => [`${row.type}:${row.id}`, row.hasPassword])).toEqual([
				["letter:same", false],
				["resume:foreign-link", false],
				["resume:same", true],
			]);
			expect(JSON.stringify(rows)).not.toContain("hash");
		} finally {
			await pool.query(`UPDATE resume SET password = NULL WHERE id = 'same'`);
		}
	});

	it("projects legacy recipients only for freeform letters, with HTML entities decoded", async () => {
		await pool.query(`INSERT INTO cover_letter (id,user_id,name,style,layout,recipient,recipient_company) VALUES
			('recipient-free','owner','Recipient fixture 1','{}','freeform','<p>R&amp;D &#39;Team&#39;</p><p>Example&nbsp;Ltd</p><script>hidden</script>',''),
			('recipient-structured','owner','Recipient fixture 2','{}','structured','<p>Stale recipient</p>',''),
			('recipient-current','owner','Recipient fixture 3','{}','freeform','<p>Old recipient</p>','Current company')`);
		try {
			const page = await api.page({ type: "letter", q: "Recipient fixture", sort: "name" });
			expect(page.items.map((row) => row.recipient)).toEqual(["R&D 'Team' Example Ltd", null, "Current company"]);
			expect(page.items.every((row) => !("legacyRecipient" in row))).toBe(true);
		} finally {
			await pool.query(
				`DELETE FROM cover_letter WHERE id IN ('recipient-free','recipient-structured','recipient-current')`,
			);
		}
	});

	it("keeps long repeated resume names unique across numbered stem fallbacks", async () => {
		const name = "Long imported name ".repeat(6).slice(0, 100);
		const stem = name.slice(0, 94);
		await pool.query(
			`INSERT INTO resume (id,user_id,name,slug,data) VALUES ('name-original','naming',$1,'name-original','{}'),('name-two','naming',$2,'name-two','{}'),('name-three','naming',$3,'name-three','{}'),('name-foreign','stranger',$4,'name-foreign','{}')`,
			[name, `${stem} (2)`, `${stem} (3)`, `${stem} (4)`],
		);
		const { findFreeResumeName } = await import("../resume/slugs");
		expect(await findFreeResumeName("naming", name)).toBe(`${stem} (4)`);
	});

	it("suggests numbered copies across types and Trash while protecting ownership", async () => {
		await pool.query(`INSERT INTO resume (id,user_id,name,slug,data) VALUES
			('duplicate-source','duplicates','Portfolio','duplicate-source','{}'),('duplicate-three','stranger','Portfolio 3','duplicate-three','{}');
			INSERT INTO cover_letter (id,user_id,name,style,trashed_at) VALUES ('duplicate-two','duplicates','PORTFOLIO 2','{}',now());`);
		const { documentsRouter } = await import("./router");
		const client = createRouterClient(documentsRouter, {
			context: { user: { id: "duplicates" }, resHeaders: new Headers() } as never,
		});
		expect(await client.suggestDuplicateName({ type: "resume", id: "duplicate-source" })).toBe("Portfolio 3");
		await pool.query(
			`INSERT INTO resume (id,user_id,name,slug,data) VALUES ('duplicate-copy','duplicates','Portfolio 3','duplicate-copy','{}')`,
		);
		expect(await client.suggestDuplicateName({ type: "resume", id: "duplicate-copy" })).toBe("Portfolio 4");
		await pool.query(
			`INSERT INTO resume (id,user_id,name,slug,data) VALUES ('duplicate-year','duplicates','Resume 2026','duplicate-year','{}')`,
		);
		expect(await client.suggestDuplicateName({ type: "resume", id: "duplicate-year" })).toBe("Resume 2026 2");
		for (const id of ["duplicate-three", "missing", "duplicate-two"]) {
			await expect(
				client.suggestDuplicateName({ type: id === "duplicate-two" ? "letter" : "resume", id }),
			).rejects.toMatchObject({ code: "NOT_FOUND" });
		}
		const count = await pool.query(`SELECT count(*) AS count FROM resume WHERE user_id = 'duplicates'`);
		expect(count.rows[0].count).toBe("3");
	});

	it("filters before paging/counting, uses every tag, searches each field and treats wildcard characters literally", async () => {
		for (const q of ["orbital", "DESIGN LEAD", "design"]) {
			const page = await api.page({ q, type: "resume", tags: ["design", "shared"], limit: 1, offset: 1 });
			expect(page.items).toEqual([]);
			expect(page.total).toBe(1);
			expect(page.counts).toEqual({ resume: 1, letter: 1 });
		}
		expect((await api.page({ public: true })).items.map((row) => row.name)).toEqual(["Alpha"]);
		expect((await api.page({ q: "%_\\path" })).items.map((row) => row.type)).toEqual(["letter"]);
		expect((await api.page({ tags: ["design", "missing"] })).total).toBe(0);
		expect((await api.page({ q: "Secret" })).total).toBe(0);
		expect((await api.page({ q: "design" })).tags).toEqual(["design"]);
		expect((await api.page({ sort: "name" })).items.map((row) => row.name)).toEqual([
			"Alpha",
			"Beta",
			"Gamma 100%_\\path",
		]);
	});

	it("orders edits and creation independently before limiting the combined kinds", async () => {
		await pool.query("UPDATE resume SET edited_at='2026-03-01', created_at='2026-02-01' WHERE id='same'");
		await pool.query("UPDATE cover_letter SET edited_at='2026-02-01', created_at='2026-03-01' WHERE id='same'");
		try {
			expect((await api.list({ sort: "edited", limit: 1 })).map((row) => row.type)).toEqual(["resume"]);
			expect((await api.list({ sort: "created", limit: 1 })).map((row) => row.type)).toEqual(["letter"]);
		} finally {
			await pool.query("UPDATE resume SET edited_at='2026-01-01', created_at='2026-01-01' WHERE id='same'");
			await pool.query("UPDATE cover_letter SET edited_at='2026-01-01', created_at='2026-01-01' WHERE id='same'");
		}
	});

	it("excludes expired Trash and other owners from rows, counts and facets", async () => {
		const trash = await api.page({ trashed: true });
		expect(trash.total).toBe(1);
		expect(trash.items.map((row) => row.id)).toEqual(["trash"]);
		expect(await api.counts()).toEqual({ resume: 2, letter: 1, trash: 1 });
		expect((await api.page()).tags).toEqual(["design", "shared"]);
	});

	it("rejects invalid pages and overlong filters at the boundary", async () => {
		for (const input of [
			{ limit: 101 },
			{ limit: 0 },
			{ offset: -1 },
			{ offset: 0.5 },
			{ q: "x".repeat(501) },
			{ tags: Array(21).fill("x") },
		]) {
			await expect(api.page(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
			await expect(api.list(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
		}
	});

	it.each([false, true])(
		"keeps 19.5k rows bounded, complete and stable across every page (trashed=%s)",
		async (trashed) => {
			const { documentsRouter } = await import("./router");
			const large = createRouterClient(documentsRouter, {
				context: { user: { id: "large" }, resHeaders: new Headers() } as never,
			});
			const seen = new Set<string>();
			for (let offset = 0; offset < 19500; offset += 100) {
				const page = await large.list({ trashed, limit: 100, offset });
				expect(page).toHaveLength(100);
				for (const row of page) {
					expect(seen.has(row.id)).toBe(false);
					seen.add(row.id);
				}
			}
			expect(seen.size).toBe(19500);
			const page = await large.page({ trashed, offset: 19450 });
			expect(page.total).toBe(19500);
			expect(page.items).toHaveLength(50);
			expect(page.tags).toHaveLength(100);
			expect(JSON.stringify(page).length).toBeLessThan(40_000);
			expect((await large.page({ trashed, offset: 19500 })).items).toEqual([]);
			const tag = trashed ? "tag-29999" : "tag-9999";
			expect((await large.page({ trashed, q: tag })).tags).toContain(tag);
		},
		30_000,
	);
});
