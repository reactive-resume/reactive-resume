import type { Page } from "@playwright/test";
import { Pool } from "pg";
import { expect, test } from "../fixtures/test";

async function seedLetters(page: Page, pool: Pool) {
	const response = await page.request.post("/api/openapi/cover-letters", {
		data: { name: "Cover letter – Lumen Games", content: "<p>Fictional application letter.</p>" },
	});
	await expect(response).toBeOK();
	const { id } = await response.json();
	const { rows } = await pool.query<{ user_id: string }>("select user_id from cover_letter where id = $1", [id]);
	const ownerId = rows[0]?.user_id;
	if (!ownerId) throw new Error("Missing fictional letter owner");
	await pool.query(
		`insert into cover_letter (id, user_id, name, style, tags, trashed_at)
		 select $1 || '-' || state.trashed || '-' || n, user_id,
		   (case when state.trashed then 'Archived' else 'Fictional Letter' end) || ' ' ||
		   (case when n % 2 = 0 then 'Eight' else 'Nine' end) || ' ' || lpad(n::text, 5, '0'),
		   style, array['design'], case when state.trashed then now() else null end
		 from cover_letter cross join generate_series(1, 205) n
		 cross join (values (false), (true)) state(trashed) where id = $1`,
		[id],
	);
	return ownerId;
}

test("keeps delayed search results inert and recovers failed and overlong searches", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(90_000);
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	let release = () => {};
	try {
		const ownerId = await seedLetters(page, pool);
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto("/dashboard?view=grid");
		await expect(page.locator("article")).toHaveCount(100);
		for (let i = 0; i < 2; i++) {
			await page.getByRole("button", { name: "Next", exact: true }).click();
			await expect(
				page.getByText(`${101 + i * 100}–${Math.min(200 + i * 100, 206)} of 206`, { exact: true }),
			).toBeVisible();
		}
		await expect(page.locator("article")).toHaveCount(6);
		await expect(page.getByText("201–206 of 206", { exact: true })).toBeVisible();
		await page.getByRole("main").screenshot({ path: testInfo.outputPath("library-last-page.png") });
		const search = page.getByRole("searchbox", { name: "Search documents" });
		await search.fill("Nine");
		await expect(page.locator("article")).toHaveCount(100);
		await expect(page.locator("article").first()).toContainText("Nine");
		const first = page.locator("article").first();
		await first.getByRole("checkbox").check();
		await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		let heldRequests = 0;
		const mutations: string[] = [];
		page.on("request", (request) => {
			if (/\/documents\/(?:trash|purge|restore|setTags|setLocked|rename)(?:\?|$)/.test(request.url()))
				mutations.push(request.url());
		});
		await page.route("**/api/rpc/documents/page**", async (route) => {
			if (route.request().postDataJSON().json.q === "Eight") {
				heldRequests++;
				await held;
			}
			await route.continue();
		});
		await search.fill("Eight");
		await expect.poll(() => heldRequests).toBe(1);
		await expect(first.getByRole("checkbox")).toBeDisabled();
		await expect(first.getByRole("button", { name: /Options for/ })).toBeDisabled();
		await expect(first.getByRole("link")).toHaveCount(0);
		await first
			.getByRole("checkbox")
			.evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
		await expect(page.getByText("1 selected", { exact: true })).toBeHidden();
		expect(mutations).toHaveLength(0);
		expect(
			(
				await pool.query(
					"select count(*)::int as count from cover_letter where user_id = $1 and name like '%Nine%' and trashed_at is null",
					[ownerId],
				)
			).rows[0].count,
		).toBe(103);
		release();
		await expect(first).toContainText("Eight");
		await expect(first.getByRole("checkbox")).toBeEnabled();
		const name = (await first.getByRole("checkbox").getAttribute("aria-label"))?.replace(/^Select /, "");
		await first.getByRole("checkbox").check();
		await page.getByRole("button", { name: "Move to Trash", exact: true }).click();
		await expect
			.poll(
				async () =>
					(
						await pool.query(
							"select trashed_at is not null as trashed from cover_letter where user_id = $1 and name = $2",
							[ownerId, name],
						)
					).rows[0]?.trashed,
			)
			.toBe(true);
		expect(mutations).toHaveLength(1);
		await page.unroute("**/api/rpc/documents/page**");
		await search.fill("");
		await expect(page.getByRole("button", { name: "#design", exact: true })).toBeVisible();
		await expect(first.getByRole("checkbox")).toBeEnabled();
		const lastName = await first.getByRole("heading").textContent();
		let failedRequests = 0;
		await page.route("**/api/rpc/documents/page**", async (route) => {
			if (route.request().postDataJSON().json.q === "Unavailable") {
				failedRequests++;
				await route.fulfill({ status: 503, body: "Unavailable" });
			} else await route.continue();
		});
		await search.fill("Unavailable");
		await expect(page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
		expect(failedRequests).toBeGreaterThan(0);
		await expect(search).toHaveValue("Unavailable");
		await expect(page.getByRole("tab", { name: /Letters/ })).toBeVisible();
		await expect(page.getByRole("button", { name: "#design", exact: true })).toBeVisible();
		await expect(first.getByRole("heading")).toHaveText(lastName ?? "");
		await expect(first.getByRole("checkbox")).toBeDisabled();
		await search.fill("");
		await expect(page.getByRole("alert")).toBeHidden();
		await expect(first.getByRole("checkbox")).toBeEnabled();
		const badResponses: string[] = [];
		page.on("response", (response) => {
			if (response.url().includes("/documents/page") && response.status() === 400) badResponses.push(response.url());
		});
		await search.fill("x".repeat(501));
		await expect(search).toHaveValue("x".repeat(500));
		await expect(page.getByText(/Nothing matches/)).toBeVisible();
		await page.goto(`/dashboard?view=grid&q=${"x".repeat(501)}`);
		await expect(search).toHaveValue("x".repeat(500));
		await expect(page.getByText(/Nothing matches/)).toBeVisible();
		expect(badResponses).toEqual([]);
		await search.fill("");
		await expect(page.locator("article")).toHaveCount(100);
	} finally {
		release();
		await pool.end();
	}
});

