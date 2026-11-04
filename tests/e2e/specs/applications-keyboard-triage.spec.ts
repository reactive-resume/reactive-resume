import { Client } from "pg";
import { expect, test } from "../fixtures/test";

for (const exit of ["reload", "close"] as const)
	test(`acknowledged stage move persists through ${exit} during Undo`, async ({ authPage: page }, info) => {
		const created = await page.request.post("/api/openapi/applications", {
			data: { company: "Fictional Cedar", role: "Platform engineer", status: "applied" },
		});
		await expect(created).toBeOK();
		const id: string = await created.json();
		await page.goto("/dashboard/applications");
		await page.locator(`tr[data-application-id="${id}"] [data-application-open]`).focus();
		await page.keyboard.press("5");
		await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
		if (exit === "reload")
			await page.screenshot({ path: info.outputPath("stage-move-undo.png"), animations: "disabled" });
		const pending = await page.request.get(`/api/openapi/applications/${id}`);
		await expect(pending).toBeOK();
		expect((await pending.json()).status).toBe("applied");
		await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
		if (exit === "reload") await page.reload();
		else await Promise.all([page.waitForEvent("close"), page.close({ runBeforeUnload: true })]);
		const sql = new Client({ connectionString: process.env.DATABASE_URL });
		await sql.connect();
		try {
			// Read SQL before reopening: persistence must not rely on recovery in another page.
			await expect
				.poll(async () => (await sql.query("select status from application where id = $1", [id])).rows[0]?.status)
				.toBe("offer");
			const stored = (await sql.query("select activity from application where id = $1", [id])).rows[0];
			expect(
				stored.activity.filter(
					(entry: { type: string; stage?: string }) => entry.type === "stage" && entry.stage === "offer",
				),
			).toHaveLength(1);
		} finally {
			await sql.end();
		}
	});
