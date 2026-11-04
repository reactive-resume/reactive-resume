import { test, expect } from "../fixtures/test";
for (const width of [1440, 390])
	for (const type of ["resume", "letter"])
		for (const view of ["grid", "list"])
			test(`document tags visible for ${type} ${view} ${width}`, async ({ authPage: page }, info) => {
				await page.setViewportSize({ width, height: 1000 });
				const r = await page.request.post(type === "resume" ? "/api/openapi/resumes" : "/api/openapi/cover-letters", {
					data: { name: "Fictional tagged document", tags: [], ...(type === "resume" ? { withSampleData: true } : {}) },
				});
				expect(r.ok()).toBe(true);
				const result = await r.json();
				const id = type === "resume" ? result : result.id;
				await expect(
					await page.request.post("/api/rpc/documents/setTags", {
						data: { json: { type, id, tags: ["remote", "مرحبا"] } },
					}),
				).toBeOK();

				await page.goto(`/dashboard?view=${view}`);
				const item = page.locator(`[data-document-key="${type}:${id}"]`);
				await expect(item).toBeVisible();
				await expect(item.getByText("#remote", { exact: true })).toBeVisible();
				await expect(item.getByText("#مرحبا", { exact: true })).toBeVisible();
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
				if (width === 1440 && type === "resume" && view === "grid") {
					await expect(item.locator('[style*="background-image"]')).toBeVisible({ timeout: 20000 });
					await page
						.getByRole("main")
						.screenshot({ path: info.outputPath("document-tags.png"), animations: "disabled" });
				}
			});
