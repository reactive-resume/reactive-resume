import { expect, test } from "../fixtures/test";

test.use({ reducedMotion: "reduce" });

for (const { width, locale } of [
	{ width: 320, locale: "en-US" },
	{ width: 390, locale: "de-DE" },
	{ width: 390, locale: "ar-SA" },
	{ width: 1240, locale: "en-US" },
	{ width: 1280, locale: "en-US" },
	{ width: 1280, locale: "de-DE" },
	{ width: 1440, locale: "de-DE" },
	{ width: 1440, locale: "ar-SA" },
]) {
	test(`homepage offers direct sign-in at ${width}px in ${locale}`, async ({ page }, info) => {
		await page.setViewportSize({ width, height: 900 });
		const home = `/?locale=${locale}`;
		await page.goto(home);
		await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
		const header = page.getByRole("banner");
		const signIn = header.locator('a[href="/auth/login"]');
		const start = header.locator('a[href="/auth/register"]');
		await expect(signIn).toBeVisible();
		await expect(start).toBeVisible();
		const boxes = await header.locator("a, nav button").evaluateAll((links) =>
			links
				.filter((link) => link.getBoundingClientRect().width > 0)
				.map((link) => ({
					text: link.textContent,
					x: link.getBoundingClientRect().x,
					right: link.getBoundingClientRect().right,
					top: link.getBoundingClientRect().top,
					bottom: link.getBoundingClientRect().bottom,
				})),
		);
		for (const box of boxes) {
			expect(box.x, box.text ?? "header link").toBeGreaterThanOrEqual(0);
			expect(box.right, box.text ?? "header link").toBeLessThanOrEqual(width);
			expect(box.top).toBeGreaterThanOrEqual(0);
			expect(box.bottom).toBeLessThanOrEqual(64);
		}
		for (const [index, current] of boxes.entries()) {
			const previous = boxes[index - 1];
			if (!previous) continue;
			expect(Math.min(previous.right, current.right) - Math.max(previous.x, current.x)).toBeLessThanOrEqual(0);
		}
		for (const link of [signIn, start]) {
			const box = await link.boundingBox();
			expect(box).not.toBeNull();
			expect(box?.height).toBeGreaterThanOrEqual(44);
			expect(box?.width).toBeGreaterThanOrEqual(44);
		}
		await header.screenshot({ path: info.outputPath("homepage-account-header.png"), animations: "disabled" });
		const closing = page.locator('section[aria-labelledby="closing-title"]');
		const closingSignIn = closing.locator('a[href="/auth/login"]');
		await closingSignIn.scrollIntoViewIfNeeded();
		await closingSignIn.click();
		await expect(page).toHaveURL(/\/auth\/login/);
		await page.goto(home);
		await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
		await signIn.click();
		await expect(page).toHaveURL(/\/auth\/login/);
	});
}

test("signed-in homepage uses Dashboard while shared HTML stays anonymous", async ({ authPage: page }) => {
	const response = await page.request.get("/");
	await expect(response).toBeOK();
	const html = await response.text();
	expect(html).toContain('href="/auth/register"');
	expect(html).toContain('href="/auth/login"');
	expect(html).not.toContain('href="/dashboard"');
	await page.goto("/");
	await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
	const header = page.getByRole("banner");
	await expect(header.getByRole("link", { name: "Go to dashboard", exact: true })).toHaveAttribute(
		"href",
		"/dashboard",
	);
	await expect(page.getByRole("link", { name: "Go to dashboard", exact: true })).toHaveCount(3);
	await expect(header.locator('a[href="/auth/login"]')).toHaveCount(0);
	await expect(page.locator('main a[href="/auth/register"]')).toHaveCount(0);
	await header.getByRole("link", { name: "Go to dashboard", exact: true }).click();
	await expect(page).toHaveURL(/\/dashboard(?:\/|$)/);
});
