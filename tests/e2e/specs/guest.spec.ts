import { registerViaUi } from "../fixtures/auth";
import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test.skip(process.env.FLAG_ENABLE_GUEST_LOGIN !== "true", "Needs FLAG_ENABLE_GUEST_LOGIN=true");

test("keeps a guest's resume after creating an account", async ({ page, account }, testInfo) => {
	await page.goto("/auth/login");
	await page.getByRole("button", { name: "Continue as guest" }).click();
	await page.waitForURL(/\/dashboard/);
	await expect(page.getByText("You're using a guest account")).toBeVisible();

	const resumeName = await createSampleResumeFromDashboard(page, testInfo);

	await registerViaUi(page, account);
	await expect(page.getByText(resumeName)).toBeVisible();
	await expect(page.getByText("You're using a guest account")).toBeHidden();
});
