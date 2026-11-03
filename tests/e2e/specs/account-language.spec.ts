import { expect, test } from "../fixtures/test";

for (const width of [390, 1440]) {
	test(`restores account language on a fresh browser while explicit choices win at ${width}px`, async ({
		authPage,
		browser,
		baseURL,
	}, testInfo) => {
		expect(
			(
				await authPage.request.patch("/api/openapi/auth/profile", { data: { name: "Maya Chen", locale: "de-DE" } })
			).status(),
		).toBe(200);
		const state = await authPage.context().storageState();
		const context = await browser.newContext({
			baseURL,
			locale: "en-US",
			viewport: { width, height: 900 },
			storageState: { cookies: state.cookies.filter((cookie) => cookie.name !== "locale"), origins: [] },
		});
		try {
			const page = await context.newPage();
			const writes: string[] = [];
			page.on("request", (request) => {
				if (request.url().includes("/auth/updateProfile")) writes.push(request.url());
			});
			await page.goto("/dashboard/settings/preferences");
			await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
			await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
			expect((await (await page.request.get("/api/openapi/auth/profile")).json()).locale).toBe("de-DE");
			expect((await context.cookies()).some((cookie) => cookie.name === "locale")).toBe(false);
			expect(writes).toEqual([]);
			await page.reload();
			await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
			await page.screenshot({ path: testInfo.outputPath("restored-language.png"), animations: "disabled" });

			await context.addCookies([{ name: "locale", value: "ar-SA", url: baseURL ?? "http://localhost:3000" }]);
			await Promise.all([
				page.waitForResponse((response) => response.url().includes("/auth/updateProfile") && response.status() === 200),
				page.goto("/dashboard/settings/preferences"),
			]);
			await expect(page.locator("html")).toHaveAttribute("lang", "ar-SA");
			expect((await (await page.request.get("/api/openapi/auth/profile")).json()).locale).toBe("ar-SA");

			await Promise.all([
				page.waitForResponse((response) => response.url().includes("/auth/updateProfile") && response.status() === 200),
				page.goto("/dashboard/settings/preferences?locale=en-US"),
			]);
			await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
			expect((await (await page.request.get("/api/openapi/auth/profile")).json()).locale).toBe("en-US");
			expect((await context.cookies()).find((cookie) => cookie.name === "locale")?.value).toBe("en-US");
		} finally {
			await context.close();
		}
	});
}
