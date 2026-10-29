import { expect, test } from "../fixtures/test";

test("Calendar keeps an editable month agenda on phone widths and direct links", async ({
	authPage: page,
}, testInfo) => {
	const session = await page.context().newCDPSession(page);
	await session.send("Emulation.setTimezoneOverride", { timezoneId: "UTC" });
	await page.clock.setFixedTime(new Date("2026-10-29T08:00:00Z"));
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Northstar Labs", role: "Platform Engineer", status: "interview" },
	});
	await expect(created).toBeOK();
	const applicationId: string = await created.json();
	for (const at of ["2026-10-30T09:00:00Z", "2026-11-04T14:00:00Z"]) {
		await expect(
			await page.request.post(`/api/openapi/applications/${applicationId}/interviews`, {
				data: { at, kind: "technical", durationMinutes: 60, timezone: "UTC" },
			}),
		).toBeOK();
	}
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto("/dashboard/applications?view=calendar");
	await expect(page.getByTestId("interview-month-grid")).toBeVisible();
	await page.setViewportSize({ width: 375, height: 812 });
	await expect(page.getByRole("tab", { name: "Calendar", exact: true })).toHaveAttribute("aria-selected", "true");
	await expect(page.getByTestId("interview-month-grid")).toHaveCount(0);
	await page.reload();
	await expect(page.getByRole("tab", { name: "Calendar", exact: true })).toHaveAttribute("aria-selected", "true");
	const agenda = page.getByTestId("interview-agenda");
	await expect(agenda.getByText("Northstar Labs", { exact: true })).toHaveCount(2);
	await expect(agenda.getByRole("heading", { name: "Tomorrow", exact: true })).toBeVisible();
	await expect(agenda).toContainText(/9:00 AM.*10:00 AM/);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath("phone-interview-agenda.png"), fullPage: true });

	await agenda.getByRole("button").filter({ hasText: "Northstar Labs" }).first().click();
	const editor = page.getByRole("dialog", { name: "Edit interview", exact: true });
	await expect(editor.getByLabel("Date", { exact: true })).toHaveValue("2026-10-30");
	await editor.getByLabel("Location", { exact: true }).fill("Fictional meeting room");
	await editor.getByRole("button", { name: "Save interview", exact: true }).click();
	await expect(editor).not.toBeVisible();
	await expect(agenda).toContainText("Fictional meeting room");
	await agenda.getByRole("button", { name: "View application", exact: true }).first().click();
	const details = page.getByRole("dialog", { name: "Platform Engineer", exact: true });
	await expect(details).toContainText("Platform Engineer");
	await details.getByRole("button", { name: "Close", exact: true }).click();

	await page.getByRole("button", { name: "Next month", exact: true }).click();
	await expect(page.getByRole("heading", { name: "November 2026", exact: true })).toBeVisible();
	await expect(agenda.getByRole("heading", { name: /November 4/ })).toBeVisible();
	await expect(agenda).toContainText(/2:00 PM.*3:00 PM/);
	await page.getByRole("button", { name: "Next month", exact: true }).click();
	await expect(agenda).toContainText("No interviews this month");
	await page.getByRole("button", { name: "Previous month", exact: true }).click();
	await expect(agenda.getByText("Northstar Labs", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "This month", exact: true }).click();
	await expect(agenda.getByRole("heading", { name: "Tomorrow", exact: true })).toBeVisible();
	await expect(agenda.getByText("Northstar Labs", { exact: true })).toHaveCount(2);
	await page.getByRole("tab", { name: "List", exact: true }).click();
	await page.getByRole("tab", { name: "Calendar", exact: true }).click();
	await expect(agenda.getByText("Northstar Labs", { exact: true })).toHaveCount(2);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
