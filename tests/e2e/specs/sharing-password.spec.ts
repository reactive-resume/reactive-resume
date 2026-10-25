import { createSampleResumeFromDashboard, makeResumePublic } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test("password-protects a public resume and unlocks it as a visitor", async ({ browser, authPage: page }, testInfo) => {
	await createSampleResumeFromDashboard(page, testInfo);
	const publicUrl = await makeResumePublic(page);

	const password = "e2e-secret-42";
	const requirePassword = page.getByRole("switch", { name: "Require a password" });
	await requirePassword.click();
	const dialog = page.getByRole("dialog", { name: "Protect your resume with a password" });
	await dialog.getByLabel("Password", { exact: true }).fill(password);
	await dialog.getByLabel("Confirm password", { exact: true }).fill("different-password");
	await dialog.getByRole("button", { name: "Set password" }).click();
	await expect(dialog.getByRole("alert")).toHaveText("Enter the same password in both fields.");
	await dialog.getByLabel("Confirm password", { exact: true }).fill(password);
	await dialog.getByRole("button", { name: "Set password" }).click();
	await expect(requirePassword).toBeChecked();

	const anonymous = await browser.newPage();
	try {
		// Anonymous visitors hit the password gate first
		await anonymous.goto(publicUrl);
		await anonymous.waitForURL(/\/auth\/resume-password/);

		await anonymous.getByLabel("Password", { exact: true }).fill(password);
		await anonymous.getByRole("button", { name: "Unlock" }).click();

		// The correct password reveals the actual resume
		await expect(anonymous.getByRole("button", { name: "Download PDF" }).first()).toBeVisible();
	} finally {
		await anonymous.close();
	}
});
