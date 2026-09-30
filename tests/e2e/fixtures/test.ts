import type { E2EAccount } from "./data";
import type { Page } from "@playwright/test";
import { test as base, expect } from "@playwright/test";
import { createAuthenticatedContext } from "./auth";
import { createAccount } from "./data";
import { deleteE2EUser } from "./db";

type Fixtures = {
	account: E2EAccount;
	authPage: Page;
};

export const test = base.extend<Fixtures>({
	account: async ({ baseURL: _baseURL }, use, testInfo) => {
		const account = createAccount(testInfo);

		try {
			await use(account);
		} finally {
			await deleteE2EUser(account);
		}
	},
	authPage: async ({ browser, request, account }, use, testInfo) => {
		const baseURL = String(testInfo.project.use.baseURL ?? "http://localhost:3000");
		const context = await createAuthenticatedContext(browser, request, account, baseURL);

		try {
			await use(await context.newPage());
		} finally {
			await context.close();
		}
	},
});

export { expect };
