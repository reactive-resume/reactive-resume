import { readFile } from "node:fs/promises";
import { expect, test } from "../fixtures/test";

test("private application profile supports manual editing, unknowns, export and deletion on a narrow screen", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(90_000);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/dashboard/settings/account");
	const section = page
		.locator("section")
		.filter({ has: page.getByRole("heading", { name: "Private application profile", exact: true }) });
	await expect(section.getByText("Not reviewed yet", { exact: true })).toBeVisible();
	await section.getByLabel("Given name", { exact: true }).fill("Casey");
	await section.getByLabel("Family name", { exact: true }).fill("Example");
	await section.getByLabel("Application email", { exact: true }).fill("casey.application@example.test");
	await section.getByLabel("Address line 1", { exact: true }).fill("14 Example Street");
	await section.getByLabel("City", { exact: true }).fill("Berlin");
	await section.getByLabel("Address country", { exact: true }).selectOption("DE");
	await section.getByLabel("Add authorization country", { exact: true }).selectOption("DE");
	await expect(section.getByLabel("Authorized to work in Germany", { exact: true })).toHaveValue("unknown");
	await expect(section.getByLabel("Needs sponsorship in Germany", { exact: true })).toHaveValue("unknown");
	await expect(section.getByRole("button", { name: "Remove Germany", exact: true })).toBeVisible();
	await section.getByRole("button", { name: "Add link", exact: true }).click();
	await section.getByRole("button", { name: "Add link", exact: true }).click();
	await expect(section.getByLabel("Link 1 label", { exact: true })).toBeVisible();
	await expect(section.getByLabel("Link 2 URL", { exact: true })).toBeVisible();
	await section.getByRole("button", { name: "Remove link 2", exact: true }).click();
	await section.getByRole("button", { name: "Remove link 1", exact: true }).click();
	await section.getByRole("button", { name: "Add reference", exact: true }).click();
	await section.getByRole("button", { name: "Add reference", exact: true }).click();
	await expect(section.getByLabel("Reference 2: Reference name", { exact: true })).toBeVisible();
	await expect(section.getByLabel("Reference 2: Company", { exact: true })).toBeVisible();
	await section.getByRole("button", { name: "Remove reference 2", exact: true }).click();
	await section.getByLabel("Reference 1: Reference name", { exact: true }).fill("Jordan Example");
	await section.getByLabel("Reference 1: Relationship", { exact: true }).fill("Former manager");
	await section.getByLabel("Requested amount", { exact: true }).fill("95000");
	await section.getByRole("button", { name: "Save and mark reviewed", exact: true }).click();
	await expect(section.getByRole("alert")).toContainText("A salary amount needs currency and pay period.");
	await section.getByLabel("Currency", { exact: true }).selectOption("EUR");
	await section.getByLabel("Pay period", { exact: true }).selectOption("year");
	await section.getByRole("button", { name: "Save and mark reviewed", exact: true }).click();
	await expect(section.getByRole("status")).toHaveText("Saved and marked reviewed.");
	await page.reload();
	await expect(section.getByLabel("Application email", { exact: true })).toHaveValue("casey.application@example.test");
	await expect(section.getByLabel("Needs sponsorship in Germany", { exact: true })).toHaveValue("unknown");
	await section.getByLabel("Reference 1: Reference name", { exact: true }).fill("Morgan Example");
	await section.getByRole("button", { name: "Save and mark reviewed", exact: true }).click();
	await expect(section.getByRole("status")).toHaveText("Saved and marked reviewed.");
	const downloadPromise = page.waitForEvent("download");
	await section.getByRole("button", { name: "Export saved profile", exact: true }).click();
	const download = await downloadPromise;
	const path = await download.path();
	if (!path) throw new Error("Export download missing");
	const data = JSON.parse(await readFile(path, "utf8"));
	expect(data.data).toMatchObject({
		email: "casey.application@example.test",
		workAuthorization: [{ countryCode: "DE", authorized: "unknown", needsSponsorship: "unknown" }],
		references: [{ name: "Morgan Example" }],
		requestedSalary: { amount: 95000, currency: "EUR", period: "year" },
	});
	expect(data.reviewedAt).toBeTruthy();
	const backup = await page.request.get("/api/openapi/auth/account/export");
	await expect(backup).toBeOK();
	expect((await backup.json()).applicationProfile).toEqual(data);
	const elsewhere = await page.request.put("/api/openapi/application-profile", {
		data: { expectedRevision: data.revision, data: data.data },
	});
	await expect(elsewhere).toBeOK();
	await section.getByLabel("Given name", { exact: true }).fill("Unsaved correction");
	await section.getByRole("button", { name: "Save and mark reviewed", exact: true }).focus();
	await page.keyboard.press("Enter");
	await expect(section.getByRole("alert")).toContainText("Your draft is kept.");
	await expect(section.getByLabel("Given name", { exact: true })).toHaveValue("Unsaved correction");
	await section.getByRole("button", { name: "Reload and discard unsaved changes", exact: true }).click();
	await expect(section.getByLabel("Given name", { exact: true })).toHaveValue("Casey");
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.setViewportSize({ width: 1280, height: 1600 });
	await section.evaluate((element) => element.scrollIntoView({ block: "start" }));
	const box = await section.boundingBox();
	if (!box) throw new Error("Profile section missing");
	await page.screenshot({
		path: testInfo.outputPath("application-profile.png"),
		clip: { x: box.x, y: Math.max(0, box.y), width: box.width, height: Math.min(1240, 1600 - Math.max(0, box.y)) },
	});
	await section.getByRole("button", { name: "Delete profile", exact: true }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Delete profile", exact: true }).click();
	await expect(section.getByRole("status")).toHaveText("Application profile deleted.");
	await page.reload();
	await expect(section.getByLabel("Application email", { exact: true })).toHaveValue("");
});

test("public resume links and document exports never inherit private profile details", async ({
	authPage: page,
	account,
	browser,
	baseURL,
}) => {
	const saved = await page.request.put("/api/openapi/application-profile", {
		data: { expectedRevision: null, data: { email: "private-form-only@example.test", phone: "PRIVATE PROFILE PHONE" } },
	});
	await expect(saved).toBeOK();
	const created = await page.request.post("/api/openapi/resumes", {
		data: { name: "Fictional public resume", slug: "public-profile-test", tags: [], withSampleData: true },
	});
	await expect(created).toBeOK();
	const id = await created.json();
	await expect(await page.request.put(`/api/openapi/resumes/${id}`, { data: { isPublic: true } })).toBeOK();
	for (const format of ["json", "md"]) {
		const exported = await page.request.get(`/api/openapi/resumes/${id}/exports/${format}`);
		await expect(exported).toBeOK();
		expect(await exported.text()).not.toMatch(/private-form-only|PRIVATE PROFILE PHONE|applicationProfile/);
	}
	if (!baseURL) throw new Error("Test server URL missing");
	const visitor = await browser.newContext({ baseURL });
	try {
		const response = await visitor.request.get(`/api/openapi/resumes/${account.username}/public-profile-test`);
		await expect(response).toBeOK();
		expect(await response.text()).not.toMatch(/private-form-only|PRIVATE PROFILE PHONE|applicationProfile/);
		const privateRead = await visitor.request.get("/api/openapi/application-profile");
		expect(privateRead.status()).toBe(401);
	} finally {
		await visitor.close();
	}
});