test("keeps retained Trash rows unavailable until their requested page arrives", async ({
	authPage: page,
}, testInfo) => {
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	let release = () => {};
	try {
		const ownerId = await seedLetters(page, pool);
		await page.goto("/dashboard/trash");
		await expect(page.locator("tbody tr")).toHaveCount(100);
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route("**/api/rpc/documents/page**", async (route) => {
			await held;
			await route.continue();
		});
		await page.getByRole("button", { name: "Next", exact: true }).click();
		const first = page.locator("tbody tr").first();
		await expect(first.getByRole("checkbox")).toBeDisabled();
		await expect(first.getByRole("button", { name: /Options for/ })).toBeDisabled();
		await page
			.getByRole("checkbox", { name: "Select this page in Trash" })
			.evaluate((element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true })));
		await expect(page.getByText("100 selected", { exact: true })).toBeHidden();
		await expect(page.getByText("1–100 of 205", { exact: true })).toBeVisible();
		release();
		await expect(page.getByText("101–200 of 205", { exact: true })).toBeVisible();
		await expect(first.getByRole("checkbox")).toBeEnabled();
		const name = (await first.getByRole("checkbox").getAttribute("aria-label"))?.replace(/^Select /, "");
		await first.getByRole("checkbox").check();
		await page.getByRole("button", { name: "Restore", exact: true }).click();
		await expect
			.poll(
				async () =>
					(
						await pool.query(
							"select trashed_at is null as restored from cover_letter where user_id = $1 and name = $2",
							[ownerId, name],
						)
					).rows[0]?.restored,
			)
			.toBe(true);
		await expect(page.getByText("101–200 of 204", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Next", exact: true }).click();
		await expect(page.locator("tbody tr")).toHaveCount(4);
		await expect(page.getByText("201–204 of 204", { exact: true })).toBeVisible();
		await page.getByRole("main").screenshot({ path: testInfo.outputPath("trash-last-page.png") });
	} finally {
		release();
		await pool.end();
	}
});

test("bounds tag filters from chips and URLs and clears a first-load filter failure", async ({ authPage: page }) => {
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	const badResponses: string[] = [];
	page.on("response", (response) => {
		if (response.url().includes("/api/rpc/documents/") && response.status() === 400) badResponses.push(response.url());
	});
	try {
		const ownerId = await seedLetters(page, pool);
		await pool.query(
			`update cover_letter set tags = array['tag' || lpad(n::text, 2, '0')] from (select id as document_id, row_number() over (order by id) as n from cover_letter where user_id = $1 and trashed_at is null limit 21) tagged where cover_letter.id = tagged.document_id`,
			[ownerId],
		);
		await page.goto("/dashboard");
		for (let i = 1; i <= 20; i++) {
			const chip = page.getByRole("button", { name: `#tag${String(i).padStart(2, "0")}`, exact: true });
			await chip.click();
			await expect(chip).toHaveAttribute("aria-pressed", "true");
		}
		const last = page.getByRole("button", { name: "#tag21", exact: true });
		await last.click();
		await expect(last).toHaveAttribute("aria-pressed", "false");
		await page.reload();
		await expect(page.getByRole("button", { name: "#tag20", exact: true })).toHaveAttribute("aria-pressed", "true");
		const tags = [
			...Array.from({ length: 19 }, (_, i) => `tag${String(i + 1).padStart(2, "0")}`),
			"z".repeat(41),
			"tag21",
			"",
		];
		await page.goto(`/dashboard?tags=${encodeURIComponent(JSON.stringify(tags))}`);
		await expect(page.getByText("Nothing matches these filters", { exact: true })).toBeVisible();
		expect(badResponses).toEqual([]);
		await page.getByRole("button", { name: "Clear search and filters", exact: true }).click();
		await expect(page.locator("article")).toHaveCount(100);
		await page.route("**/api/rpc/documents/**", async (route) => {
			const body = route.request().postData() ?? "";
			if (body.includes("unavailable-tag")) await route.fulfill({ status: 503, body: "Unavailable" });
			else await route.continue();
		});
		await page.goto(`/dashboard?tags=${encodeURIComponent(JSON.stringify(["unavailable-tag"]))}`);
		await expect(page.getByRole("alert")).toBeVisible({ timeout: 20_000 });
		await page.getByRole("button", { name: "Clear search and filters", exact: true }).click();
		await expect(page.getByRole("alert")).toBeHidden();
		await expect(page.locator("article")).toHaveCount(100);
		expect(badResponses).toEqual([]);
	} finally {
		await pool.end();
	}
});
