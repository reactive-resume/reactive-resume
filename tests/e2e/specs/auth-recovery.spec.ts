import { createAuthenticatedContext } from "../fixtures/auth";
import { deleteE2EUser } from "../fixtures/db";
import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

for (const width of [390, 1280]) {
	test(`password recovery is keyboard reachable and preserves its callback at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 844 });
		const callback = "/dashboard/applications?view=list#saved";
		await page.goto(`/auth/login?callbackURL=${encodeURIComponent(callback)}`);
		const forgot = page.getByRole("link", { name: "Forgot password?", exact: true });
		expect(await forgot.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
		await page.getByLabel("Email or username", { exact: true }).focus();
		for (let step = 0; step < 6; step++) {
			if (await forgot.evaluate((element) => document.activeElement === element)) break;
			await page.keyboard.press("Tab");
		}
		await expect(forgot).toBeFocused();
		await page.keyboard.press("Enter");
		expect(new URL(page.url()).searchParams.get("callbackURL")).toBe(callback);
		await page.getByRole("link", { name: "Sign in now", exact: true }).click();
		expect(new URL(page.url()).searchParams.get("callbackURL")).toBe(callback);
		await page.goto(`/auth/reset-password?error=INVALID_TOKEN&callbackURL=${encodeURIComponent(callback)}`);
		await expect(page.getByText("This reset link expired or was already used.", { exact: true })).toBeVisible();
		await page.screenshot({ path: testInfo.outputPath("expired-reset.png"), fullPage: true });
		await page.getByRole("link", { name: "Send a new link", exact: true }).click();
		expect(new URL(page.url()).pathname).toBe("/auth/forgot-password");
		expect(new URL(page.url()).searchParams.get("callbackURL")).toBe(callback);
	});

	test(`expired sessions offer one sign-in recovery without leaving the current page at ${width}px`, async ({
		authPage: page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 844 });
		await page.goto("/dashboard/applications");
		await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeVisible();
		await page.context().clearCookies();
		// A real authenticated query after cookie removal exercises the shared RPC interceptor, including batching.
		await page.getByRole("link", { name: "Documents", exact: true }).click();
		await expect(page).toHaveURL((url) => url.pathname === "/dashboard");
		const message = page.getByText("Your session ended. Sign in again to keep working.", { exact: true });
		await expect(message).toBeVisible();
		await expect(message).toHaveCount(1);
		const signIn = page.getByRole("link", { name: "Sign in again", exact: true });
		await expect(signIn).toHaveAttribute("target", "_blank");
		const url = new URL((await signIn.getAttribute("href")) ?? "", page.url());
		expect(url.searchParams.get("callbackURL")).toBe("/dashboard");
		expect(new URL(page.url()).pathname).toBe("/dashboard");
		await page.evaluate(() =>
			Promise.all(
				document
					.getAnimations()
					.filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
					.map((animation) => animation.finished.catch(() => {})),
			),
		);
		await page.screenshot({ path: testInfo.outputPath("session-ended.png"), fullPage: true, animations: "disabled" });
	});
}

test("wrong credentials and expired two-step challenges show recovery copy instead of raw server errors", async ({
	page,
	account,
}) => {
	await page.goto("/auth/login");
	await page.getByLabel("Email or username", { exact: true }).fill(account.email);
	await page.getByLabel("Password", { exact: true }).fill("Fictional-wrong-password-42");
	await page.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(
		page.getByText("That email, username or password doesn't match. Check them, or reset your password.", {
			exact: true,
		}),
	).toBeVisible();
	await expect(page.getByText("Invalid email or password", { exact: true })).toHaveCount(0);
	await page.goto("/auth/verify-2fa-backup?callbackURL=%2Fdashboard%2Fapplications");
	await page.getByLabel("Backup code", { exact: true }).fill("ABCDE-FGHIJ");
	await page.getByRole("button", { name: "Verify", exact: true }).click();
	await expect(page).toHaveURL(/\/auth\/login\?/);
	await expect(page.getByText("This sign-in step expired. Sign in again.", { exact: true })).toBeVisible();
	expect(new URL(page.url()).searchParams.get("callbackURL")).toBe("/dashboard/applications");
	await expect(page.getByText("Invalid two factor cookie", { exact: true })).toHaveCount(0);
});

test("a rejected reset token replaces the form with a new-link action", async ({ page }) => {
	await page.goto("/auth/reset-password?token=fictional-invalid-token");
	await page.getByLabel("New password", { exact: true }).fill("Fictional-new-password-42");
	await page.getByRole("button", { name: "Reset password", exact: true }).click();
	await expect(page.getByRole("link", { name: "Send a new link", exact: true })).toBeVisible();
	await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
});

test("an actual invalid email-reset endpoint keeps its explanation", async ({ page }) => {
	await page.goto("/api/auth/reset-password/fictional-invalid-token?callbackURL=%2Fauth%2Freset-password");
	await expect(page.getByText("This reset link expired or was already used.", { exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: "Send a new link", exact: true })).toBeVisible();
});

for (const [locale, reset, credentials] of [
	[
		"de-DE",
		"Dieser Link ist abgelaufen oder wurde bereits verwendet.",
		"E-Mail, Benutzername oder Passwort stimmen nicht. Prüfe deine Angaben oder setze dein Passwort zurück.",
	],
	[
		"ar-SA",
		"انتهت صلاحية رابط إعادة التعيين هذا أو استُخدم بالفعل.",
		"البريد أو اسم المستخدم أو كلمة المرور غير مطابق. تحقّق منها أو أعد تعيين كلمة المرور.",
	],
] as const) {
	test(`auth recovery renders localized product copy in ${locale}`, async ({ page, account }) => {
		await page.goto(`/auth/reset-password?error=INVALID_TOKEN&locale=${locale}`);
		await expect(page.getByText(reset, { exact: true })).toBeVisible();
		await page.goto(`/auth/login?locale=${locale}`);
		await page.locator('input[name="identifier"]').fill(account.email);
		await page.locator('input[name="password"]').fill("Fictional-wrong-password-42");
		await page.locator('button[type="submit"]').click();
		await expect(page.getByText(credentials, { exact: true })).toBeVisible();
		await expect(page.getByText("Invalid email or password", { exact: true })).toHaveCount(0);
	});
}

test("a real expired builder save keeps the edit through same-account new-tab sign-in and retry", async ({
	authPage: page,
	account,
}, testInfo) => {
	await createSampleResumeFromDashboard(page, testInfo);
	const id = new URL(page.url()).pathname.split("/").at(-1) ?? "";
	const headline = page.getByRole("textbox", { name: "Headline", exact: true });
	await expect(headline).toBeVisible();
	await page.context().clearCookies();
	await headline.fill("Fictional recovered headline");
	await headline.blur();
	await expect(page.getByRole("link", { name: "Sign in to save", exact: true })).toBeVisible();
	await expect(headline).toHaveValue("Fictional recovered headline");
	const popupPromise = page.waitForEvent("popup");
	await page.getByRole("link", { name: "Sign in to save", exact: true }).click();
	const login = await popupPromise;
	await login.getByLabel("Email or username", { exact: true }).fill(account.email);
	await login.getByLabel("Password", { exact: true }).fill(account.password);
	await login.getByRole("button", { name: "Sign in", exact: true }).click();
	await expect(login).toHaveURL(new RegExp(`/builder/${id}`));
	await login.close();
	await page.bringToFront();
	await page.evaluate(() => window.dispatchEvent(new Event("focus")));
	await expect(page.getByText("Your session ended. Sign in again to keep working.", { exact: true })).toBeHidden();
	await expect(headline).toHaveValue("Fictional recovered headline");
	const retry = page.getByRole("button", { name: "Retry saving", exact: true });
	if (await retry.isVisible()) await retry.click();
	await expect
		.poll(async () => {
			const response = await page.request.get(`/api/openapi/resumes/${id}`);
			return (await response.json()).data.basics.headline;
		})
		.toBe("Fictional recovered headline");
	await page.reload();
	await expect(headline).toHaveValue("Fictional recovered headline");
});

test("recovery into a different account clears the old editor and never saves its pending edit", async ({
	authPage: page,
	account,
	browser,
	baseURL,
}, testInfo) => {
	await createSampleResumeFromDashboard(page, testInfo);
	const id = new URL(page.url()).pathname.split("/").at(-1) ?? "";
	const original = await browser.newContext({
		baseURL: String(baseURL),
		storageState: await page.context().storageState(),
	});
	const other = { ...account, email: account.email.replace("@", "+other@"), username: `${account.username}_o` };
	const signup = await browser.newContext({ baseURL: String(baseURL) });
	try {
		const created = await createAuthenticatedContext(browser, signup.request, other, String(baseURL));
		await created.close();
		await page.context().clearCookies();
		const headline = page.getByRole("textbox", { name: "Headline", exact: true });
		await headline.fill("Private pending edit for the first account");
		await headline.blur();
		await expect(page.getByRole("link", { name: "Sign in to save", exact: true })).toBeVisible();
		const popupPromise = page.waitForEvent("popup");
		await page.getByRole("link", { name: "Sign in to save", exact: true }).click();
		const login = await popupPromise;
		await login.getByLabel("Email or username", { exact: true }).fill(other.email);
		await login.getByLabel("Password", { exact: true }).fill(other.password);
		await login.getByRole("button", { name: "Sign in", exact: true }).click();
		await expect
			.poll(async () => (await (await login.request.get("/api/auth/get-session")).json())?.user?.email)
			.toBe(other.email);
		await login.close();
		await page.bringToFront();
		await page.evaluate(() => window.dispatchEvent(new Event("focus")));
		await expect(headline).toHaveCount(0);
		const retained = await (await original.request.get(`/api/openapi/resumes/${id}`)).json();
		expect(retained.data.basics.headline).not.toBe("Private pending edit for the first account");
		expect((await page.request.get(`/api/openapi/resumes/${id}`)).status()).toBe(404);
	} finally {
		await original.close();
		await signup.close();
		await deleteE2EUser(other);
	}
});
