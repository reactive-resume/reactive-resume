import type { Page } from "@playwright/test";
import { resolve } from "node:path";
import { Pool } from "pg";
import { expect, test } from "../fixtures/test";

async function seedResumes(page: Page, pool: Pool, count: number) {
	const created = await page.request.post("/api/openapi/resumes", { data: { name: "Archive resume 001", tags: [] } });
	await expect(created).toBeOK();
	const id: string = await created.json();
	await pool.query("UPDATE resume SET tags=array['archive-resume'] WHERE id=$1", [id]);
	if (count > 1)
		await pool.query(
			`INSERT INTO resume (id,user_id,name,slug,data,tags,updated_at,edited_at)
		SELECT $1||'-'||n,user_id,'Archive resume '||lpad(n::text,3,'0'),slug||'-'||n,data,array['archive-resume'],
		now()-make_interval(mins=>n),now()-make_interval(mins=>n) FROM resume CROSS JOIN generate_series(2,$2::int) n WHERE id=$1`,
			[id, count],
		);
	return id;
}

async function palette(page: Page) {
	await page.goto("/dashboard/applications");
	await page.getByRole("button", { name: /Search or run/ }).click();
	return page.getByRole("dialog", { name: "Command palette", exact: true });
}

test("palette resume pages reach matches beyond 100 and retain the root query", async ({ authPage: page }) => {
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		await seedResumes(page, pool, 101);
		const dialog = await palette(page);
		const input = dialog.getByRole("combobox", { name: "Search commands" });
		await input.fill("archive-resume");
		await expect(dialog.getByRole("option", { name: "Show all resumes", exact: true })).toBeVisible();
		await dialog.getByRole("option", { name: "Show all resumes", exact: true }).click();
		const scoped = page.getByRole("dialog");
		await expect(scoped.getByRole("combobox", { name: "Search commands" })).toHaveValue("archive-resume");
		await expect(scoped.getByRole("option", { name: /^Archive resume/ })).toHaveCount(100);
		await scoped.getByRole("option", { name: "Next", exact: true }).click();
		await expect(scoped.getByRole("option", { name: "Archive resume 101", exact: false })).toBeVisible();
		await expect(scoped.getByRole("option", { name: /^Archive resume/ })).toHaveCount(1);
		await scoped.screenshot({
			path: resolve("docs/images/guides/using-the-command-bar/command-bar-resume-pages.png"),
			animations: "disabled",
		});

		const scopedInput = scoped.getByRole("combobox", { name: "Search commands" });
		await scopedInput.fill("Archive resume");
		await expect(scoped.getByRole("option", { name: /^Archive resume/ })).toHaveCount(100);
		await scopedInput.fill("archive-resume");
		await expect(scoped.getByRole("option", { name: "Archive resume 001", exact: false })).toBeVisible();
		await scoped.getByRole("option", { name: "Next", exact: true }).click();
		await expect(scoped.getByRole("option", { name: /^Archive resume/ })).toHaveCount(1);
		await scoped.getByRole("option", { name: "Previous", exact: true }).click();
		await expect(scoped.getByRole("option", { name: /^Archive resume/ })).toHaveCount(100);
	} finally {
		await pool.end();
	}
});

test("late document matches preserve a moved highlight and a new search enables auto-selection again", async ({
	authPage: page,
}) => {
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	let release = () => {};
	const barrier = new Promise<void>((resolve) => {
		release = resolve;
	});
	try {
		const resumeId = await seedResumes(page, pool, 1);
		for (const company of ["archive-resume Alder", "archive-resume Birch"]) {
			await expect(
				await page.request.post("/api/openapi/applications", { data: { company, role: "Engineer", status: "saved" } }),
			).toBeOK();
		}
		const dialog = await palette(page);
		let held = 0;
		await page.route("**/api/rpc/**", async (route) => {
			const req = route.request();
			const body = req.postDataJSON();
			const calls = Array.isArray(body) ? body : [{ url: req.url(), body }];
			if (calls.some((call) => call.url.includes("/documents/list") && call.body?.json?.q === "archive-resume")) {
				held++;
				await barrier;
			}
			await route.continue();
		});
		const input = dialog.getByRole("combobox", { name: "Search commands" });
		await input.fill("archive-resume");
		await expect.poll(() => held).toBeGreaterThan(0);
		await expect(dialog.getByRole("option", { name: /archive-resume Alder/ })).toBeVisible();
		await expect(dialog.locator('[data-selected="true"]')).toHaveAttribute("data-value", /^application\./);
		await page.keyboard.press("ArrowDown");
		const selected = await dialog.locator('[data-selected="true"]').getAttribute("data-value");
		expect(selected).toMatch(/^application\./);
		release();
		await expect(dialog.getByRole("option", { name: "Archive resume 001", exact: true })).toBeVisible();
		await expect(dialog.locator('[data-selected="true"]')).toHaveAttribute("data-value", selected ?? "");
		await input.fill("Archive resume 001");
		await expect(dialog.locator('[data-selected="true"]')).toHaveAttribute("data-value", `resume.${resumeId}`);
	} finally {
		release();
		await page.unrouteAll({ behavior: "wait" });
		await pool.end();
	}
});

test("overlong palette search never selects a document matching only the truncated prefix", async ({
	authPage: page,
}) => {
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		const id = await seedResumes(page, pool, 1);
		const prefix = "x".repeat(500);
		await pool.query("UPDATE resume SET tags=array[$1] WHERE id=$2", [prefix, id]);
		const dialog = await palette(page);
		await page.clock.install();
		const truncatedReads: string[] = [];
		page.on("request", (request) => {
			if (!request.url().includes("/api/rpc/")) return;
			const body = request.postDataJSON();
			const calls = Array.isArray(body) ? body : [{ url: request.url(), body }];
			for (const call of calls)
				if (call.url.includes("/documents/list") && call.body?.json?.q === prefix) truncatedReads.push(call.url);
		});
		const question = `${prefix}y`;
		await dialog.getByRole("combobox", { name: "Search commands" }).fill(question);
		await page.clock.runFor(1000);
		await expect(dialog.getByRole("option", { name: "Archive resume 001", exact: true })).toHaveCount(0);
		await expect(dialog.locator('[data-selected="true"]')).toHaveAttribute("data-value", `ask ${question}`);
		expect(truncatedReads).toEqual([]);
		await page.keyboard.press("Enter");
		await expect(
			page.getByText("Choose a document; review your question before sending", { exact: true }),
		).toBeVisible();
	} finally {
		await pool.end();
	}
});
