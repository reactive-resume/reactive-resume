import { createSampleResumeFromDashboard, makeResumePublic } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test("password-protects a public resume and unlocks it as a visitor", async ({ browser, authPage: page }, testInfo) => {
	await createSampleResumeFromDashboard(page, testInfo);
	const publicUrl = await makeResumePublic(page);
	const unprotectedSummary = "On. Anyone with the link can see your web page.";
	const protectedSummary = "On. Visitors need the link and password to see your web page.";
	await expect(page.getByText(unprotectedSummary, { exact: true })).toBeVisible();

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
	await expect(page.getByText(protectedSummary, { exact: true })).toBeVisible();
	await expect(page.getByText(unprotectedSummary, { exact: true })).toHaveCount(0);

	const anonymous = await browser.newPage();
	try {
		// Anonymous visitors see the password form on the web page's own address first
		await anonymous.goto(publicUrl);
		await expect(anonymous.getByRole("heading", { name: "This resume is password-protected" })).toBeVisible();

		await anonymous.getByLabel("Password", { exact: true }).fill("wrong-password");
		await anonymous.getByRole("button", { name: "Unlock" }).click();
		await expect(
			anonymous.getByText("That password isn't correct. Check it with the resume owner and try again.", {
				exact: true,
			}),
		).toBeVisible();

		await anonymous.getByLabel("Password", { exact: true }).fill(password);
		await anonymous.getByRole("button", { name: "Unlock" }).click();

		// The correct password reveals the actual resume
		await expect(anonymous.getByRole("link", { name: "Download PDF" })).toBeVisible();
	} finally {
		await anonymous.close();
	}

	await requirePassword.click();
	await page
		.getByRole("alertdialog", { name: "Remove the password?" })
		.getByRole("button", { name: "Remove password" })
		.click();
	await expect(requirePassword).not.toBeChecked();
	await expect(page.getByText(unprotectedSummary, { exact: true })).toBeVisible();
	await expect(page.getByText(protectedSummary, { exact: true })).toHaveCount(0);

	const unprotected = await browser.newPage();
	try {
		await unprotected.goto(publicUrl);
		await expect(unprotected.getByRole("link", { name: "Download PDF" })).toBeVisible();
		await expect(unprotected.getByRole("heading", { name: "This resume is password-protected" })).toHaveCount(0);
	} finally {
		await unprotected.close();
	}
});
