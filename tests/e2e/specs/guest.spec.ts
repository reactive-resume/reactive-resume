import type { E2EAccount } from "../fixtures/data";
import type { APIRequestContext, Browser, BrowserContext } from "@playwright/test";
import { registerViaUi } from "../fixtures/auth";
import { deleteE2EUser } from "../fixtures/db";
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
	const resume = (await published.json()) as { isPrimary: boolean; slug: string };
	expect(resume).toMatchObject({ isPrimary: true });
	return { id, slug: resume.slug };
}

async function signInGuest(browser: Browser, baseURL: string | undefined, origin: string) {
	const context = await browser.newContext({ baseURL });
	const signedIn = await context.request.post("/api/auth/sign-in/anonymous", { headers: { origin }, data: {} });
	expect(signedIn.ok()).toBe(true);
	return context;
}

for (const width of [390, 1280]) {
	test(`conflicting guest Career preferences preserve both accounts and allow a safe retry at ${width}px`, async ({
		browser,
		authPage,
		account,
		baseURL,
	}, testInfo) => {
		const origin = String(baseURL);
		const ownerProfile = { priorities: "Fictional existing account preference", memoryMode: "off" };
		expect((await authPage.request.patch("/api/openapi/career/profile", { data: ownerProfile })).status()).toBe(200);
		const owner = await (await authPage.request.get("/api/openapi/career/profile")).json();
		const guest = await signInGuest(browser, baseURL, origin);
		const guestSession = await (await guest.request.get("/api/auth/get-session")).json();
		try {
			const guestProfile = { priorities: "Fictional guest preference", memoryMode: "auto" };
			expect((await guest.request.patch("/api/openapi/career/profile", { data: guestProfile })).status()).toBe(200);
			const before = await (await guest.request.get("/api/openapi/career/profile")).json();
			const factResponse = await guest.request.post("/api/openapi/career/facts", {
				data: {
					text: "Fictional guest led a migration.",
					category: "experience",
					source: { kind: "manual", id: "fictional-guest-fact", quote: "Fictional guest led a migration." },
				},
			});
			expect(factResponse.status()).toBe(200);
			const fact = await factResponse.json();
			const page = await guest.newPage();
			await page.setViewportSize({ width, height: 900 });
			await page.goto("/auth/login");
			await expect(page.getByText(/Different Career profiles stop sign-in and keep your guest work/)).toBeVisible();
			await page.getByLabel("Email or username", { exact: true }).fill(account.email);
			await page.getByLabel("Password", { exact: true }).fill(account.password);
			const failed = page.waitForResponse((response) => response.url().includes("/sign-in/email"));
			await page.getByRole("button", { name: "Sign in", exact: true }).click();
			expect((await failed).status()).toBe(409);
			await expect(page.getByText(/Guest and account Career preferences differ/)).toBeVisible();
			await expect(page).toHaveURL(/\/auth\/login/);
			const retainedSession = await (await guest.request.get("/api/auth/get-session")).json();
			expect(retainedSession.user.id).toBe(guestSession.user.id);
			expect(retainedSession.user.isAnonymous).toBe(true);
			expect(await (await guest.request.get("/api/openapi/career/profile")).json()).toEqual(before);
			expect(await (await authPage.request.get("/api/openapi/career/profile")).json()).toEqual(owner);
			await page.getByLabel("Email or username", { exact: true }).fill("alex.morgan@example.test");
			await page.getByLabel("Password", { exact: true }).fill("");
			await expect(page.getByText(/Guest and account Career preferences differ/)).toBeVisible();
			await page.screenshot({ path: testInfo.outputPath("guest-profile-conflict.png"), fullPage: true });
			await page.reload();
			await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
			// An explicit edit aligns both settings; sign-in itself must never choose a consent mode.
			expect((await guest.request.patch("/api/openapi/career/profile", { data: owner })).status()).toBe(200);
			await page.getByLabel("Email or username", { exact: true }).fill(account.email);
			await page.getByLabel("Password", { exact: true }).fill(account.password);
			await page.getByRole("button", { name: "Sign in", exact: true }).click();
			await expect(page).toHaveURL(/\/dashboard/);
			expect((await (await guest.request.get("/api/auth/get-session")).json()).user.email).toBe(account.email);
			expect(await (await authPage.request.get("/api/openapi/career/profile")).json()).toEqual(owner);
			const facts = await (await authPage.request.get("/api/openapi/career/facts?all=true")).json();
			expect(facts).toEqual(expect.arrayContaining([expect.objectContaining({ id: fact.id, text: fact.text })]));
		} finally {
			await deleteE2EUser({ ...account, email: guestSession.user.email, username: guestSession.user.username });
			await guest.close();
		}
	});
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
		ownerPrimary: { id: string; slug: string };
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
	expect(items.filter((resume) => resume.isPrimary)).toEqual([expect.objectContaining({ id: input.ownerPrimary.id })]);
	// The short link serves the owner's primary page, not merely a 200 from some other resume.
	const shortLink = await context.request.get(`/${input.account.username}`);
	expect(shortLink.status()).toBe(200);
	expect(await shortLink.text()).toContain(`/${input.account.username}/${input.ownerPrimary.slug}`);
}

test("a guest who published can sign in to an existing account that already has a primary resume", async ({
	browser,
	authPage,
	account,
	baseURL,
}) => {
	const origin = String(baseURL);
	const ownerPrimary = await publishOwnerPrimary(authPage.request);
	const guest = await signInGuest(browser, baseURL, origin);
	try {
		const { id, published } = await publishGuestResume(guest);
		// The guest's first publish claims primary, which is what used to break the link.
		expect(published.isPrimary).toBe(true);
		await signInToOwnerAndAssertMoved(guest, {
			account,
			origin,
			owner: authPage.request,
			ownerPrimary,
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
	const ownerPrimary = await publishOwnerPrimary(authPage.request);
	const guest = await signInGuest(browser, baseURL, origin);
	try {
		const { id, published } = await publishGuestResume(guest, true);
		expect(published.isPrimary).toBe(false);
		await signInToOwnerAndAssertMoved(guest, {
			account,
			origin,
			owner: authPage.request,
			ownerPrimary,
			guestResumeId: id,
		});
	} finally {
		await guest.close();
	}
});
