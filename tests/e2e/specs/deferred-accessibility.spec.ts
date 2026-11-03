import { expect, test } from "../fixtures/test";

test("new application focuses its title and returns to its surviving row", async ({ authPage: page }) => {
	await page.goto("/dashboard/applications");
	await page.getByRole("button", { name: "Save job", exact: true }).first().click();
	const form = page.getByRole("dialog", { name: "Save a job", exact: true });
	await form.getByRole("textbox", { name: "Role", exact: true }).fill("Accessibility Engineer");
	await form.getByRole("textbox", { name: "Company", exact: true }).fill("Lumen Workshop");
	await form.getByRole("button", { name: "Save job", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "Accessibility Engineer", exact: true });
	await expect(sheet.getByRole("heading", { name: "Accessibility Engineer", exact: true })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect(page.locator("[data-application-open]").filter({ hasText: "Accessibility Engineer" })).toBeFocused();
});

test("short landscape application header scrolls away while footer stays reachable", async ({
	authPage: page,
}, info) => {
	const created = await page.request.post("/api/openapi/applications", {
		data: {
			role: "Accessibility Engineer",
			company: "Lumen Workshop",
			jobDescription: "Fictional posting for layout verification.",
		},
	});
	await expect(created).toBeOK();
	await page.setViewportSize({ width: 844, height: 390 });
	await page.goto("/dashboard/applications");
	await page.locator("[data-application-open]").filter({ hasText: "Accessibility Engineer" }).click();
	const sheet = page.getByRole("dialog", { name: "Accessibility Engineer", exact: true });
	await expect(sheet).toBeVisible();
	const header = sheet.locator("header");
	await expect(header).toHaveCSS("position", "static");
	await header.evaluate((element) => element.parentElement?.scrollTo({ top: 250 }));
	await expect.poll(async () => (await header.boundingBox())?.y ?? Infinity).toBeLessThan(0);
	await expect(sheet.getByRole("button", { name: "Mark as closed…", exact: true })).toBeInViewport();
	await page.screenshot({ animations: "disabled", path: info.outputPath("application-landscape.png") });
});

test("tablet mode icons leave space for the document title", async ({ authPage: page }, info) => {
	const created = await page.request.post("/api/openapi/resumes", { data: { name: "Untitled resume", tags: [] } });
	await expect(created).toBeOK();
	const id = await created.json();
	for (const width of [640, 717, 820, 1023]) {
		await page.setViewportSize({ width, height: 1024 });
		await page.goto(`/builder/${id}`);
		const title = page.getByRole("button", { name: "Document menu: Untitled resume", exact: true });
		await expect(title).toBeVisible();
		const label = title.locator(".truncate");
		await expect.poll(() => label.evaluate((element) => element.clientWidth >= element.scrollWidth)).toBe(true);
		await expect(page.getByRole("tab", { name: /^Write/ })).toHaveAccessibleName(/Write/);
	}
	await page.setViewportSize({ width: 717, height: 1024 });
	await page.screenshot({ animations: "disabled", path: info.outputPath("tablet-title.png") });
});

for (const width of [1440, 390]) {
	test(`formatting toolbar preserves selected text with arrow navigation at ${width}px`, async ({ authPage: page }) => {
		const created = await page.request.post("/api/openapi/resumes", {
			data: { name: "Fictional formatting example", tags: [], withSampleData: true },
		});
		await expect(created).toBeOK();
		const id = await created.json();
		await expect(
			await page.request.patch(`/api/openapi/resumes/${id}`, {
				data: { operations: [{ op: "replace", path: "/summary/content", value: "<p>Alpha Beta Gamma</p>" }] },
			}),
		).toBeOK();
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`/builder/${id}`);
		await page.getByRole("button", { name: "Summary", exact: true }).click();
		const editor = page.getByRole("textbox", { name: "Summary", exact: true });
		await expect(editor).toHaveText("Alpha Beta Gamma");
		await editor.focus();
		await editor.press("ControlOrMeta+A");
		await page.keyboard.press("ArrowLeft");
		for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
		for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
		await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe("Beta");
		const toolbar = page.getByRole("toolbar", { name: "Formatting" });
		if (width === 1440) await page.keyboard.press("Tab");
		else await toolbar.getByRole("button", { name: "Bold", exact: true }).focus();
		await expect(toolbar.getByRole("button", { name: "Bold", exact: true })).toBeFocused();
		await page.keyboard.press("ArrowRight");
		await expect(toolbar.getByRole("button", { name: "Italic", exact: true })).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(editor.locator("em")).toHaveText("Beta");
		await expect(editor).toHaveText("Alpha Beta Gamma");
		await expect(editor).toBeFocused();
		await toolbar.getByRole("button", { name: "Text alignment", exact: true }).focus();
		await page.keyboard.press("ArrowDown");
		await page.getByRole("menuitemradio", { name: "Align center", exact: true }).click();
		await expect(editor.locator("p")).toHaveCSS("text-align", "center");
		await expect(editor.locator("em")).toHaveText("Beta");
		await expect(editor).toBeFocused();
	});
}

test("phone hero keeps decorative Latin punctuation isolated in Arabic", async ({ page }, info) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/?locale=ar-SA");
	const fragment = page.locator(".hero-fragment").filter({ hasText: "Parcel & Co." });
	await expect(fragment).toHaveAttribute("dir", "auto");
	await expect(fragment).toHaveCSS("direction", "ltr");
	await expect(fragment).toHaveCSS("unicode-bidi", "isolate");
	expect(await fragment.evaluate((element) => !!element.closest('[aria-hidden="true"]'))).toBe(true);
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
	await page.screenshot({ animations: "disabled", path: info.outputPath("phone-hero-arabic.png") });
});

test("deleting a URL-open application returns to the heading when no row survives", async ({ authPage: page }) => {
	const created = await page.request.post("/api/openapi/applications", {
		data: { role: "Accessibility Engineer", company: "Lumen Workshop" },
	});
	await expect(created).toBeOK();
	await page.goto(`/dashboard/applications?applicationId=${await created.json()}`);
	const sheet = page.getByRole("dialog", { name: "Accessibility Engineer", exact: true });
	await expect(sheet.getByRole("heading", { name: "Accessibility Engineer", exact: true })).toBeFocused();
	await sheet.getByRole("button", { name: "Application options", exact: true }).click();
	await page.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
	await page.getByRole("alertdialog").getByRole("button", { name: "Move to Trash", exact: true }).click();
	await expect(sheet).toBeHidden();
	await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeFocused();
});
