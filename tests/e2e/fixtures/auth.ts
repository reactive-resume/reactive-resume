import type { E2EAccount } from "./data";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";

async function assertAuthResponse(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
	if (response.ok()) return;

	throw new Error(`Authentication request failed with ${response.status()}: ${await response.text()}`);
}

export async function registerViaUi(page: Page, account: E2EAccount, callbackURL?: string) {
	await page.goto(`/auth/register${callbackURL ? `?callbackURL=${encodeURIComponent(callbackURL)}` : ""}`);
	await page.getByRole("textbox", { name: "Name", exact: true }).fill(account.name);
	// The username is optional and hidden until asked for; an empty one is made from the email address.
	if (account.username) {
		await page.getByRole("button", { name: "Choose your own", exact: true }).click();
		await page.getByLabel("Username", { exact: true }).fill(account.username);
	}
	await page.getByLabel("Email address", { exact: true }).fill(account.email);
	await page.getByLabel("Password", { exact: true }).fill(account.password);
	await page.getByRole("button", { name: "Create account", exact: true }).click();
	await page.waitForURL(/\/dashboard/);
}

export async function loginViaUi(page: Page, account: E2EAccount, path = "/auth/login") {
	await page.goto(path);
	await page.getByLabel("Email or username", { exact: true }).fill(account.email);
	await page.getByLabel("Password", { exact: true }).fill(account.password);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL(/\/dashboard/);
}

export async function logoutViaUi(page: Page, account: E2EAccount) {
	// The account row at the foot of the sidebar opens Settings; Sign out is under its section list.
	await page
		.getByRole("navigation", { name: "Main" })
		.getByRole("link", { name: new RegExp(account.name) })
		.click();
	await page.getByRole("button", { name: "Sign out", exact: true }).first().click();
	await page.waitForURL((url) => url.pathname === "/");
}

async function registerViaApi(request: APIRequestContext, account: E2EAccount, baseURL: string) {
	const response = await request.post("/api/auth/sign-up/email", {
		headers: {
			origin: baseURL,
			referer: `${baseURL}/auth/register`,
		},
		data: {
			name: account.name,
			email: account.email,
			password: account.password,
			username: account.username,
			displayUsername: account.username,
			callbackURL: "/dashboard",
		},
	});

	await assertAuthResponse(response);
}

export async function createAuthenticatedContext(
	browser: Browser,
	request: APIRequestContext,
	account: E2EAccount,
	baseURL: string,
): Promise<BrowserContext> {
	await registerViaApi(request, account, baseURL);

	return browser.newContext({
		baseURL,
		storageState: await request.storageState(),
	});
}
