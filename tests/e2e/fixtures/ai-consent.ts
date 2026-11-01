import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Existing deterministic chat specs approve only explicitly local stub destinations. */
export async function approveLocalStubOperations(page: Page) {
	await page.addLocatorHandler(
		page.getByRole("button", { name: "Allow this operation", exact: true }),
		async (button) => {
			await expect(page.getByRole("alertdialog")).toContainText("127.0.0.1");
			await button.click();
		},
	);
}
