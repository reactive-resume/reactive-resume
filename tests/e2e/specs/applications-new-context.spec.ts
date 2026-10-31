import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";

const params = (page: Page, expected: Record<string, string>) => {
	const url = new URL(page.url());
	for (const [key, value] of Object.entries(expected)) expect(url.searchParams.get(key)).toBe(value);
	return url;
};

test("New from every Applications view preserves the view, search and closed filter, and cancel creates nothing", async ({
	authPage: page,
}) => {
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Acme Search Fixture", role: "Initial Role" },
	});
	await expect(created).toBeOK();

	const views = ["board", "insights", "calendar"] as const;
	for (const view of views) {
		await page.goto(`/dashboard/applications?view=${view}&q=Acme&closed=true`);
		await expect(page.getByRole("heading", { name: "Applications", level: 1 })).toBeVisible();
		const openFromKeyboard = view === "board";
		if (openFromKeyboard) await page.getByRole("heading", { name: "Applications", level: 1 }).click();
		await (openFromKeyboard
			? page.keyboard.press("n")
			: page.getByRole("complementary").getByRole("button", { name: "New", exact: true }).click());

		let dialog = page.getByRole("dialog", { name: "Save a job" });
		await expect(dialog).toBeVisible();
		params(page, { view, q: "Acme", closed: "true" });
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
		await expect(dialog).toBeHidden();
		params(page, { view, q: "Acme", closed: "true" });
		expect(new URL(page.url()).searchParams.has("create")).toBe(false);

		// Opening again after Cancel still starts from the same view and filter.
		await page.getByRole("complementary").getByRole("button", { name: "New", exact: true }).click();
		dialog = page.getByRole("dialog", { name: "Save a job" });
		await expect(dialog).toBeVisible();
		params(page, { view, q: "Acme", closed: "true" });
		await dialog.getByRole("button", { name: "Close", exact: true }).click();
		await expect(dialog).toBeHidden();
		params(page, { view, q: "Acme", closed: "true" });

		// Saving keeps the view and filter; the new row is added under this view.
		await page.getByRole("complementary").getByRole("button", { name: "New", exact: true }).click();
		dialog = page.getByRole("dialog", { name: "Save a job" });
		await dialog.getByLabel("Role").fill(`Role ${view}`);
		await dialog.getByLabel("Company", { exact: true }).fill("Acme Search Fixture");
		await dialog.getByRole("button", { name: "Save job", exact: true }).click();
		await expect(page.getByRole("button", { name: "Open workspace" })).toBeVisible();
		params(page, { view, q: "Acme", closed: "true" });
		expect(new URL(page.url()).searchParams.has("create")).toBe(false);
		await page.keyboard.press("Escape");
		await expect(page.getByRole("button", { name: "Open workspace" })).toBeHidden();
	}

	await page.goto("/dashboard/applications?view=list&q=Acme&closed=true");
	await expect(page.getByRole("heading", { name: "Applications", level: 1 })).toBeVisible();
	await expect(page.locator("[data-application-id]")).toHaveCount(4);
});
