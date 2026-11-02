import { expect, test } from "../fixtures/test";

test("shortcut help follows the current page and the character-key off switch survives reload", async ({
	authPage: page,
}, testInfo) => {
	await page.goto("/dashboard");
	const help = page.getByRole("button", { name: "Keyboard shortcuts", exact: true });
	await help.click();
	const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
	await expect(dialog.getByText("Search documents", { exact: true })).toBeVisible();
	await expect(dialog.getByText("Download PDF", { exact: true })).toHaveCount(0);
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await expect(help).toBeFocused();

	await expect(
		await page.request.post("/api/openapi/applications", {
			data: { company: "Fictional Cedar", role: "Product designer" },
		}),
	).toBeOK();
	await expect(
		await page.request.post("/api/openapi/applications", {
			data: { company: "Fictional Orbit", role: "Platform engineer", status: "applied" },
		}),
	).toBeOK();
	await page.goto("/dashboard/applications");
	const search = page.getByRole("searchbox", { name: "Search applications", exact: true });
	const save = page.getByRole("button", { name: "Save job", exact: true });
	await expect(search).toBeVisible();
	await save.focus();
	await page.keyboard.press("Shift+?");
	await expect(dialog.getByText("Search applications", { exact: true })).toBeVisible();
	await expect(dialog.getByText("Search documents", { exact: true })).toHaveCount(0);
	for (const name of [
		"Next application",
		"Previous application",
		"Open application",
		"Toggle selection",
		"Followed up",
	])
		await expect(dialog.locator("dt").filter({ hasText: new RegExp(`^${name}$`) })).toHaveCount(1);
	await page.keyboard.press("x");
	await page.screenshot({ path: testInfo.outputPath("keyboard-shortcuts.png"), animations: "disabled" });
	await dialog.getByRole("switch", { name: "Single-character shortcuts" }).click();
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await expect(save).toBeFocused();
	await expect(page.getByRole("checkbox", { name: "Select Product designer at Fictional Cedar" })).not.toBeChecked();
	await page.reload();
	await expect(search).toBeVisible();
	await save.focus();
	await page.keyboard.press("Shift+?");
	await page.keyboard.press("n");
	await page.keyboard.press("/");
	await expect(save).toBeFocused();
	await expect(search).not.toHaveAttribute("aria-keyshortcuts");
	await expect(page.getByRole("button", { name: "New", exact: true })).not.toHaveAttribute("aria-keyshortcuts");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await help.click();
	await expect(dialog.getByRole("switch", { name: "Single-character shortcuts" })).not.toBeChecked();
	await dialog.getByRole("button", { name: "Close", exact: true }).click();

	const created = await page.request.post("/api/openapi/resumes", {
		data: { name: "Fictional Cedar resume", tags: [] },
	});
	await expect(created).toBeOK();
	const id: string = await created.json();
	await page.goto(`/builder/${id}`);
	await expect(help).toBeVisible();
	await help.focus();
	await page.keyboard.press("2");
	await expect(page).not.toHaveURL(/mode=design/);
	await expect(page.getByRole("tab", { name: "Design", exact: true })).not.toHaveAttribute("aria-keyshortcuts");
	await help.click();
	await expect(dialog.getByText("Download PDF", { exact: true })).toBeVisible();
	await expect(dialog.getByText("New", { exact: true })).toHaveCount(0);
	await dialog.getByRole("switch", { name: "Single-character shortcuts" }).click();
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await page.keyboard.press("2");
	await expect(page).toHaveURL(/mode=design/);
	const documentMenu = page.getByRole("button", { name: "Document menu: Fictional Cedar resume", exact: true });
	await documentMenu.click();
	await page.getByRole("menuitem", { name: "Keyboard shortcuts", exact: true }).click();
	await expect(dialog.getByText("Download PDF", { exact: true })).toBeVisible();
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await expect(documentMenu).toBeFocused();
	await page.keyboard.press("ControlOrMeta+k");
	const palette = page.getByRole("dialog", { name: "Command palette", exact: true });
	await palette.getByRole("combobox").fill("Keyboard shortcuts");
	await palette.getByRole("option", { name: "Keyboard shortcuts", exact: true }).click();
	await expect(dialog.getByText("Download PDF", { exact: true })).toBeVisible();
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await page.goto("/dashboard/settings/preferences");
	await expect(page.getByRole("switch", { name: "Single-character shortcuts" })).toBeChecked();
});
