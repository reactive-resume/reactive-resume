import { createAuthenticatedContext, loginViaUi } from "../fixtures/auth";
import { deleteE2EUser } from "../fixtures/db";
import { test, expect } from "../fixtures/test";

test("native security handoff fences the browser account and preserves its target through sign-in", async ({
	authPage: ownerPage,
	account,
	browser,
	request,
	baseURL,
}) => {
	if (!baseURL) throw new Error("Test server URL is required");
	const profile = await ownerPage.request.get("/api/openapi/auth/profile");
	expect(profile.status()).toBe(200);
	const owner = await profile.json();
	const other = {
		...account,
		email: account.email.replace("@", ".other@"),
		username: `${account.username.slice(0, 63)}b`,
	};
	const context = await createAuthenticatedContext(browser, request, other, baseURL);
	try {
		const page = await context.newPage();
		const target = `/dashboard/settings/account?forAccount=${encodeURIComponent(owner.id)}#passkeys`;
		await page.goto(target);
		await expect(page.getByRole("alert")).toHaveText("Sign in with the account that opened these settings.");
		await expect(page.getByRole("button", { name: "Add passkey", exact: true })).toHaveCount(0);
		await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveCount(0);
		await page.getByRole("link", { name: "AI & developer", exact: true }).click();
		expect(new URL(page.url()).searchParams.get("forAccount")).toBe(owner.id);
		await expect(page.getByRole("alert")).toBeVisible();
		await expect(page.getByRole("button", { name: "New key", exact: true })).toHaveCount(0);
		for (const sensitive of [
			`/dashboard/settings/account?forAccount=${encodeURIComponent(owner.id)}&deleteAccount=true`,
			`/dashboard/settings/ai?forAccount=${encodeURIComponent(owner.id)}&newKey=true#api-keys`,
		]) {
			await page.goto(sensitive);
			await expect(page.getByRole("alert")).toBeVisible();
			await expect(page.getByRole("dialog")).toHaveCount(0);
		}
		await page.goto(target);
		await page.getByRole("link", { name: "Sign in again", exact: true }).click();
		const login = new URL(page.url());
		expect(login.searchParams.get("reauthenticate")).toBe("true");
		expect(login.searchParams.get("callbackURL")).toBe(target);
		await loginViaUi(page, account, page.url());
		expect(new URL(page.url()).hash).toBe("#passkeys");
		expect(new URL(page.url()).searchParams.get("forAccount")).toBe(owner.id);
		await expect(page.getByRole("button", { name: "Add passkey", exact: true })).toBeVisible();
		await expect(page.getByRole("textbox", { name: "Email", exact: true })).toHaveValue(account.email);
		await expect(page.getByRole("alert")).toHaveCount(0);
		const switchPage = await context.newPage();
		await loginViaUi(switchPage, other, "/auth/login?reauthenticate=true");
		await page.bringToFront();
		await expect(page.getByRole("alert")).toHaveText("Sign in with the account that opened these settings.");
		await expect(page.getByRole("button", { name: "Add passkey", exact: true })).toHaveCount(0);
	} finally {
		try {
			await context.close();
		} finally {
			await deleteE2EUser(other);
		}
	}
});

test("all five account targets open read-only; password cancellation preserves credentials", async ({
	authPage: page,
}) => {
	const before = await (await page.request.get("/api/openapi/auth/profile")).json();
	const accountsBefore = await (await page.request.get("/api/auth/list-accounts")).json();
	const writes: string[] = [];
	page.on("request", (request) => {
		if (
			request.method() !== "GET" &&
			/\/api\/auth\/(change-|set-password|two-factor|passkey\/(add|delete|update)|link-social|unlink-account|delete-user)/.test(
				request.url(),
			)
		)
			writes.push(request.url());
	});
	for (const target of ["email", "password", "two-step", "passkeys", "linked-accounts"]) {
		await page.goto(`/dashboard/settings/account?forAccount=${encodeURIComponent(before.id)}#${target}`);
		const anchor = page.locator(`#${target}`);
		await expect(anchor).toBeVisible();
		await expect(anchor).toBeInViewport();
	}
	await page.locator("#password").getByRole("button", { name: "Change", exact: true }).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
	await expect(page.getByRole("dialog")).toHaveCount(0);
	expect(writes).toEqual([]);
	expect(await (await page.request.get("/api/openapi/auth/profile")).json()).toEqual(before);
	expect(await (await page.request.get("/api/auth/list-accounts")).json()).toEqual(accountsBefore);
});
