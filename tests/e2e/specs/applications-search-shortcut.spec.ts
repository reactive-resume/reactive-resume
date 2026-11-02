import { expect, test } from "../fixtures/test";

test("Applications search shortcut focuses every view without stealing typing or dialog focus", async ({
	authPage: page,
}, testInfo) => {
	for (const [company, role] of [
		["Fictional Cedar", "Product designer"],
		["Fictional Orbit", "Engineer"],
	]) {
		await expect(await page.request.post("/api/openapi/applications", { data: { company, role } })).toBeOK();
	}
	await page.goto("/dashboard/applications");
	const search = page.getByRole("searchbox", { name: "Search applications", exact: true });
	const save = page.getByRole("button", { name: "Save job", exact: true });
	await expect(search).toBeVisible();
	await save.focus();
	await page.keyboard.press("/");
	await expect(search).toBeFocused();
	await expect(search).toHaveValue("");
	await search.fill("Cedar");
	await expect(page.getByText("Product designer", { exact: true })).toBeVisible();
	await expect(page.getByText("Engineer", { exact: true })).toHaveCount(0);
	await page.keyboard.press("/");
	await expect(search).toHaveValue("Cedar/");
	await search.fill("");

	for (const view of ["Board", "Calendar", "Insights", "List"]) {
		const tab = page.getByRole("tab", { name: view, exact: true });
		await tab.click();
		await tab.focus();
		await page.keyboard.press("/");
		await expect(search).toBeFocused();
	}
	await search.fill("Cedar");
	await expect(page.getByText("Product designer", { exact: true })).toBeVisible();
	await expect(page.getByText("Engineer", { exact: true })).toHaveCount(0);
	await page.screenshot({ path: testInfo.outputPath("applications-search-shortcut.png"), animations: "disabled" });
	await search.fill("");

	const documents = page.getByRole("complementary").getByRole("link", { name: "Documents", exact: true });
	await documents.focus();
	await page.keyboard.press("/");
	await expect(documents).toBeFocused();

	await save.focus();
	await page.keyboard.press("Control+/");
	await expect(save).toBeFocused();
	await save.dispatchEvent("keydown", { key: "/", code: "Slash", isComposing: true });
	await expect(save).toBeFocused();
	await save.dispatchEvent("keydown", { key: "/", code: "Slash", keyCode: 229 });
	await expect(save).toBeFocused();

	await page.getByRole("button", { name: "More", exact: true }).click();
	await page.getByRole("menuitem", { name: "Import CSV…", exact: true }).click();
	const importing = page.getByRole("dialog", { name: "Import from CSV", exact: true, includeHidden: true });
	const csv = importing.getByLabel("CSV data", { exact: true });
	await csv.fill("Company,Role\nCedar,Designer");
	await csv.press("/");
	await expect(csv).toHaveValue("Company,Role\nCedar,Designer/");
	const close = importing.getByRole("button", { name: "Close", exact: true });
	await close.focus();
	await page.keyboard.press("/");
	await expect(close).toBeFocused();
	await close.click();
	await expect(importing).toHaveCount(0);
	await save.focus();
	await page.keyboard.press("/");
	await expect(search).toBeFocused();
});
