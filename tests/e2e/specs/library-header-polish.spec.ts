import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";
async function seed(page: Page) {
	const r = await page.request.post("/api/openapi/resumes", {
		data: { name: "Fictional header audit", tags: ["Remote", "Design"] },
	});
	await expect(r).toBeOK();
	return r.json();
}
for (const width of [1440, 1024, 390])
	test(`D2-08 document tools occupy the shared header actions at ${width}`, async ({ authPage: page }, info) => {
		await seed(page);
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/dashboard");
		const header = page
			.locator("header")
			.filter({ has: page.getByRole("heading", { name: "Documents", exact: true }) });
		await expect(header.getByRole("searchbox", { name: "Search documents", exact: true })).toBeVisible();
		await expect(header.getByRole("combobox", { name: "Sort", exact: true })).toBeVisible();
		await expect(header.getByRole("radio", { name: "Grid", exact: true })).toBeVisible();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		if (width === 1440)
			await header.screenshot({ path: info.outputPath("documents-header.png"), animations: "disabled" });
	});
test("L2-23 tags show entries without unexplained numeric count", async ({ authPage: page }) => {
	const id = await seed(page);
	await page.goto(`/builder/${id}`);
	await page.getByRole("button", { name: "Document menu: Fictional header audit", exact: true }).click();
	await page.getByRole("menuitem", { name: /^Tags/ }).click();
	const dialog = page.getByRole("dialog", { name: "Tags", exact: true });
	await expect(dialog.getByPlaceholder("Add a tag…", { exact: true })).toBeVisible();
	await expect(dialog.getByText("2", { exact: true })).toHaveCount(0);
	await expect(dialog.getByText("Remote", { exact: true })).toBeVisible();
	await expect(dialog.getByText("Design", { exact: true })).toBeVisible();
});
