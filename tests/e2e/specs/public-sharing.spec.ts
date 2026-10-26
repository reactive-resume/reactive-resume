import { readFile } from "node:fs/promises";
import { createSampleResumeFromDashboard, makeResumePublic } from "../fixtures/resume";
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
