import { expect, test } from "../fixtures/test";

test.use({ reducedMotion: "reduce" });

for (const path of ["/resume-templates", "/ats-checker"]) {
	for (const { width, locale, theme } of [
		{ width: 320, locale: "en-US", theme: "light" },
		{ width: 390, locale: "ar-SA", theme: "dark" },
		{ width: 390, locale: "de-DE", theme: "light" },
		{ width: 1440, locale: "en-US", theme: "light" },
	] as const) {
		test(`${path} keeps marketing navigation at ${width}px in ${locale} ${theme}`, async ({ page }, info) => {
			await page.setViewportSize({ width, height: 900 });
			await page.emulateMedia({ colorScheme: theme });
			await page.goto(`${path}?locale=${locale}`);
			await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
			const header = page.getByRole("banner");
			const signIn = header.locator('a[href="/auth/login"]');
			const start = header.locator('a[href="/auth/register"]');
			await expect(signIn).toBeVisible();
			await expect(start).toBeVisible();
			await expect(header.locator("nav")).toHaveCount(0);
			await expect(header.locator('a[href="/"]')).toHaveAccessibleName("Reactive Resume");
			const boxes = await header.locator("a, button").evaluateAll((links) =>
				links
					.filter((link) => link.getBoundingClientRect().width > 0)
					.map((link) => {
						const { x, right, top, bottom } = link.getBoundingClientRect();
						return { x, right, top, bottom, text: link.textContent };
					}),
			);
			for (const box of boxes) {
				expect(box.x, box.text ?? "header link").toBeGreaterThanOrEqual(0);
				expect(box.right, box.text ?? "header link").toBeLessThanOrEqual(width);
				expect(box.top).toBeGreaterThanOrEqual(0);
				expect(box.bottom).toBeLessThanOrEqual(64);
			}
			for (const [index, box] of boxes.entries()) {
				const previous = boxes[index - 1];
				if (previous) expect(Math.min(previous.right, box.right) - Math.max(previous.x, box.x)).toBeLessThanOrEqual(0);
			}
			for (const link of [signIn, start]) {
				expect((await link.innerText()).trim()).not.toBe("");
				const box = await link.boundingBox();
				expect(box?.width).toBeGreaterThanOrEqual(44);
				expect(box?.height).toBeGreaterThanOrEqual(44);
			}
			await page.screenshot({ path: info.outputPath("marketing-header.png"), animations: "disabled" });
			const footer = page.getByRole("contentinfo");
			await footer.scrollIntoViewIfNeeded();
			await expect(footer.getByRole("navigation")).toHaveCount(4);
			await expect(footer.locator('a[href="https://rxresu.me/#write"]')).toBeVisible();
			await expect(footer.locator("button[title]")).toBeVisible();
			await expect(footer.locator("button[title]")).toHaveAccessibleName(/\S+/);
			await expect(footer.locator('img[src*="footer-desk"]')).toHaveCount(0);
			await expect(header).toBeInViewport();
			await expect(signIn).toBeInViewport();
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
			await footer.screenshot({ path: info.outputPath("marketing-footer.png"), animations: "disabled" });
		});
	}

	test(`${path} uses the signed-in account while first-response HTML stays anonymous`, async ({ authPage: page }) => {
		const response = await page.request.get(path);
		await expect(response).toBeOK();
		const html = await response.text();
		expect(html).toContain('href="/auth/login"');
		expect(html).toContain('href="/auth/register"');
		expect(html).toContain("<footer");
		expect(html).toContain('href="https://rxresu.me/#write"');
		expect(html).not.toContain('href="/dashboard"');
		await page.goto(path);
		await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
		const header = page.getByRole("banner");
		await expect(header.locator('a[href="/auth/login"]')).toHaveCount(0);
		await header.getByRole("link", { name: "Go to dashboard", exact: true }).click();
		await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
	});
}

test("marketing theme and language persist while footer links name their destinations", async ({ page }) => {
	await page.goto("/ats-checker");
	await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
	await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.reload();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await expect(page.getByRole("contentinfo").getByRole("link", { name: "Features", exact: true })).toHaveAttribute(
		"href",
		"https://rxresu.me/#write",
	);
	await page.goto("/resume-templates?locale=de-DE");
	await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
	await page.getByRole("banner").locator("button[title]").click();
	await page.getByRole("option", { name: /American English/ }).click();
	await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
	expect(new URL(page.url()).pathname).toBe("/resume-templates");
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
});

