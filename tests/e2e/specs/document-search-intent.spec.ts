import type { Page, Route, TestInfo } from "@playwright/test";
import { Pool } from "pg";
import { expect, test } from "../fixtures/test";

async function seed(page: Page, pool: Pool) {
	const resume = await page.request.post("/api/openapi/resumes", {
		data: { name: "Shared filter resume", tags: ["intent-tag"] },
	});
	await expect(resume).toBeOK();
	const resumeId: string = await resume.json();
	await expect(await page.request.put(`/api/openapi/resumes/${resumeId}`, { data: { isPublic: true } })).toBeOK();
	const letter = await page.request.post("/api/openapi/cover-letters", {
		data: { name: "Shared filter letter", content: "<p>Fictional.</p>" },
	});
	await expect(letter).toBeOK();
	const letterId: string = (await letter.json()).id;
	await pool.query("update cover_letter set tags=array['intent-tag'] where id=$1", [letterId]);
	const sql = (
		await pool.query(
			"select 'resume' as type,id,user_id,name,tags from resume where id=$1 union all select 'letter',id,user_id,name,tags from cover_letter where id=$2",
			[resumeId, letterId],
		)
	).rows;
	expect(sql).toHaveLength(2);
	expect(new Set(sql.map((row) => row.user_id)).size).toBe(1);
	expect(sql.map((row) => row.id).sort()).toEqual([resumeId, letterId].sort());
	return { resumeId, letterId, sql };
}

type Input = { type: string; q: string; tags: string[]; public: boolean; sort: string; limit: number; offset: number };
function holdRead(page: Page, matches: (input: Input) => boolean) {
	let release = () => {};
	const barrier = new Promise<void>((resolve) => {
		release = resolve;
	});
	const reads: Input[] = [];
	let held = 0;
	let fail = false;
	const handler = async (route: Route) => {
		const request = route.request();
		const body = request.postDataJSON();
		const calls = Array.isArray(body) ? body : [{ url: request.url(), body }];
		const owned = calls.filter((item) => item.url.includes("/documents/page"));
		for (const call of owned) reads.push(call.body.json);
		if (owned.some((item) => matches(item.body.json))) {
			held++;
			await barrier;
			if (fail) {
				await route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({ message: "RX112 owned pending search fault" }),
				});
				return;
			}
		}
		await route.continue();
	};
	return {
		reads,
		handler,
		release: () => release(),
		held: () => held,
		fail: (value: boolean) => {
			fail = value;
		},
	};
}

async function receipt(page: Page, info: TestInfo, data: unknown) {
	await info.attach("pending-intent-SQL-HTTP-final", {
		body: JSON.stringify({ data, url: page.url() }),
		contentType: "application/json",
	});
}

