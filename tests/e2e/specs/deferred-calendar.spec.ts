import type { Download } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { expect, test } from "../fixtures/test";

async function calendarText(download: Download) {
	const path = await download.path();
	if (!path) throw new Error("Calendar download missing");
	return readFile(path, "utf8");
}

test("reschedule and committed deletion export the same calendar identity, while Undo never cancels it", async ({
	authPage: page,
}, testInfo) => {
	await page.clock.setFixedTime(new Date("2026-11-03T12:00:00Z"));
	await expect(await page.request.patch("/api/openapi/auth/profile", { data: { timezone: "UTC" } })).toBeOK();
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Calendar Protocol Labs", role: "Engineer", status: "interview" },
	});
	await expect(created).toBeOK();
	const id: string = await created.json();
	await expect(
		await page.request.post(`/api/openapi/applications/${id}/interviews`, {
			data: {
				at: "2026-11-10T14:00:00Z",
				kind: "technical",
				durationMinutes: 60,
				timezone: "UTC",
				participants: [{ name: "Maya Example", role: "Lead" }],
			},
		}),
	).toBeOK();
	const read = async () => {
		const response = await page.request.get(`/api/openapi/applications/${id}`);
		await expect(response).toBeOK();
		return response.json() as Promise<{ activity: { id: string; type: string; at: string }[] }>;
	};
	const round = (await read()).activity.find((entry) => entry.type === "interview");
	if (!round) throw new Error("Interview fixture missing");
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/dashboard/applications?view=calendar");
	const open = () =>
		page
			.getByTestId("interview-agenda")
			.getByRole("button")
			.filter({ hasText: "Calendar Protocol Labs" })
			.first()
			.click();
	const editor = page.getByRole("dialog", { name: "Edit interview", exact: true });
	await open();
	await editor.getByLabel("Time · UTC", { exact: true }).fill("15:30");
	await editor.getByRole("button", { name: "Save interview", exact: true }).click();
	await expect(editor).toBeHidden();
	await expect(page.getByRole("button", { name: "Update your calendar", exact: true })).toBeVisible();
	await expect(page.getByTestId("interview-agenda")).toContainText("03:30 PM");
	await page.screenshot({ path: testInfo.outputPath("phone-calendar-update.png"), fullPage: true });
	const updatedDownload = page.waitForEvent("download");
	await page.getByRole("button", { name: "Update your calendar", exact: true }).click();
	const updated = await calendarText(await updatedDownload);
	expect(updated).toContain(`UID:${round.id}@reactive-resume`);
	expect(updated).toContain("METHOD:PUBLISH");
	expect(updated).toContain("DTSTART:20261110T153000Z");
	expect(updated).toContain("Maya Example\\, Lead");
	expect(updated).toContain("BEGIN:VALARM");
	await expect
		.poll(async () => (await read()).activity.find((entry) => entry.id === round.id)?.at)
		.toBe("2026-11-10T15:30:00.000Z");

	await open();
	await editor.getByRole("button", { name: "Delete", exact: true }).click();
	await expect(page.getByRole("button", { name: "Download cancellation", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	expect((await read()).activity.some((entry) => entry.id === round.id)).toBe(true);
	await expect(page.getByRole("button", { name: "Download cancellation", exact: true })).toHaveCount(0);

	await open();
	await editor.getByRole("button", { name: "Delete", exact: true }).click();
	await expect
		.poll(async () => (await read()).activity.some((entry) => entry.id === round.id), { timeout: 15_000 })
		.toBe(false);
	await expect(page.getByRole("button", { name: "Download cancellation", exact: true })).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("phone-calendar-cancellation.png"), fullPage: true });
	const canceledDownload = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download cancellation", exact: true }).click();
	const canceled = await calendarText(await canceledDownload);
	expect(canceled).toContain(`UID:${round.id}@reactive-resume`);
	expect(canceled).toContain("METHOD:CANCEL");
	expect(canceled).toContain("STATUS:CANCELLED");
	expect(canceled).not.toContain("BEGIN:VALARM");
	const sequence = (text: string) => Number(text.match(/SEQUENCE:(\d+)/)?.[1]);
	expect(sequence(canceled)).toBeGreaterThan(sequence(updated));

	// The Activity menu commits after confirmation rather than an Undo window.
	await expect(
		await page.request.post(`/api/openapi/applications/${id}/interviews`, {
			data: { at: "2026-11-11T14:00:00Z", kind: "technical", timezone: "UTC" },
		}),
	).toBeOK();
	const nextRound = (await read()).activity.find((entry) => entry.type === "interview");
	if (!nextRound) throw new Error("Confirmed-delete fixture missing");
	await page.reload();
	await page.getByRole("button", { name: "View application", exact: true }).click();
	const activity = page.getByRole("region", { name: "Activity", exact: true });
	await activity.getByRole("button", { name: "Options for this entry", exact: true }).first().click();
	await page.getByRole("menuitem", { name: "Delete…", exact: true }).click();
	const confirm = page.getByRole("alertdialog");
	await expect(confirm).toContainText("Download a cancellation afterward");
	await confirm.getByRole("button", { name: "Delete interview", exact: true }).click();
	await expect.poll(async () => (await read()).activity.some((entry) => entry.id === nextRound.id)).toBe(false);
	const confirmedDownload = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download cancellation", exact: true }).click();
	const confirmed = await calendarText(await confirmedDownload);
	expect(confirmed).toContain(`UID:${nextRound.id}@reactive-resume`);
	expect(confirmed).toContain("METHOD:CANCEL");
});
