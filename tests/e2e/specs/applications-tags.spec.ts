import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";

async function importApplications(page: Page, items: Record<string, unknown>[]) {
	const response = await page.request.post("/api/openapi/applications/import", { data: { items } });
	await expect(response).toBeOK();
}

test("a tag chip filters the application rows through the page search", async ({ authPage: page }) => {
	await importApplications(page, [
		{ company: "Northwind Labs", role: "Engineer", status: "applied", tags: ["review-next"] },
		{ company: "Harborlight Studio", role: "Designer", status: "applied", tags: ["design"] },
	]);
	await page.goto("/dashboard/applications");

	await page.getByRole("button", { name: "Filter by review-next", exact: true }).click();

	await expect(page.getByRole("searchbox", { name: "Search applications" })).toHaveValue("review-next");
	await expect(page.getByRole("button", { name: /Engineer/ }).first()).toBeVisible();
	await expect(page.getByRole("button", { name: /Designer/ })).toHaveCount(0);
});
