import type { E2EAccount } from "../fixtures/data";
import type { APIRequestContext, Browser, BrowserContext } from "@playwright/test";
import { registerViaUi } from "../fixtures/auth";
import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test.skip(process.env.FLAG_ENABLE_GUEST_LOGIN !== "true", "Needs FLAG_ENABLE_GUEST_LOGIN=true");

test("keeps a guest's resume after creating an account", async ({ page, account }, testInfo) => {
	await page.goto("/auth/login");
	await page.getByRole("button", { name: "Continue as guest" }).click();
	await page.waitForURL(/\/dashboard/);
	await expect(page.getByText("You're using a guest account")).toBeVisible();

	const resumeName = await createSampleResumeFromDashboard(page, testInfo);

	await registerViaUi(page, account);
	await expect(page.getByText(resumeName)).toBeVisible();
	await expect(page.getByText("You're using a guest account")).toBeHidden();
});

/** An owner with one published resume, which therefore owns the short link. */
async function publishOwnerPrimary(owner: APIRequestContext) {
	const created = await owner.post("/api/openapi/resumes", { data: { name: "Main", tags: [] } });
	expect(created.ok()).toBe(true);
	const id = (await created.json()) as string;
	const published = await owner.put(`/api/openapi/resumes/${id}`, { data: { isPublic: true } });
	expect(published.ok()).toBe(true);
	expect(await published.json()).toMatchObject({ isPrimary: true });
	return id;
}

async function signInGuest(browser: Browser, baseURL: string | undefined, origin: string) {
	const context = await browser.newContext({ baseURL });
	const signedIn = await context.request.post("/api/auth/sign-in/anonymous", { headers: { origin }, data: {} });
	expect(signedIn.ok()).toBe(true);
	return context;
}

/** Publishes a resume as the guest. The guest's first publish claims primary unless it declines it. */
async function publishGuestResume(context: BrowserContext, declinedPrimary = false) {
	const created = await context.request.post("/api/openapi/resumes", { data: { name: "Guest CV", tags: [] } });
	expect(created.ok()).toBe(true);
	const id = (await created.json()) as string;
	const published = await context.request.put(`/api/openapi/resumes/${id}`, {
		data: { isPublic: true, ...(declinedPrimary ? { isPrimary: false } : {}) },
	});
	expect(published.ok()).toBe(true);
	return { id, published: (await published.json()) as { isPrimary: boolean } };
}

/** Signs the guest's browser context in to the existing owner account and checks the guest work moved there. */
async function signInToOwnerAndAssertMoved(
	context: BrowserContext,
	input: {
		account: E2EAccount;
		origin: string;
		owner: APIRequestContext;
		ownerPrimaryId: string;
		guestResumeId: string;
	},
) {
	const response = await context.request.post("/api/auth/sign-in/email", {
		headers: { origin: input.origin },
		data: { email: input.account.email, password: input.account.password },
	});
	expect(response.status()).toBe(200);
	const session = await (await context.request.get("/api/auth/get-session")).json();
	expect(session?.user?.email).toBe(input.account.email);
	expect(session?.user?.isAnonymous ?? false).toBe(false);

	const list = (await (await input.owner.get("/api/openapi/resumes")).json()) as
		| { id: string; isPrimary: boolean }[]
		| { items: { id: string; isPrimary: boolean }[] };
	const items = Array.isArray(list) ? list : list.items;
	expect(items.find((resume) => resume.id === input.guestResumeId)).toMatchObject({ isPrimary: false });
	expect(items.filter((resume) => resume.isPrimary)).toEqual([expect.objectContaining({ id: input.ownerPrimaryId })]);
	// The short link still opens the owner's primary page.
	expect((await context.request.get(`/${input.account.username}`)).status()).toBe(200);
}

test("a guest who published can sign in to an existing account that already has a primary resume", async ({
	browser,
	authPage,
	account,
	baseURL,
}) => {
	const origin = String(baseURL);
	const ownerPrimaryId = await publishOwnerPrimary(authPage.request);
	const guest = await signInGuest(browser, baseURL, origin);
	try {
		const { id, published } = await publishGuestResume(guest);
		// The guest's first publish claims primary, which is what used to break the link.
		expect(published.isPrimary).toBe(true);
		await signInToOwnerAndAssertMoved(guest, {
			account,
			origin,
			owner: authPage.request,
			ownerPrimaryId,
			guestResumeId: id,
		});
	} finally {
		await guest.close();
	}
});

test("a guest who declined primary can sign in to an existing account that already has a primary resume", async ({
	browser,
	authPage,
	account,
	baseURL,
}) => {
	const origin = String(baseURL);
	const ownerPrimaryId = await publishOwnerPrimary(authPage.request);
	const guest = await signInGuest(browser, baseURL, origin);
	try {
		const { id, published } = await publishGuestResume(guest, true);
		expect(published.isPrimary).toBe(false);
		await signInToOwnerAndAssertMoved(guest, {
			account,
			origin,
			owner: authPage.request,
			ownerPrimaryId,
			guestResumeId: id,
		});
	} finally {
		await guest.close();
	}
});
