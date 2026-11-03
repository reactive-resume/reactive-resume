import { expect, test } from "../fixtures/test";

test.use({ locale: "de-AT" });

for (const path of ["/", "/ats-checker", "/auth/login"]) {
	test(`follows browser language on ${path} without saving an automatic choice`, async ({ page, context }) => {
		await page.goto(`${path}?campaign=first-visit`);
		await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
		if (path === "/auth/login") await expect(page.getByRole("button", { name: "Anmelden", exact: true })).toBeVisible();
		expect((await context.cookies()).find((cookie) => cookie.name === "locale")).toBeUndefined();
		expect(new URL(page.url()).searchParams.get("campaign")).toBe("first-visit");
		expect(new URL(page.url()).searchParams.has("locale")).toBe(false);
		await page.reload();
		await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
		expect((await context.cookies()).find((cookie) => cookie.name === "locale")).toBeUndefined();
	});
}

test("explicit language wins and the saved choice survives navigation", async ({ page, context, baseURL }) => {
	await context.addCookies([{ name: "locale", value: "fr-FR", url: baseURL ?? "http://localhost:3000" }]);
	await page.goto("/auth/login");
	await expect(page.locator("html")).toHaveAttribute("lang", "fr-FR");
	await page.goto("/?locale=ja-JP&campaign=explicit");
	await expect(page.locator("html")).toHaveAttribute("lang", "ja-JP");
	// Prerendered HTML already has this language; persistence waits for the app to start.
	await expect
		.poll(async () => (await context.cookies()).find((cookie) => cookie.name === "locale")?.value)
		.toBe("ja-JP");
	await page.goto("/auth/login");
	await expect(page.locator("html")).toHaveAttribute("lang", "ja-JP");
});

test("a foreign-language picker shows endonyms and keeps translated names and codes searchable", async ({
	page,
	context,
}, info) => {
	await page.goto("/ats-checker?locale=de-DE&campaign=endonyms");
	await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
	await page.getByRole("banner").getByRole("combobox", { name: "Sprache ändern", exact: true }).click();
	await expect(page.getByRole("listbox")).toBeVisible();
	const french = page.getByRole("option").filter({ hasText: "Français" });
	await expect(french).toHaveText(/Français\s*·\s*Französisch/);
	await expect(french).not.toContainText("fr-FR");
	await expect(french.locator('[lang="fr-FR"]')).toHaveText("Français");
	await french.scrollIntoViewIfNeeded();
	await page
		.getByRole("listbox")
		.screenshot({ path: info.outputPath("language-endonyms.png"), animations: "disabled" });
	const search = page.getByRole("combobox").last();
	for (const query of ["Français", "Französisch", "French", "fr-FR"]) {
		await search.fill(query);
		await expect(page.getByRole("option")).toHaveCount(1);
		await expect(french).toBeVisible();
	}
	await french.click();
	await expect(page.locator("html")).toHaveAttribute("lang", "fr-FR");
	expect(new URL(page.url()).searchParams.get("campaign")).toBe("endonyms");
	expect((await context.cookies()).find((cookie) => cookie.name === "locale")?.value).toBe("fr-FR");
	await page.reload();
	await expect(page.locator("html")).toHaveAttribute("lang", "fr-FR");
});

test("shared homepage HTML ignores Accept-Language while private unavailable pages honor explicit choice", async ({
	request,
}) => {
	const german = await request.get("/", { headers: { "accept-language": "de-DE" } });
	const french = await request.get("/", { headers: { "accept-language": "fr-FR" } });
	const germanHtml = await german.text();
	expect(germanHtml).toContain('lang="en-US"');
	expect(await french.text()).toBe(germanHtml);
	expect(german.headers().etag).toBe(french.headers().etag);
	expect(german.headers().vary).not.toMatch(/accept-language/i);
	expect(german.headers()["set-cookie"] ?? "").not.toContain("locale=");

	const unavailable = await request.get("/rx154-no-such-resume", {
		headers: { cookie: "locale=fr-FR", "accept-language": "de-DE" },
	});
	expect(unavailable.status()).toBe(404);
	expect(await unavailable.text()).toContain('lang="fr-FR"');
	expect(unavailable.headers()["cache-control"]).toBe("private, no-store");
});
