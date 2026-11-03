import type { Page } from "@playwright/test";
import { Pool } from "pg";
import { expect, test } from "../fixtures/test";

let database: Pool;
test.beforeAll(() => {
	if (!process.env.DATABASE_URL) throw new Error("Disposable DATABASE_URL is required.");
	database = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
});
test.afterAll(async () => await database.end());

async function createFact(page: Page) {
	const text = "I wrote the fictional Cedar onboarding checklist.";
	const response = await page.request.post("/api/openapi/career/facts", {
		data: { text, category: "experience", source: { kind: "manual", id: "correction-proof", quote: text } },
	});
	await expect(response).toBeOK();
	return { id: ((await response.json()) as { id: string }).id, text };
}

for (const width of [1440, 390]) {
	test(`Knowledge type and scope correction persists through protected reads and reload (${width})`, async ({
		authPage: page,
	}, info) => {
		await page.setViewportSize({ width, height: 920 });
		const application = await page.request.post("/api/openapi/applications", {
			data: { company: "Fictional Cedar", role: "Engineer" },
		});
		await expect(application).toBeOK();
		const applicationId = (await application.json()) as string;
		const fact = await createFact(page);
		await page.goto("/dashboard/career/knowledge/facts");
		const row = page.locator(`[data-fact="${fact.id}"]`);
		await row.getByRole("button", { name: "Correct", exact: true }).click();
		await row.getByRole("combobox", { name: "Fact type", exact: true }).selectOption("skill");
		await row.getByRole("combobox", { name: "Scope", exact: true }).selectOption(applicationId);
		await row.getByRole("button", { name: "Save correction", exact: true }).click();
		await expect(row.getByText("Fictional Cedar only", { exact: true })).toBeVisible();
		await expect(row.locator("p").first()).toContainText("Skill");
		expect(
			(await database.query("select text,category,application_id,revisions from career_fact where id=$1", [fact.id]))
				.rows[0],
		).toEqual({
			text: fact.text,
			category: "skill",
			application_id: applicationId,
			revisions: [{ text: fact.text, category: "experience", applicationId: null, at: expect.any(String) }],
		});
		const shared = await page.request.get("/api/openapi/career/facts");
		await expect(shared).toBeOK();
		expect((await shared.json()) as unknown[]).toEqual([]);
		const scoped = await page.request.get("/api/openapi/career/facts", { params: { applicationId } });
		await expect(scoped).toBeOK();
		expect(await scoped.json()).toEqual([
			expect.objectContaining({ id: fact.id, text: fact.text, category: "skill", applicationId }),
		]);
		await page.reload();
		await expect(row.getByText("Fictional Cedar only", { exact: true })).toBeVisible();
		await row.getByRole("button", { name: "Correct", exact: true }).click();
		await expect(row.getByRole("combobox", { name: "Fact type", exact: true })).toHaveValue("skill");
		await expect(row.getByRole("combobox", { name: "Scope", exact: true })).toHaveValue(applicationId);
		await page.screenshot({ path: info.outputPath("fact-correction.png"), fullPage: true });
		await row.getByRole("button", { name: "Cancel", exact: true }).click();
	});
}

test("stale correction refuses every field and retains the authored draft for review", async ({ authPage: page }) => {
	const fact = await createFact(page);
	const invalid = await page.request.post(`/api/openapi/career/facts/${fact.id}/corrections`, {
		data: {
			before: { text: fact.text, category: "experience", applicationId: null },
			text: "Fictional private correction",
			privateApplicationId: "unsupported-field",
		},
	});
	expect(invalid.status()).toBe(400);
	expect((await database.query("select text from career_fact where id=$1", [fact.id])).rows[0]?.text).toBe(fact.text);
	await page.goto("/dashboard/career/knowledge/facts");
	const row = page.locator(`[data-fact="${fact.id}"]`);
	await row.getByRole("button", { name: "Correct", exact: true }).click();
	await row.getByRole("textbox", { name: "Correct this fact" }).fill("Fictional local correction");
	await row.getByRole("combobox", { name: "Fact type", exact: true }).selectOption("skill");
	await expect(
		await page.request.patch(`/api/openapi/career/facts/${fact.id}`, { data: { text: "Fictional newer correction" } }),
	).toBeOK();
	await row.getByRole("button", { name: "Save correction", exact: true }).click();
	await expect(page.getByText(/This fact changed\. Close the correction/)).toBeVisible();
	await expect(row.getByRole("textbox", { name: "Correct this fact" })).toHaveValue("Fictional local correction");
	expect(
		(await database.query("select text,category,application_id from career_fact where id=$1", [fact.id])).rows[0],
	).toEqual({ text: "Fictional newer correction", category: "experience", application_id: null });
	await row.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(row.getByText("Fictional newer correction", { exact: true })).toBeVisible();
});

test("forgotten history returns only redacted metadata, even for a legacy row, in account timezone", async ({
	authPage: page,
	account,
}, info) => {
	const fact = await createFact(page);
	const at = "2026-10-30T23:30:00.000Z";
	await database.query('update "user" set timezone=$1 where email=$2', ["Pacific/Auckland", account.email]);
	// Legacy row deliberately retains private payload: the read owner must project metadata rather than trust erasure.
	await database.query("update career_fact set status='forgotten',updated_at=$1,revisions=$2 where id=$3", [
		at,
		JSON.stringify([{ text: "Fictional legacy correction", at }]),
		fact.id,
	]);
	const history = await page.request.get("/api/openapi/career/facts/forgotten");
	await expect(history).toBeOK();
	expect(await history.json()).toEqual([{ count: 1, at }]);
	await page.goto("/dashboard/career/knowledge/facts");
	await page.getByRole("button", { name: "Show forgotten", exact: true }).click();
	await expect(page.getByText(/1 fact forgotten/)).toContainText(/Oct 31/);
	await expect(page.getByText(fact.text, { exact: true })).toHaveCount(0);
	await expect(page.getByText("Fictional legacy correction", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Correct", exact: true })).toHaveCount(0);
	await page.screenshot({ path: info.outputPath("forgotten-facts.png"), fullPage: true });
});
