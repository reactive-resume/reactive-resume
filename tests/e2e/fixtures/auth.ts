import type { E2EAccount } from "./data";
import type { APIRequestContext, Browser, BrowserContext, Page } from "@playwright/test";

async function assertAuthResponse(response: Awaited<ReturnType<APIRequestContext["post"]>>) {
	if (response.ok()) return;

	throw new Error(`Authentication request failed with ${response.status()}: ${await response.text()}`);
}

export async function registerViaUi(page: Page, account: E2EAccount) {
	await page.goto("/auth/register");
	await page.getByRole("textbox", { name: "Name", exact: true }).fill(account.name);
	await page.getByLabel("Username").fill(account.username);
	await page.getByLabel("Email Address", { exact: true }).fill(account.email);
	await page.getByLabel("Password", { exact: true }).fill(account.password);
	await page.getByRole("button", { name: "Sign up" }).click();
	await page.getByRole("button", { name: "Continue" }).click();
	await page.waitForURL(/\/dashboard/);
}

export async function loginViaUi(page: Page, account: E2EAccount) {
	await page.goto("/auth/login");
	await page.getByLabel("Email Address", { exact: true }).fill(account.email);
	await page.getByLabel("Password", { exact: true }).fill(account.password);
	await page.getByRole("button", { name: "Sign in" }).click();
	await page.waitForURL(/\/dashboard/);
}

export async function logoutViaUi(page: Page, account: E2EAccount) {
	// The avatar row at the foot of the sidebar opens the account menu.
	await page
		.getByRole("complementary")
		.getByRole("button", { name: new RegExp(account.name) })
		.click();
	await page.getByRole("menuitem", { name: "Sign out" }).click();
	await page.goto("/auth/login");
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
