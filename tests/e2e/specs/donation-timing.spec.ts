import { createSampleResumeFromDashboard, openDownloadDialog } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test("private setup never interrupts work with a timed donation request", async ({ authPage: page }) => {
	await page.clock.install();
	await page.goto("/dashboard/settings/ai");
	await expect(page.getByRole("heading", { name: "AI & developer", exact: true })).toBeVisible();
	await page.clock.runFor(1000);
	await page.clock.fastForward(6 * 60 * 1000);
	await page.clock.runFor(1000);
	await expect(page.getByText("Enjoying Reactive Resume?", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Maybe later", exact: true })).toHaveCount(0);
});

test("resume donation invitation follows the completed file download", async ({ authPage: page }, info) => {
	await createSampleResumeFromDashboard(page, info);
	const sheet = await openDownloadDialog(page);
	const donate = sheet.getByRole("link", { name: "Donate", exact: true });
	await expect(donate).toHaveCount(0);
	await sheet.getByRole("radio", { name: /JSON/ }).click();
	const pending = page.waitForEvent("download");
	await sheet.getByRole("button", { name: "Download JSON", exact: true }).click();
	const file = await pending;
	expect(await file.failure()).toBeNull();
	await expect(donate).toHaveAttribute("href", "https://opencollective.com/reactive-resume/donate");
	await sheet.getByRole("radio", { name: /Markdown/ }).click();
	await expect(donate).toHaveCount(0);
});

test("letter donation invitation follows the completed file download", async ({ authPage: page }) => {
	const created = await page.request.post("/api/openapi/cover-letters", {
		data: { name: "Fictional export letter", content: "<p>Thank you for considering my application.</p>" },
	});
	await expect(created).toBeOK();
	const { id } = await created.json();
	await page.goto(`/builder/letter/${id}`);
	const sheet = await openDownloadDialog(page);
	const donate = sheet.getByRole("link", { name: "Donate", exact: true });
	await expect(donate).toHaveCount(0);
	await sheet.getByRole("radio", { name: /JSON/ }).click();
	const pending = page.waitForEvent("download");
	await sheet.getByRole("button", { name: "Download JSON", exact: true }).click();
	const file = await pending;
	expect(await file.failure()).toBeNull();
	await expect(donate).toHaveAttribute("href", "https://opencollective.com/reactive-resume/donate");
});
