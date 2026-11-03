import type { Locator, Page } from "@playwright/test";

export async function chooseCurrency(page: Page, code: string, scope: Page | Locator = page) {
	await scope.getByRole("combobox", { name: "Currency", exact: true }).click();
	await page.getByPlaceholder("Search…", { exact: true }).fill(code);
	await page.getByRole("option", { name: new RegExp(`^${code}(?: ·|$)`) }).click();
}
