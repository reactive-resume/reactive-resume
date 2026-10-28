import { loginViaUi, logoutViaUi, registerViaUi } from "../fixtures/auth";
import { expect, test } from "../fixtures/test";

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("failed settings sign-out retains the session and drafts; successful sign-out clears private browser data", async ({
	authPage: page,
}) => {
	await page.goto("/dashboard/settings/account");
	const key = "career-story:security-fixture";
	await page.evaluate((key) => {
		localStorage.setItem(key, "fictional draft");
		sessionStorage.setItem(key, "fictional draft");
	}, key);
	await page.route("**/api/auth/sign-out", (route) =>
		route.fulfill({
			status: 429,
			contentType: "application/json",
			body: JSON.stringify({ code: "TOO_MANY_REQUESTS", message: "Try later" }),
		}),
	);
	await page.getByRole("button", { name: "Sign out", exact: true }).last().click();
	await expect(page.getByText("Couldn't sign out. Try again.", { exact: true })).toBeVisible();
	await expect(page).toHaveURL(/\/dashboard\/settings\/account/);
	expect(await page.evaluate((key) => [localStorage.getItem(key), sessionStorage.getItem(key)], key)).toEqual([
		"fictional draft",
		"fictional draft",
	]);
	const session = await page.request.get("/api/auth/get-session");
	expect((await session.json()).user).toBeTruthy();
	await page.unroute("**/api/auth/sign-out");
	await page.getByRole("button", { name: "Sign out", exact: true }).last().click();
	await expect(page).toHaveURL(/\/$/);
	expect(await page.evaluate((key) => [localStorage.getItem(key), sessionStorage.getItem(key)], key)).toEqual([
		null,
		null,
	]);
});

test("keeps long auth pages reachable without horizontal overflow", async ({ page }) => {
	for (const width of [320, 1280]) {
		await page.setViewportSize({ width, height: 400 });
		await page.goto("/auth/register");
		await expect(page.getByRole("button", { name: "Sign up", exact: true })).toBeVisible();
		// An explicit scrollbar width forces classic scrollbars on macOS too.
		await page.evaluate(() => {
			document.styleSheets[0]?.insertRule("::-webkit-scrollbar { width: 16px; }");
			window.scrollTo(0, 0);
		});
		await expect
			.poll(() => page.evaluate(() => window.innerWidth - document.documentElement.clientWidth))
			.toBeGreaterThan(0);

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
