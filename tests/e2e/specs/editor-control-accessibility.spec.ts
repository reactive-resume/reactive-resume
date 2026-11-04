import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";
async function resume(page: Page) {
	const r = await page.request.post("/api/openapi/resumes", {
		data: { name: "Fictional accessible resume", tags: [], withSampleData: true },
	});
	await expect(r).toBeOK();
	return r.json();
}
test("resume page keyboard focus remains visible", async ({ authPage: page }) => {
	const id = await resume(page);
	await page.goto(`/builder/${id}`);
	await page.keyboard.press("Tab");
	const region = page.getByRole("region", { name: "Resume page", exact: true });
	await region.focus();
	await expect(region).toBeFocused();
	await expect(region).toHaveCSS("outline-style", "solid");
	await expect(region).toHaveCSS("outline-width", "2px");
	expect(await region.evaluate((e) => e.matches(":focus-visible"))).toBe(true);
});
test("touch editor controls expose44px targets and keep section actions reachable", async ({
	authPage: page,
	browser,
}) => {
	const id = await resume(page);
	const context = await browser.newContext({
		hasTouch: true,
		viewport: { width: 820, height: 1180 },
		storageState: await page.context().storageState(),
	});
	const touch = await context.newPage();
	try {
		await touch.goto(`/builder/${id}`);
		await touch.getByRole("button", { name: "Show panel", exact: true }).click();
		await expect(touch.getByRole("complementary", { name: "Editor", exact: true })).toBeVisible();
		const menu = touch.getByRole("button", { name: "Document menu: Fictional accessible resume", exact: true });
		const controls = [
			touch.getByRole("button", { name: "Zoom in", exact: true }),
			touch.getByRole("button", { name: "Zoom out", exact: true }),
			touch.getByRole("button", { name: "Fit page to width", exact: true }),
			menu,
			touch.getByRole("button", { name: "Reorder Experience", exact: true }),
			touch.locator("#sidebar-experience").getByRole("button", { name: "Experience", exact: true }),
		];
		for (const control of controls) {
			await expect(control).toBeVisible();
			expect(
				await control.evaluate((e) => {
					const r = e.getBoundingClientRect();
					return [getComputedStyle(e), getComputedStyle(e, "::before"), getComputedStyle(e, "::after")].some(
						(c) =>
							Math.max(r.width, Number.parseFloat(c.width) || 0) >= 44 &&
							Math.max(r.height, Number.parseFloat(c.height) || 0) >= 44,
					);
				}),
			).toBe(true);
		}
		await expect(touch.getByText(/drag ·/)).toBeHidden();
		await touch.locator("#sidebar-experience").getByRole("button", { name: "Experience", exact: true }).tap();
		await expect(touch.getByRole("button", { name: "Add experience", exact: true })).toBeVisible();
		const box = await menu.boundingBox();
		if (!box) throw Error("missing menu");
		await touch.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 4);
		await expect(touch.getByRole("menuitem", { name: "Tags…", exact: true })).toBeVisible();
	} finally {
		await context.close();
	}
});

test("touch document hit area leaves failed-save Retry usable", async ({ authPage: page, browser }) => {
	const id = await resume(page);
	const context = await browser.newContext({
		hasTouch: true,
		viewport: { width: 820, height: 1180 },
		storageState: await page.context().storageState(),
	});
	const touch = await context.newPage();
	try {
		await touch.goto(`/builder/${id}`);
		await touch.getByRole("button", { name: "Show panel", exact: true }).click();
		await expect(touch.getByRole("complementary", { name: "Editor", exact: true })).toBeVisible();
		await touch.route("**/api/rpc/resume/update", (route) =>
			route.fulfill({
				status: 500,
				contentType: "application/json",
				body: JSON.stringify({
					json: { defined: false, code: "INTERNAL_SERVER_ERROR", status: 500, message: "Fictional save unavailable" },
				}),
			}),
		);
		await touch.getByRole("textbox", { name: "Full name", exact: true }).fill("Riley Harper");
		await expect(touch.getByRole("alert").filter({ hasText: "Not saved" })).toBeVisible();
		const retry = touch.getByRole("button", { name: "Retry saving", exact: true });
		await expect(retry).toBeVisible();
		expect(await retry.evaluate((e) => e.closest('[role="status"],[role="alert"]'))).toBeNull();
		await touch.unroute("**/api/rpc/resume/update");
		await retry.tap();
		await expect
			.poll(async () => {
				const response = await touch.request.get(`/api/openapi/resumes/${id}`);
				expect(response.ok()).toBe(true);
				return (await response.json()).data.basics.name;
			})
			.toBe("Riley Harper");
		await expect(touch.getByRole("menu")).toHaveCount(0);
	} finally {
		await context.close();
	}
});
