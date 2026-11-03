import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";

async function openDraft(page: Page) {
	await page.goto("/dashboard/career");
	await page
		.getByRole("region", { name: "Schedules", exact: true })
		.getByRole("button", { name: "Add", exact: true })
		.click();
	const sheet = page.getByRole("dialog", { name: "New schedule", exact: true });
	await expect(sheet.getByText(/Finding roles needs a working web search service/)).toBeVisible();
	await sheet.getByLabel("Look for", { exact: true }).fill("Platform engineer · Northwind Labs · Berlin");
	await sheet.getByRole("radio", { name: "Every 3 days", exact: true }).click();
	await sheet.getByLabel("First run", { exact: true }).fill("2030-12-21");
	await sheet.getByLabel("Time · UTC", { exact: true }).fill("09:35");
	return sheet;
}

for (const viewport of [
	{ width: 1280, height: 1440 },
	{ width: 390, height: 844 },
])
	test(`discovery footer setup returns to the complete draft after cancelling at ${viewport.width}px`, async ({
		authPage: page,
	}, info) => {
		await page.setViewportSize(viewport);
		const sheet = await openDraft(page);
		const location = page.url();
		const setupTrigger = sheet.getByRole("button", { name: "Set up web access", exact: true }).last();
		await setupTrigger.click();
		await expect(page).toHaveURL(location);
		const setup = page.getByRole("dialog", { name: "Web access", exact: true });
		await expect(setup).toBeVisible();
		await setup.getByRole("button", { name: "Close", exact: true }).click();
		await expect(setupTrigger).toBeFocused();
		await expect(sheet.getByLabel("Look for", { exact: true })).toHaveValue(
			"Platform engineer · Northwind Labs · Berlin",
		);
		await expect(sheet.getByRole("radio", { name: "Every 3 days", exact: true })).toBeChecked();
		await expect(sheet.getByLabel("First run", { exact: true })).toHaveValue("2030-12-21");
		await expect(sheet.getByLabel("Time · UTC", { exact: true })).toHaveValue("09:35");
		await sheet.screenshot({ path: info.outputPath("discovery-schedule.jpg"), animations: "disabled", quality: 90 });
	});

test("in-place web setup keeps discovery fields and saves only the reviewed schedule", async ({ authPage: page }) => {
	const sheet = await openDraft(page);
	await sheet.getByRole("button", { name: "Set up web access", exact: true }).last().click();
	const setup = page.getByRole("dialog", { name: "Web access", exact: true });
	await setup.getByRole("button", { name: "Connect a service", exact: true }).click();
	await setup.getByLabel("API key", { exact: true }).fill("fictional-rx202-key-not-valid");
	await setup.getByRole("button", { name: "Save connection", exact: true }).click();
	await expect(setup).toBeHidden();
	await expect(sheet.getByLabel("Look for", { exact: true })).toHaveValue(
		"Platform engineer · Northwind Labs · Berlin",
	);
	await expect(sheet.getByRole("radio", { name: "Every 3 days", exact: true })).toBeChecked();
	await expect(sheet.getByLabel("First run", { exact: true })).toHaveValue("2030-12-21");
	await expect(sheet.getByLabel("Time · UTC", { exact: true })).toHaveValue("09:35");
	const saved = page.waitForResponse((response) => response.url().includes("/career/saveSchedule"));
	await sheet.getByRole("button", { name: "Save schedule", exact: true }).click();
	await page
		.getByRole("alertdialog", { name: "Use web access?", exact: true })
		.getByRole("button", { name: "Allow scheduled sharing", exact: true })
		.click();
	expect((await saved).ok()).toBe(true);
	await expect(sheet).toBeHidden();
	const response = await page.request.get("/api/openapi/career/schedules");
	await expect(response).toBeOK();
	expect(await response.json()).toEqual([
		expect.objectContaining({
			kind: "discovery",
			query: "Platform engineer · Northwind Labs · Berlin",
			intervalDays: 3,
			nextRunAt: "2030-12-21T09:35:00.000Z",
			timezone: "UTC",
		}),
	]);
	await page.reload();
	await expect(page.getByRole("region", { name: "Schedules", exact: true })).toContainText(
		"Platform engineer · Northwind Labs · Berlin",
	);
});
