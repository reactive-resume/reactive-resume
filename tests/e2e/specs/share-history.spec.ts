import { createSampleResumeFromDashboard, getPublicUrl, makeResumePublic } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test("renames the public address and keeps the old one redirecting", async ({ browser, authPage: page }, testInfo) => {
	await createSampleResumeFromDashboard(page, testInfo);
	const oldUrl = await makeResumePublic(page);
	const address = page.getByRole("textbox", { name: "Address" });

	await address.fill("not_valid!");
	await expect(page.getByText("Use Latin letters a–z, numbers and single dashes.")).toBeVisible();

	await address.fill("renamed-address");
	const resumeId = new URL(page.url()).pathname.split("/")[2];
	await expect
		.poll(async () => (await (await page.request.get(`/api/openapi/resumes/${resumeId}`)).json()).slug)
		.toBe("renamed-address");
	await expect(page.getByRole("button", { name: "Copy link", exact: true })).toBeEnabled();
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
