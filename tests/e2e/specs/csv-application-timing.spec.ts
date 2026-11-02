import { readFile } from "node:fs/promises";
import { expect, test } from "../fixtures/test";

test("CSV preserves submission dates and omits unknown stage timing from first-reply median", async ({
	authPage: page,
}, testInfo) => {
	await page.goto("/dashboard/applications");
	await page.getByRole("button", { name: "More", exact: true }).click();
	await page.getByRole("menuitem", { name: "Import CSV…", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "Import from CSV", exact: true });
	await sheet
		.getByLabel("CSV data", { exact: true })
		.fill(
			"Company,Role,Stage,Applied Date,Stage Date\nFictional Orbit,Undated offer,offer,2026-09-30,\nFictional Cedar,Dated interview,interview,2026-09-30,2026-10-05\nFictional Willow,Unknown submission,screening,,",
		);
	await sheet.getByRole("button", { name: "Import 3 applications", exact: true }).click();
	await expect(sheet).not.toBeVisible();
	const response = await page.request.get("/api/openapi/applications");
	await expect(response).toBeOK();
	const rows = await response.json();
	const dated = rows.find((row: { role: string }) => row.role === "Dated interview");
	expect(dated.appliedAt.slice(0, 10)).toBe("2026-09-30");
	await page.getByText("Undated offer", { exact: true }).click();
	const detail = page.getByRole("dialog", { name: "Undated offer", exact: true });
	const activity = detail.getByRole("region", { name: "Activity", exact: true });
	const imported = activity.getByRole("listitem").filter({ hasText: "Imported · Offer" });
	await expect(imported).toContainText("Not recorded");
	await expect(detail.getByText(/since today|for \d+ days?/)).toHaveCount(0);
	await activity.screenshot({ path: testInfo.outputPath("imported-unknown-stage-date.png"), animations: "disabled" });
	await detail.getByRole("button", { name: "Close", exact: true }).click();

	await page.getByRole("button", { name: "More", exact: true }).click();
	await page.getByRole("menuitem", { name: "Export CSV…", exact: true }).click();
	const exporting = page.getByRole("dialog", { name: "Export applications", exact: true });
	await exporting.getByLabel("Application date from", { exact: true }).fill("2026-09-30");
	await expect(exporting.getByText("2 applications to export", { exact: true })).toBeVisible();
	await exporting.getByLabel("Application date from", { exact: true }).fill("");
	const downloading = page.waitForEvent("download");
	await exporting.getByRole("button", { name: "Download CSV", exact: true }).click();
	const path = await (await downloading).path();
	if (!path) throw new Error("CSV download missing");
	const csv = await readFile(path, "utf8");
	expect(csv).toContain('"Fictional Orbit","Undated offer","offer","Offer","offer","","","2026-09-30"');
	expect(csv).toContain('"Fictional Willow","Unknown submission","screening","Screening","screening","","",""');
	expect(csv).toContain("Offer (date not recorded)");

	await page.getByRole("tab", { name: "Insights", exact: true }).click();
	await expect(page.getByText("median to first reply", { exact: true }).locator("..")).toContainText("5 days");
	await page.getByRole("tab", { name: "List", exact: true }).click();
	await page.getByText("Undated offer", { exact: true }).click();
	await imported.getByRole("button", { name: "Options for this entry", exact: true }).click();
	await page.getByRole("menuitem", { name: "Edit…", exact: true }).click();
	const editing = page.getByRole("dialog", { name: "Edit date", exact: true });
	await expect(editing.getByLabel("Date", { exact: true })).toHaveValue("");
	await expect(editing.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
	await editing.getByLabel("Date", { exact: true }).fill("2026-10-07");
	await editing.getByRole("button", { name: "Save", exact: true }).click();
	await expect(editing).not.toBeVisible();
	await expect(activity.getByText("Imported · Offer", { exact: true })).toHaveCount(0);
	await detail.getByRole("button", { name: "Close", exact: true }).click();
	await page.reload();
	const updated = await (await page.request.get("/api/openapi/applications")).json();
	expect(updated.find((row: { role: string }) => row.role === "Undated offer").activity).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ stage: "offer", dateUnknown: false, at: expect.stringMatching(/^2026-10-07T/) }),
		]),
	);
	await page.getByRole("tab", { name: "Insights", exact: true }).click();
	await expect(page.getByText("median to first reply", { exact: true }).locator("..")).toContainText("6 days");
});
