import { createSampleResumeFromDashboard, openSidebarSection } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test("adds an experience item and persists it across reloads", async ({ authPage: page }, testInfo) => {
	await createSampleResumeFromDashboard(page, testInfo);

	const company = `E2E Corp ${Date.now()}`;
	const position = "Principal Tester";

	await openSidebarSection(page, "Experience");
	await page.getByRole("button", { name: "Add experience", exact: true }).click();

	// The new draft opens in place with its first field focused; it saves as you type.
	const entry = page.locator("#sidebar-experience [data-entry-id]").last();
	await expect(entry.getByText("Draft", { exact: true })).toBeVisible();
	await expect(entry.getByRole("textbox", { name: "Position" })).toBeFocused();

	const savePromise = page.waitForResponse((response) => {
		if (!response.url().includes("/api/rpc")) return false;
		if (response.request().method() !== "POST") return false;
		if (!response.ok()) return false;
		return (response.request().postData() ?? "").includes(company);
	});
	await entry.getByRole("textbox", { name: "Position" }).fill(position);
	await entry.getByRole("textbox", { name: "Company" }).fill(company);
	await savePromise;

	// With a company it's no longer a draft, and its card reads "company · …"
	await expect(entry.getByText("Draft", { exact: true })).toHaveCount(0);
	await expect(page.getByText(company).filter({ visible: true }).first()).toBeVisible();

	// And it survives a full reload
	await page.reload();
	await openSidebarSection(page, "Experience");
	await expect(page.getByText(company).filter({ visible: true }).first()).toBeVisible();
	await expect(page.getByText(position).filter({ visible: true }).first()).toBeVisible();
});

test("keeps formatting controls accessible when tabbing from the editor", async ({ authPage: page }, testInfo) => {
	await createSampleResumeFromDashboard(page, testInfo);
	await openSidebarSection(page, "Summary");
	const summary = page.getByRole("textbox", { name: "Summary", exact: true });
	await summary.fill("Keyboard formatting");
	await summary.press("ControlOrMeta+A");
	expect(await summary.evaluate(() => window.getSelection()?.toString())).toBe("Keyboard formatting");
	await summary.press("Tab");
	const toolbar = page.getByRole("toolbar", { name: "Formatting" });
	const bold = toolbar.getByRole("button", { name: "Bold", exact: true });
	await expect(bold).toBeFocused();
	const wasBold = (await bold.getAttribute("aria-pressed")) === "true";
	await bold.press("Enter");
	await expect(bold).toHaveAttribute("aria-pressed", String(!wasBold));
	if (wasBold) await expect(summary.locator("strong")).toHaveCount(0);
	else await expect(summary.locator("strong")).toHaveText("Keyboard formatting");
	await expect(toolbar).toBeVisible();
});

test("contains phone entry focus and restores it without changing content", async ({ authPage: page }, testInfo) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await createSampleResumeFromDashboard(page, testInfo);
	await page.locator("#sidebar-experience").getByRole("button", { name: "Open Experience", exact: true }).click();
	const entry = page.locator("#sidebar-experience [data-entry-id]").first();
	const trigger = entry.getByRole("button", { name: /entry 1 of/ });
	await trigger.click();

	const dialog = page.getByRole("dialog");
	const back = dialog.getByRole("button", { name: "Experience", exact: true });
	const description = dialog.getByRole("textbox", { name: "Description", exact: true });
	const content = await description.innerHTML();
	const position = await dialog.getByRole("textbox", { name: "Position", exact: true }).inputValue();
	const addRole = dialog.getByRole("button", { name: "Add role", exact: true });
	await description.focus();
	await description.press("Tab");
	await expect(addRole).toBeFocused();
	await addRole.press("Tab");
	await expect(back).toBeFocused();
	await back.press("Shift+Tab");
	await expect(addRole).toBeFocused();

	const background = page.getByRole("button", { name: "Add experience", exact: true, includeHidden: true });
	await expect(page.getByRole("button", { name: "Add experience", exact: true })).toHaveCount(0);
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(trigger).toBeFocused();
	await expect(trigger).toBeInViewport();

	await trigger.press("Enter");
	await expect(back).toBeFocused();
	await expect(description).toHaveJSProperty("innerHTML", content);
	await expect(dialog.getByRole("textbox", { name: "Position", exact: true })).toHaveValue(position);
	await back.press("Enter");
	await expect(dialog).toBeHidden();
	await expect(trigger).toBeFocused();
	await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();

	await background.click();
	await expect(dialog.getByRole("textbox", { name: "Position", exact: true })).toBeFocused();
	await page.keyboard.press("Escape");
	await expect(dialog).toBeHidden();
	await expect(
		page
			.locator("#sidebar-experience [data-entry-id]")
			.last()
			.getByRole("button", { name: /Untitled, entry/ }),
	).toBeFocused();
});
