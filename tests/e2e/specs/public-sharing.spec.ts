import { readFile } from "node:fs/promises";
import { createSampleResumeFromDashboard, makeResumePublic, openSidebarSection } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test("counts a visitor's PDF download without counting the preview", async ({ browser, authPage: page }, testInfo) => {
	test.setTimeout(60_000);
	await createSampleResumeFromDashboard(page, testInfo);
	const resumeId = new URL(page.url()).pathname.split("/")[2];
	const statisticsUrl = `/api/openapi/resumes/${resumeId}/statistics`;
	const readStatistics = async () => {
		const response = await page.request.get(statisticsUrl);
		expect(response.ok()).toBe(true);
		return response.json();
	};
	const publicUrl = await makeResumePublic(page);

	const anonymous = await browser.newPage();
	try {
		await anonymous.goto(publicUrl);
		await expect(anonymous.getByRole("link", { name: "Download PDF" })).toBeVisible();
		await expect.poll(readStatistics).toMatchObject({ views: 1, downloads: 0, lastDownloadedAt: null });

		const downloaded = anonymous.waitForEvent("download");
		await anonymous.getByRole("link", { name: "Download PDF" }).click();
		const download = await downloaded;
		expect(await download.failure()).toBeNull();
		const downloadPath = await download.path();
		if (!downloadPath) throw new Error("The browser did not save the PDF");
		expect((await readFile(downloadPath)).subarray(0, 5).toString()).toBe("%PDF-");
		await expect.poll(readStatistics).toMatchObject({ views: 1, downloads: 1, lastDownloadedAt: expect.any(String) });
		// Two UTC days, summed: a visit that straddles midnight still adds up.
		const daily = await page.request.get(`${statisticsUrl}/daily?days=2`);
		expect(daily.ok()).toBe(true);
		const days = (await daily.json()) as { views: number; downloads: number }[];
		expect(days.reduce((sum, day) => sum + day.views, 0)).toBe(1);
		expect(days.reduce((sum, day) => sum + day.downloads, 0)).toBe(1);
	} finally {
		await anonymous.close();
	}
});

test("publishing the first resume enables a working short link", async ({ browser, authPage: page }, testInfo) => {
	await createSampleResumeFromDashboard(page, testInfo);
	await openSidebarSection(page, "Sharing");
	const addresses = page.getByRole("region", { name: "Short link and domain" });
	const copy = addresses.getByRole("button", { name: "Copy", exact: true });
	await expect(copy).toBeDisabled();
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByRole("switch", { name: "Primary resume", exact: true })).toBeChecked();
	await expect(copy).toBeEnabled();
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await copy.click();
	const shortUrl = await page.evaluate(() => navigator.clipboard.readText());
	expect(new URL(shortUrl).pathname).toMatch(/^\/e2e_[^/]+\/?$/);
	const visitor = await browser.newPage();
	try {
		expect((await visitor.goto(shortUrl))?.status()).toBe(200);
		await expect(visitor.getByRole("link", { name: "Download PDF" })).toBeVisible();
	} finally {
		await visitor.close();
	}
});
