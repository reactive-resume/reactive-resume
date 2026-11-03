import { expect, test } from "../fixtures/test";

test("Write scene job titles use the regular display face", async ({ page }) => {
	await page.goto("/");
	const titles = page.locator("#write b").filter({ hasText: /^(Lead )?Product Designer$/ });
	await expect(titles).toHaveCount(2);
	for (const width of [390, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		for (const title of await titles.all()) await expect(title).toHaveCSS("font-weight", "400");
	}
});
