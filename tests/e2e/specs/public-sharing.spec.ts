import { readFile } from "node:fs/promises";
import { createSampleResumeFromDashboard, makeResumePublic, openSidebarSection } from "../fixtures/resume";
import { failRpcProcedure } from "../fixtures/rpc-failure";
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
	expect((await page.request.get(`/${account.username}`)).status()).toBe(404);
	// Let the cached list go stale, then make its read fail. Remounting Share asks for it again (refetchOnMount).
	await page.clock.install();
	await page.clock.fastForward(62_000);
	let failedLists = 0;
	await page.route("**/api/rpc/**", async (route) => {
		if (await failRpcProcedure(route, "/api/rpc/resume/list", "Primary lookup unavailable")) failedLists++;
	});
	await page.getByRole("link", { name: "Back to documents", exact: true }).click();
	await page.getByRole("link", { name: secondName, exact: true }).click();
	await openSidebarSection(page, "Sharing");

	await expect.poll(() => failedLists).toBeGreaterThan(0);
	await expect(addresses.getByText(/Couldn't check which resume opens your short link/)).toBeVisible();
	await expect(copy).toBeDisabled();
	// The cached target really is dead: this is the 404 Copy must never copy.
	expect((await page.request.get(`/${account.username}`)).status()).toBe(404);

	// A successful retry returns to the truthful no-primary state, still without a dead Copy.
	await page.unroute("**/api/rpc/**");
	await page.getByRole("link", { name: "Back to documents", exact: true }).click();
	await page.getByRole("link", { name: secondName, exact: true }).click();
	await openSidebarSection(page, "Sharing");
	await expect(addresses.getByText(/Couldn't check which resume opens your short link/)).toBeHidden();
	await expect(addresses.getByRole("button", { name: "Copy", exact: true })).toBeDisabled();
});

test("a primary in Trash keeps the short link closed until Primary is switched on", async ({
	authPage: page,
	account,
}, testInfo) => {
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

	// Trash the published primary; it keeps the role but disappears from the list.
	expect(
		(await page.request.post("/api/openapi/documents/trash", { data: { type: "resume", id: primaryId } })).ok(),
	).toBe(true);
	await page.reload();
	await openSidebarSection(page, "Sharing");

	await expect(addresses).toContainText("Publish this resume to open it at your short link and custom domain.");
	await expect(addresses).toContainText("If another resume holds Primary, turn it on for this one instead.");
	await expect(copy).toBeDisabled();
	expect((await page.request.get(`/${account.username}`)).status()).toBe(404);

	// Publishing alone does not claim the role while the trashed primary keeps it.
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(copy).toBeDisabled();
	expect((await page.request.get(`/${account.username}`)).status()).toBe(404);

	// Explicit Primary takes the role and opens the link.
	await page.getByRole("switch", { name: "Primary resume", exact: true }).click();
	await expect(copy).toBeEnabled();
	await expect.poll(async () => (await page.request.get(`/${account.username}`)).status()).toBe(200);
});

test("wraps the Pikachu web page's contact line on a phone", async ({ browser, authPage: page }, testInfo) => {
	test.setTimeout(60_000);
	await createSampleResumeFromDashboard(page, testInfo);
	const resumeId = new URL(page.url()).pathname.split("/")[2];
	// Pikachu draws its header inside a row; a long location pushes the contact line past a phone's width.
	const patched = await page.request.patch(`/api/openapi/resumes/${resumeId}`, {
		data: {
			operations: [
				{ op: "replace", path: "/metadata/template", value: "pikachu" },
				{ op: "replace", path: "/basics/location", value: "Berlin-Charlottenburg, Deutschland" },
			],
		},
	});
	await expect(patched).toBeOK();
	await page.reload();
	const publicUrl = await makeResumePublic(page);

	const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
	try {
		await phone.goto(publicUrl);
		const contacts = phone.locator("[data-region=header] a");
		await expect(contacts.first()).toBeVisible();
		expect(await contacts.count()).toBeGreaterThan(2);
		for (const contact of await contacts.all()) {
			const box = await contact.boundingBox();
			expect(box && box.x + box.width).toBeLessThanOrEqual(390);
		}
		expect(await phone.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	} finally {
		await phone.close();
	}
});
