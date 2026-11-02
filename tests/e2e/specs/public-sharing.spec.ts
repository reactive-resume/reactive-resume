import { readFile } from "node:fs/promises";
import { createSampleResumeFromDashboard, makeResumePublic, openSidebarSection } from "../fixtures/resume";
import { failRpcProcedure } from "../fixtures/rpc-failure";
import { expect, test } from "../fixtures/test";

for (const { locale, name, rtl } of [
	{ locale: "en-US", name: "Jane Doe", rtl: false },
	{ locale: "ar-SA", name: "مريم أحمد", rtl: true },
	{ locale: "he-IL", name: "נועה כהן", rtl: true },
]) {
	test(`keeps the ${locale} public page's picture, name and bullets on their reading side`, async ({
		browser,
		authPage: page,
	}, testInfo) => {
		await createSampleResumeFromDashboard(page, testInfo);
		const resumeId = new URL(page.url()).pathname.split("/")[2];
		await expect(
			await page.request.patch(`/api/openapi/resumes/${resumeId}`, {
				data: {
					operations: [
						{ op: "replace", path: "/metadata/template", value: "onyx" },
						{ op: "replace", path: "/metadata/page/locale", value: locale },
						{ op: "replace", path: "/basics/name", value: name },
					],
				},
			}),
		).toBeOK();
		await page.reload();
		const publicUrl = await makeResumePublic(page);
		const visitor = await browser.newPage();
		try {
			await visitor.goto(publicUrl);
			await expect(visitor.locator("html")).toHaveAttribute("dir", rtl ? "rtl" : "ltr");
			for (const width of [1280, 390]) {
				await visitor.setViewportSize({ width, height: 900 });
				const heading = visitor.getByRole("heading", { level: 1, name });
				await expect(heading).toBeVisible();
				const picture = visitor.locator("[data-region=header] img");
				await expect(picture).toBeVisible();
				const [photo, header] = await Promise.all([
					picture.boundingBox(),
					visitor.locator("[data-region=header]").boundingBox(),
				]);
				if (!photo || !header) throw new Error("The public header is missing.");
				const photoInset = rtl ? header.x + header.width - photo.x - photo.width : photo.x - header.x;
				expect(photoInset).toBeLessThan(2);
				await expect(heading).toHaveCSS("direction", rtl ? "rtl" : "ltr");
				await expect(heading).toHaveCSS("text-align", rtl ? "right" : "left");

				const bullet = visitor.getByText("•", { exact: true }).first();
				const geometry = await bullet.evaluate((marker) => {
					const row = marker.parentElement;
					if (!row) throw new Error("The bullet has no row.");
					const content = [...row.children].find((child) => child !== marker);
					if (!content) throw new Error("The bullet has no content.");
					const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
					const text = walker.nextNode();
					if (!text) throw new Error("The bullet content has no text.");
					const range = document.createRange();
					range.selectNodeContents(text);
					const firstLine = range.getClientRects()[0];
					if (!firstLine) throw new Error("The bullet text has no line.");
					return {
						marker: marker.getBoundingClientRect().toJSON(),
						row: row.getBoundingClientRect().toJSON(),
						text: firstLine.toJSON(),
					};
				});
				const markerInset = rtl ? geometry.row.right - geometry.marker.right : geometry.marker.left - geometry.row.left;
				const textGap = rtl ? geometry.marker.left - geometry.text.right : geometry.text.left - geometry.marker.right;
				expect(markerInset).toBeLessThan(2);
				expect(textGap).toBeGreaterThanOrEqual(-1);
				expect(textGap).toBeLessThan(24);
				expect(await visitor.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
			}

			// Column placement is independent of text direction, including an explicit choice in Design.
			for (const side of [null, "left", "right"]) {
				await expect(
					await page.request.patch(`/api/openapi/resumes/${resumeId}`, {
						data: {
							operations: [
								{ op: "replace", path: "/metadata/template", value: "gengar" },
								...(side ? [{ op: "add", path: "/metadata/layout/sidebarSide", value: side }] : []),
							],
						},
					}),
				).toBeOK();
				await visitor.setViewportSize({ width: 1280, height: 900 });
				await visitor.reload();
				const sidebar = visitor.locator("[data-region=sidebar]");
				const main = visitor.locator("[data-region=main]");
				await expect(sidebar).toBeVisible();
				const [sidebarBox, mainBox] = await Promise.all([sidebar.boundingBox(), main.boundingBox()]);
				if (!sidebarBox || !mainBox) throw new Error("The public columns are missing.");
				expect(sidebarBox.x < mainBox.x).toBe((side ?? (rtl ? "right" : "left")) === "left");
				await visitor.setViewportSize({ width: 390, height: 900 });
				const [foldedSidebar, foldedMain] = await Promise.all([sidebar.boundingBox(), main.boundingBox()]);
				if (!foldedSidebar || !foldedMain) throw new Error("The folded public columns are missing.");
				expect(foldedSidebar.y).toBeGreaterThanOrEqual(foldedMain.y + foldedMain.height);
				expect(await visitor.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
			}
		} finally {
			await visitor.close();
		}
	});
}

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
