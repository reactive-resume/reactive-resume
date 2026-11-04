import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";

async function resume(page: Page) {
	const created = await page.request.post("/api/openapi/resumes", {
		data: { name: "Fictional focus example", tags: [], withSampleData: true },
	});
	expect(created.ok()).toBe(true);
	const id = await created.json();
	const response = await page.request.get(`/api/openapi/resumes/${id}`);
	expect(response.ok()).toBe(true);
	const original = await response.json();
	const first = original.data.sections.experience.items[0];
	const entries = [
		{ ...structuredClone(first), position: "Fictional first role" },
		{
			...structuredClone(first),
			id: first.id.slice(0, -1) + (first.id.endsWith("a") ? "b" : "a"),
			position: "Fictional second role",
		},
	];
	const patched = await page.request.patch(`/api/openapi/resumes/${id}`, {
		data: { operations: [{ op: "replace", path: "/sections/experience/items", value: entries }] },
	});
	expect(patched.ok()).toBe(true);
	return { id, entries };
}

async function count(page: Page, id: string) {
	const response = await page.request.get(`/api/openapi/resumes/${id}`);
	expect(response.ok()).toBe(true);
	return (await response.json()).data.sections.experience.items.length;
}

test("deletion focuses a surviving entry then the retained section Add action", async ({ authPage: page }, info) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	const { id, entries } = await resume(page);
	await page.goto(`/builder/${id}`);
	await page.locator("#sidebar-experience").getByRole("button", { name: "Experience", exact: true }).click();
	const first = page.locator(`[data-entry-id="${entries[0].id}"]`);
	const second = page.locator(`[data-entry-id="${entries[1].id}"]`);
	const title = first.locator("button[aria-expanded]").first();
	await title.focus();
	await title.press("Alt+ArrowDown");
	await expect(title).toBeFocused();
	await expect(
		page
			.locator('[aria-live="polite"]')
			.filter({ hasText: /entry 2 of 2/ })
			.first(),
	).toContainText(entries[0].position);
	await title.click();
	await first.getByRole("button", { name: "Delete entry", exact: true }).click();
	await expect(second.locator("button[aria-expanded]").first()).toBeFocused();
	await second.locator("button[aria-expanded]").first().click();
	await second.getByRole("button", { name: "Delete entry", exact: true }).click();
	const add = page.getByRole("button", { name: "Add experience", exact: true });
	await expect(add).toBeFocused();
	await expect.poll(() => count(page, id)).toBe(0);
	await page
		.locator("#sidebar-experience")
		.screenshot({ path: info.outputPath("empty-experience.png"), animations: "disabled" });
	await add.press("Enter");
	await expect(page.locator("#sidebar-experience input:focus")).toHaveCount(1);
	await expect.poll(() => count(page, id)).toBe(1);
});

test("phone final deletion returns to its section Add action", async ({ authPage: page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const { id, entries } = await resume(page);
	const patch = await page.request.patch(`/api/openapi/resumes/${id}`, {
		data: { operations: [{ op: "replace", path: "/sections/experience/items", value: entries.slice(0, 1) }] },
	});
	expect(patch.ok()).toBe(true);
	await page.goto(`/builder/${id}`);
	await page.getByRole("button", { name: "Write", exact: true }).click();
	await page.locator("#sidebar-experience").getByRole("button", { name: "Experience", exact: true }).click();
	await page.locator(`[data-entry-id="${entries[0].id}"] button[aria-expanded]`).first().click();
	const sheet = page.getByRole("dialog", { name: entries[0].position, exact: true });
	await expect(sheet).toBeVisible();
	await sheet.getByRole("button", { name: "Delete entry", exact: true }).click();
	await expect(sheet).toBeHidden();
	await expect(page.getByRole("button", { name: "Add experience", exact: true })).toBeFocused();
	await expect.poll(() => count(page, id)).toBe(0);
});