test("marketing account actions remain keyboard destinations on phones", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto("/resume-templates");
	await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
	const signIn = page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true });
	await signIn.focus();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/auth\/login/);
	await page.goto("/ats-checker");
	await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
	const start = page.getByRole("banner").getByRole("link", { name: "Build your resume", exact: true });
	await start.focus();
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/auth\/register/);
});

test("shared chrome keeps the gallery's paper, type, samples and template choice", async ({ page }) => {
	await page.goto("/resume-templates");
	await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
	const cards = page.locator("article");
	await expect(cards).toHaveCount(18);
	const first = cards.first();
	await expect(first.locator("h2")).toHaveCSS("font-weight", "300");
	// The existing font-anybody token now uses the shared display family on every marketing page.
	expect(await first.locator("h2").evaluate((element) => getComputedStyle(element).fontFamily)).toContain(
		"Instrument Serif",
	);
	const paper = first.getByRole("img");
	await expect(paper).toHaveJSProperty("complete", true);
	expect(await paper.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0);
	expect(await paper.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
	const sample = first.getByRole("link", { name: /Download .* sample PDF/ });
	const href = await sample.getAttribute("href");
	if (!href) throw new Error("Template sample has no destination.");
	const response = await page.request.get(href);
	await expect(response).toBeOK();
	expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
	await first.getByRole("link", { name: /Use the .* template/ }).click();
	await expect(page).toHaveURL(/\/auth\/register\?callbackURL=/);
});

test("shared chrome keeps the ATS sample check local and its result usable", async ({ page }) => {
	await page.goto("/ats-checker");
	await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
	const writes: string[] = [];
	page.on("request", (request) => {
		if (["POST", "PUT", "PATCH"].includes(request.method())) writes.push(new URL(request.url()).pathname);
	});
	await page.getByRole("button", { name: "Try a sample file", exact: true }).click();
	await expect(page.getByRole("button", { name: "Check another file", exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "What a parser reads", exact: true }).click();
	await expect(page.getByRole("contentinfo")).toBeAttached();
	await page.getByRole("button", { name: "Check another file", exact: true }).click();
	await expect(page.getByRole("button", { name: "Choose a PDF", exact: true })).toBeVisible();
	expect(writes).toEqual([]);
});

test("marketing navigation leaves the homepage's night scene behind", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
	await page
		.getByRole("navigation", { name: "Story", exact: true })
		.getByRole("button", { name: "Share", exact: true })
		.click();
	const mark = page
		.getByRole("banner")
		.getByRole("link", { name: "Reactive Resume", exact: true })
		.locator("img:visible");
	await expect(mark).toHaveAttribute("src", "/icon/dark.svg");
	// Activate the real router link while Share still owns the homepage's night state.
	await page
		.locator('a[href="/ats-checker"]')
		.first()
		.evaluate((link: HTMLAnchorElement) => link.click());
	await expect(page).toHaveURL(/\/ats-checker$/);
	await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
	await expect(mark).toHaveAttribute("src", "/icon/light.svg");
});

test("a public resume keeps its own page without marketing chrome", async ({ authPage: owner, browser, account }) => {
	const created = await owner.request.post("/api/openapi/resumes", {
		data: { name: "Fictional marketing boundary", tags: [], withSampleData: true },
	});
	await expect(created).toBeOK();
	const id = (await created.json()) as string;
	await expect(
		await owner.request.put(`/api/openapi/resumes/${id}`, {
			data: { slug: "fictional-marketing-boundary", isPublic: true },
		}),
	).toBeOK();
	const visitor = await browser.newPage();
	try {
		const origin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
		await visitor.goto(`${origin}/${account.username}/fictional-marketing-boundary`);
		await expect(visitor.locator(".rr-page").first()).toBeVisible();
		await expect(visitor.locator(".landing")).toHaveCount(0);
		await expect(visitor.locator('a[href="/auth/register"]')).toHaveCount(0);
	} finally {
		await visitor.close();
	}
});
