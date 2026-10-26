import { createSampleResumeFromDashboard, getPublicUrl, makeResumePublic } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test("renames the public address and keeps the old one redirecting", async ({ browser, authPage: page }, testInfo) => {
	await createSampleResumeFromDashboard(page, testInfo);
	const oldUrl = await makeResumePublic(page);
	const address = page.getByRole("textbox", { name: "Address" });

	await address.fill("not_valid!");
	await expect(page.getByText("Use lowercase letters, numbers and single dashes.")).toBeVisible();

	await address.fill("renamed-address");
	await expect(page.getByText(/^Live at .*\/renamed-address$/)).toBeVisible();
	expect(await getPublicUrl(page)).toMatch(/\/renamed-address$/);

	const visitor = await browser.newPage();
	try {
		await visitor.goto(oldUrl);
		await visitor.waitForURL(/\/renamed-address$/);
		await expect(visitor.getByRole("heading", { level: 1 })).toBeVisible();
	} finally {
		await visitor.close();
	}
});