for (const change of [
	"no Enter",
	"same request",
	"type",
	"tag",
	"public",
	"sort",
	"query",
	"round trip",
	"escape",
	"empty",
	"error",
	"leave page",
] as const)
	test(`pending Documents Enter belongs to its request: ${change}`, async ({ authPage: page }, info) => {
		const pool = new Pool({ connectionString: process.env.DATABASE_URL });
		const held = holdRead(
			page,
			(input) =>
				input.q === "Shared" &&
				input.type === "all" &&
				input.tags.length === 0 &&
				!input.public &&
				input.sort === "edited",
		);
		const opens: string[] = [];
		page.on("framenavigated", (frame) => {
			if (frame === page.mainFrame() && new URL(frame.url()).pathname.startsWith("/builder/"))
				opens.push(new URL(frame.url()).pathname);
		});
		let fixtures: Awaited<ReturnType<typeof seed>> | undefined;
		try {
			fixtures = await seed(page, pool);
			await page.goto("/dashboard?view=list");
			await expect(page.getByRole("link", { name: "Shared filter resume", exact: true })).toBeVisible();
			await page.route("**/api/rpc/**", held.handler);
			const search = page.getByRole("searchbox", { name: "Search documents" });
			await search.fill("Shared");
			if (change !== "no Enter") await search.press("Enter");
			await expect.poll(held.held).toBeGreaterThan(0);
			if (change === "same request") await search.press("Enter");
			if (change === "type" || change === "no Enter" || change === "round trip")
				await page.getByRole("tab", { name: /^Letters/ }).click();
			if (change === "round trip") {
				await expect.poll(() => held.reads.some((input) => input.type === "letter")).toBe(true);
				await page.getByRole("tab", { name: /^All/ }).click();
			}
			if (change === "tag") await page.getByRole("button", { name: "#intent-tag", exact: true }).click();
			if (change === "public") await page.getByRole("button", { name: "Public", exact: true }).click();
			if (change === "sort") await page.getByRole("combobox", { name: "Sort", exact: true }).selectOption("name");
			if (change === "query") await search.fill("filter letter");
			if (change === "escape") await search.press("Escape");
			if (change === "empty") {
				await pool.query("delete from resume where id=$1", [fixtures.resumeId]);
				await pool.query("delete from cover_letter where id=$1", [fixtures.letterId]);
			}
			if (change === "error") held.fail(true);
			if (change === "leave page") await page.getByRole("link", { name: "Applications", exact: true }).click();
			held.release();
			if (change === "same request") {
				await expect(page).toHaveURL(new RegExp(`/builder/letter/${fixtures.letterId}$`));
				expect(opens).toEqual([`/builder/letter/${fixtures.letterId}`]);
				return;
			}
			if (change === "error") {
				await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
				// An Enter on an already failed request must not wait for a future Retry either.
				await search.press("Enter");
				held.fail(false);
				await page.getByRole("button", { name: "Try again", exact: true }).click();
			}
			if (change === "empty") {
				await expect(page.getByText("Nothing matches “Shared”", { exact: true })).toBeVisible();
				// Empty completion consumes intent: a later healthy refetch cannot inherit it.
				const created = await page.request.post("/api/openapi/cover-letters", {
					data: { name: "Shared later letter" },
				});
				await expect(created).toBeOK();
				await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
				await search.fill("Shared later");
				await expect(page.getByRole("link", { name: "Shared later letter", exact: true })).toBeVisible();
			} else if (change === "leave page") {
				await expect(page).toHaveURL(/\/dashboard\/applications/);
				await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
				await page
					.getByRole("navigation", { name: "App", exact: true })
					.getByRole("link", { name: /^Documents\s/ })
					.click();
				await expect(page.getByRole("link", { name: "Shared filter letter", exact: true })).toBeVisible();
			} else {
				const name = change === "public" ? "Shared filter resume" : "Shared filter letter";
				await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
				if (change === "query")
					await expect(page.getByRole("link", { name: "Shared filter resume", exact: true })).toHaveCount(0);
			}
			expect(new URL(page.url()).pathname).toBe("/dashboard");
			expect(opens).toEqual([]);
			expect(held.reads.every((input) => input.limit === 100 && input.offset === 0)).toBe(true);
			if (change === "type" || change === "no Enter")
				expect(held.reads).toContainEqual(expect.objectContaining({ type: "letter", q: "Shared" }));
			if (change === "tag")
				expect(held.reads).toContainEqual(expect.objectContaining({ tags: ["intent-tag"], q: "Shared" }));
			if (change === "public")
				expect(held.reads).toContainEqual(expect.objectContaining({ public: true, q: "Shared" }));
			if (change === "sort") expect(held.reads).toContainEqual(expect.objectContaining({ sort: "name", q: "Shared" }));
			if (change === "query") expect(held.reads).toContainEqual(expect.objectContaining({ q: "filter letter" }));
		} finally {
			held.release();
			try {
				await receipt(page, info, { change, fixtures, reads: held.reads, held: held.held(), opens });
			} finally {
				await page.unroute("**/api/rpc/**", held.handler).catch(() => undefined);
				await pool.end();
			}
		}
	});

test("pending Enter is canceled when SQL-backed page recovery replaces offset100 with offset0", async ({
	authPage: page,
}, info) => {
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	const held = holdRead(page, (input) => input.q === "Shared" && input.offset === 100);
	try {
		const fixtures = await seed(page, pool);
		await pool.query(
			`insert into cover_letter (id,user_id,name,style,tags,updated_at)
select $1||'-'||n,user_id,'Shared page letter '||n,style,tags,now()-make_interval(mins=>n)
from cover_letter cross join generate_series(2,101) n where id=$1`,
			[fixtures.letterId],
		);
		const count = async () =>
			Number(
				(await pool.query("select count(*) from cover_letter where user_id=$1", [fixtures.sql[0].user_id])).rows[0]
					.count,
			);
		expect(await count()).toBe(101);
		await page.goto("/dashboard?view=list&q=Shared");
		await expect(page.getByText("1–100 of 102", { exact: true })).toBeVisible();
		await page.route("**/api/rpc/**", held.handler);
		await page.getByRole("button", { name: "Next", exact: true }).click();
		await expect.poll(held.held).toBeGreaterThan(0);
		await page.getByRole("searchbox", { name: "Search documents" }).press("Enter");
		await pool.query("delete from cover_letter where user_id=$1 and id<>$2", [
			fixtures.sql[0].user_id,
			fixtures.letterId,
		]);
		await pool.query("delete from resume where id=$1", [fixtures.resumeId]);
		expect(await count()).toBe(1);
		held.release();
		await expect(page.getByRole("link", { name: "Shared filter letter", exact: true })).toBeVisible();
		await expect(page.getByRole("navigation", { name: "Pagination" })).toHaveCount(0);
		expect(new URL(page.url()).pathname).toBe("/dashboard");
		expect(held.reads).toContainEqual(expect.objectContaining({ q: "Shared", offset: 100, limit: 100 }));
		expect(held.reads).toContainEqual(expect.objectContaining({ q: "Shared", offset: 0, limit: 100 }));
		await receipt(page, info, { fixtures, remaining: await count(), reads: held.reads });
	} finally {
		held.release();
		await page.unroute("**/api/rpc/**", held.handler);
		await pool.end();
	}
});
