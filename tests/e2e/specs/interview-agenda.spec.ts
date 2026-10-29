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
	await expect(agenda).toContainText(/09:00.*10:00/);
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
	await expect(agenda).toContainText(/14:00.*15:00/);
	await page.getByRole("button", { name: "Next month", exact: true }).click();
	await expect(agenda).toContainText("Nothing scheduled yet");
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

for (const scenario of [
	{
		accountZone: "UTC",
		browserZone: "Europe/Berlin",
		now: "2026-10-31T23:15:00Z",
		at: ["2026-10-31T23:30:00Z", "2026-11-01T00:30:00Z"],
		month: "October 2026",
		count: "1 interview",
		days: ["Today", "Tomorrow"],
		times: ["23:30 – 00:30", "00:30 – 01:30"],
		nextMonth: "November 2026",
		nextCount: 1,
	},
	{
		accountZone: "Europe/Berlin",
		browserZone: "UTC",
		now: "2026-10-31T23:15:00Z",
		at: ["2026-10-31T23:30:00Z", "2026-11-01T00:30:00Z"],
		month: "November 2026",
		count: "2 interviews",
		days: ["Today"],
		times: ["00:30 – 01:30", "01:30 – 02:30"],
		nextMonth: "December 2026",
		nextCount: 0,
	},
	{
		accountZone: "Europe/Berlin",
		browserZone: "UTC",
		now: "2026-03-28T23:15:00Z",
		at: ["2026-03-29T00:30:00Z", "2026-03-29T22:30:00Z"],
		month: "March 2026",
		count: "2 interviews",
		days: ["Today", "Tomorrow"],
		times: ["01:30 – 03:30", "00:30 – 01:30"],
		nextMonth: "April 2026",
		nextCount: 0,
	},
	{
		accountZone: "UTC",
		browserZone: "Europe/Berlin",
		now: "2026-10-24T22:15:00Z",
		at: ["2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z"],
		month: "October 2026",
		count: "2 interviews",
		days: ["Tomorrow"],
		times: ["00:30 – 01:30", "01:30 – 02:30"],
		nextMonth: "November 2026",
		nextCount: 0,
	},
]) {
	test(`phone agenda uses account ${scenario.accountZone} in browser ${scenario.browserZone} at ${scenario.now}`, async ({
		authPage: page,
	}, testInfo) => {
		await page.setViewportSize({ width: 375, height: 812 });
		const session = await page.context().newCDPSession(page);
		await session.send("Emulation.setTimezoneOverride", { timezoneId: scenario.browserZone });
		await page.clock.setFixedTime(new Date(scenario.now));
		await expect(
			await page.request.post("/api/auth/update-user", {
				headers: { origin: String(testInfo.project.use.baseURL) },
				data: { timezone: scenario.accountZone },
			}),
		).toBeOK();
		const created = await page.request.post("/api/openapi/applications", {
			data: { company: "Northstar Labs", role: "Platform Engineer", status: "interview" },
		});
		await expect(created).toBeOK();
		const applicationId: string = await created.json();
		for (const at of scenario.at) {
			await expect(
				await page.request.post(`/api/openapi/applications/${applicationId}/interviews`, {
					data: { at, kind: "technical", durationMinutes: 60, timezone: "Europe/Berlin" },
				}),
			).toBeOK();
		}
		await page.goto("/dashboard/applications?view=calendar");
		const calendar = page.getByTestId("interview-calendar");
		const agenda = page.getByTestId("interview-agenda");
		await expect(calendar.getByRole("heading", { name: scenario.month, exact: true })).toBeVisible();
		await expect(calendar.getByText(scenario.count, { exact: true })).toBeVisible();
		await expect(agenda.getByRole("heading", { level: 4 })).toHaveText(scenario.days);
		const cards = agenda.locator("[data-upcoming-interview]");
		await expect(cards).toHaveCount(2);
		for (const [index, time] of scenario.times.entries()) await expect(cards.nth(index)).toContainText(time);
		const action = cards.first().getByRole("button", { name: "View application", exact: true });
		expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(44);
		await action.click();
		const details = page.getByRole("dialog", { name: "Platform Engineer", exact: true });
		await expect(details).toBeVisible();
		await details.getByRole("button", { name: "Close", exact: true }).click();
		await cards.first().getByRole("button").filter({ hasText: "Northstar Labs" }).click();
		const editor = page.getByRole("dialog", { name: "Edit interview", exact: true });
		await expect(editor.getByLabel("Time · Europe/Berlin", { exact: true })).toBeVisible();
		await editor.getByLabel("Location", { exact: true }).fill("Fictional meeting room");
		await editor.getByRole("button", { name: "Save interview", exact: true }).click();
		await expect(editor).not.toBeVisible();
		await expect(cards.first()).toContainText("Fictional meeting room");
		const saved = await page.request.get(`/api/openapi/applications/${applicationId}`);
		await expect(saved).toBeOK();
		const row = await saved.json();
		expect(
			row.activity
				.filter((entry: { type: string }) => entry.type === "interview")
				.map((entry: { at: string }) => entry.at)
				.sort(),
		).toEqual(scenario.at.map((at) => new Date(at).toISOString()).sort());
		await page.getByRole("button", { name: "Next month", exact: true }).click();
		await expect(calendar.getByRole("heading", { name: scenario.nextMonth, exact: true })).toBeVisible();
		await expect(cards).toHaveCount(scenario.nextCount);
		await page.getByRole("button", { name: "This month", exact: true }).click();
		await expect(cards).toHaveCount(2);
		await expect(agenda.getByRole("heading", { level: 4 })).toHaveText(scenario.days);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	});
}
