import { loginViaUi, logoutViaUi, registerViaUi } from "../fixtures/auth";
import { expect, test } from "../fixtures/test";

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

test("signs up without a username and lands on the dashboard", async ({ page, account }) => {
	await registerViaUi(page, { ...account, username: "" });
	await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
	const session = await page.request.get("/api/auth/get-session");
	expect((await session.json()).user.username).toBe(account.email.split("@")[0]);
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

	// Signing out lands on the site's homepage.
	await logoutViaUi(page, account);
	await expect(page).toHaveURL((url) => url.pathname === "/");

	const beforeLogin = documentRequests;
	await loginViaUi(page, account, "/dashboard?from=login#documents");
	await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
	await expect(page).toHaveURL(/\/dashboard\?from=login#documents$/);
	expect(documentRequests).toBe(beforeLogin + 1);
});
