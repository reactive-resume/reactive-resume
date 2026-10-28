import { loginViaUi, logoutViaUi, registerViaUi } from "../fixtures/auth";
import { expect, test } from "../fixtures/test";

test("keeps long auth pages reachable without horizontal overflow", async ({ page }) => {
	for (const width of [320, 1280]) {
		await page.setViewportSize({ width, height: 400 });
		await page.goto("/auth/register");
		await expect(page.getByRole("button", { name: "Sign up", exact: true })).toBeVisible();
		// Reserve a classic scrollbar's width even on systems with overlay scrollbars.
		await page.evaluate(() => {
			document.documentElement.style.scrollbarGutter = "stable";
			window.scrollTo(0, 0);
		});

		const logo = page.getByRole("img", { name: "Reactive Resume", exact: true });
		await expect(logo).toBeInViewport();
		expect(await logo.evaluate((element) => element.getBoundingClientRect().top)).toBeGreaterThanOrEqual(16);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
		).toBeLessThanOrEqual(0);

		await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
		const submit = page.getByRole("button", { name: "Sign up", exact: true });
		await expect(submit).toBeInViewport();
		expect(await submit.evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThanOrEqual(384);
	}
});

test("registers and logs in with email credentials", async ({ page, account }) => {
	let documentRequests = 0;
	page.on("request", (request) => {
		if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documentRequests++;
	});
	await registerViaUi(page, account, "/dashboard?from=signup#documents");
	await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
	await expect(page).toHaveURL(/\/dashboard\?from=signup#documents$/);
	expect(documentRequests).toBe(1);

	await logoutViaUi(page, account);
	await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();

	const beforeLogin = documentRequests;
	await loginViaUi(page, account, "/dashboard?from=login#documents");
	await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
	await expect(page).toHaveURL(/\/dashboard\?from=login#documents$/);
	expect(documentRequests).toBe(beforeLogin + 1);
});
