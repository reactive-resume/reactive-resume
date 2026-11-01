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

test("a non-primary resume can copy the short link another published primary serves", async ({
	authPage: page,
}, testInfo) => {
	const primaryName = await createSampleResumeFromDashboard(page, testInfo);
	await openSidebarSection(page, "Sharing");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByRole("switch", { name: "Primary resume", exact: true })).toBeChecked();

	const created = await page.request.post("/api/openapi/resumes", {
		data: { name: "Second private resume", tags: [] },
	});
	expect(created.ok()).toBe(true);
	const secondId = (await created.json()) as string;
	await page.goto(`/builder/${secondId}`);
	await openSidebarSection(page, "Sharing");

	const addresses = page.getByRole("region", { name: "Short link and domain" });
	await expect(addresses.getByRole("button", { name: "Copy", exact: true })).toBeEnabled();
	await expect(addresses).toContainText(`open “${primaryName}”`);
});

test("a failed primary lookup stops Copy for a cached primary that is no longer published", async ({
	authPage: page,
	account,
}, testInfo) => {
	test.setTimeout(150_000);
	const primaryName = await createSampleResumeFromDashboard(page, testInfo);
	await openSidebarSection(page, "Sharing");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByRole("switch", { name: "Primary resume", exact: true })).toBeChecked();

	const list = (await (await page.request.get("/api/openapi/resumes")).json()) as
		| { id: string; name: string }[]
		| { items: { id: string; name: string }[] };
	const primaryId = (Array.isArray(list) ? list : list.items).find((resume) => resume.name === primaryName)?.id;
	if (!primaryId) throw new Error("The published resume is missing from the list.");

	const secondName = "Second private resume";
	const created = await page.request.post("/api/openapi/resumes", { data: { name: secondName, tags: [] } });
	expect(created.ok()).toBe(true);
	const secondId = (await created.json()) as string;
	await page.goto(`/builder/${secondId}`);
	await openSidebarSection(page, "Sharing");
	const addresses = page.getByRole("region", { name: "Short link and domain" });
	const copy = addresses.getByRole("button", { name: "Copy", exact: true });
	await expect(copy).toBeEnabled();
	await expect(addresses).toContainText(`open “${primaryName}”`);

	// The primary is unpublished outside this page. The cached row still says it is public until the list is read again.
	expect((await page.request.put(`/api/openapi/resumes/${primaryId}`, { data: { isPublic: false } })).ok()).toBe(true);
	// Let the cached list go stale, then make its read fail. Remounting Share asks for it again (refetchOnMount).
	await page.waitForTimeout(62_000);
	await page.route("**/*", (route) =>
		route.request().url().includes("/api/rpc/resume/list") ? route.abort("failed") : route.continue(),
	);
	await page.getByRole("link", { name: "Back to documents", exact: true }).click();
	await page.getByRole("link", { name: secondName, exact: true }).click();
	await openSidebarSection(page, "Sharing");

	await expect(addresses.getByText(/Couldn't check which resume opens your short link/)).toBeVisible();
	await expect(copy).toBeDisabled();
	// The cached target really is dead: this is the 404 Copy must never copy.
	expect((await page.request.get(`/${account.username}`)).status()).toBe(404);

	// A successful retry returns to the truthful no-primary state, still without a dead Copy.
	await page.unroute("**/*");
	await page.getByRole("link", { name: "Back to documents", exact: true }).click();
	await page.getByRole("link", { name: secondName, exact: true }).click();
	await openSidebarSection(page, "Sharing");
	await expect(addresses.getByText(/Couldn't check which resume opens your short link/)).toBeHidden();
	await expect(addresses.getByRole("button", { name: "Copy", exact: true })).toBeDisabled();
});
