import type { Page, TestInfo } from "@playwright/test";
import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

const updateUrl = "**/api/rpc/resume/update";
function waitSave(page: Page) {
	return page.waitForResponse(
		(response) => new URL(response.url()).pathname === "/api/rpc/resume/update" && response.ok(),
	);
}
async function clickDashboardWithoutNavigationWait(page: Page) {
	const dashboardLink = page.getByRole("link", { name: "Back to documents", exact: true });
	const box = await dashboardLink.boundingBox();
	if (!box) throw new Error("Dashboard navigation button is not visible.");
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function prepareNavigationTest(page: Page, testInfo: TestInfo) {
	await createSampleResumeFromDashboard(page, testInfo);
	await page.reload();
	const warmup = waitSave(page);
	await page.getByLabel("Headline", { exact: true }).fill("Navigation fixture ready");
	await warmup;
	return page.url();
}

test("retains the current draft when saving during navigation fails", async ({ authPage: page }, testInfo) => {
	const url = await prepareNavigationTest(page, testInfo);
	let attempts = 0;
	await page.route(updateUrl, async (route) => {
		attempts++;
		await route.abort("failed");
	});
	await page.getByRole("textbox", { name: "Full name", exact: true }).fill("Keep unsaved draft");
	await expect(page.getByRole("alert").filter({ hasText: "Not saved" })).toBeVisible();
	await clickDashboardWithoutNavigationWait(page);
	await expect.poll(() => attempts).toBe(2);
	await expect(page.getByRole("alert").filter({ hasText: "Not saved" })).toBeVisible();
	expect(page.url()).toBe(url);
	await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toHaveValue("Keep unsaved draft");
	await page.unroute(updateUrl);
	await clickDashboardWithoutNavigationWait(page);
	await page.waitForURL(/\/dashboard/);
	await page.goto(url);
	await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toHaveValue("Keep unsaved draft");
});
