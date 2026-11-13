import { readFile, writeFile } from "node:fs/promises";
import { createSampleResumeFromDashboard, openDownloadDialog, openSidebarSection } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test("round-trips a JSON backup and splits a legacy embedded letter on import", async ({
	authPage: page,
}, testInfo) => {
	const importFromDocuments = async (file: string) => {
		await page.goto("/dashboard/documents");
		await expect(page.getByRole("heading", { name: "Documents", level: 1 })).toBeVisible();
		await page.getByRole("main").getByRole("link", { name: "Import", exact: true }).click();
		await expect(page.getByRole("heading", { name: "Import a resume", level: 1 })).toBeVisible();
		await page.getByLabel("Choose a file to import").setInputFiles(file);
		await page.getByRole("button", { name: "Open in editor" }).click();
	};
	await createSampleResumeFromDashboard(page, testInfo);

	const menu = await openDownloadDialog(page);
	const downloadPromise = page.waitForEvent("download");
	await menu.getByRole("button", { name: /^JSON/ }).click();
	const download = await downloadPromise;
	expect(download.suggestedFilename()).toMatch(/\.json$/);

	const downloadPath = testInfo.outputPath(download.suggestedFilename());
	await download.saveAs(downloadPath);
	const exportedData = JSON.parse(await readFile(downloadPath, "utf-8")) as {
		basics: { name: string };
		customSections: unknown[];
		metadata: { layout: { pages: { fullWidth: boolean; main: string[]; sidebar: string[] }[] } };
	};
	// A name only this file carries, so a builder that opens anything but the imported resume fails.
	exportedData.basics.name = `Imported ${Date.now()}`;
	await writeFile(downloadPath, JSON.stringify(exportedData));

	// Documents → Import, a page of its own: picking the file detects the format and imports it in three steps.
	await importFromDocuments(downloadPath);

	await page.waitForURL(/\/builder\/.+/);
	await openSidebarSection(page, "Basics");
	await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toHaveValue(exportedData.basics.name);

	// A file from an older version, with the letter inside the resume.
	exportedData.customSections.push({
		id: "old-letter",
		type: "cover-letter",
		title: "Letter to Globex",
		icon: "",
		columns: 1,
		hidden: false,
		keepTogether: false,
		startOnNewPage: false,
		items: [{ id: "old-letter-item", hidden: false, recipient: "<p>Globex</p>", content: "<p>Dear Globex team,</p>" }],
	});
	exportedData.metadata.layout.pages.push({ fullWidth: true, main: ["old-letter"], sidebar: [] });
	const path = testInfo.outputPath("with-letter.json");
	await writeFile(path, JSON.stringify(exportedData));

	await importFromDocuments(path);
	await page.waitForURL(/\/builder\/.+/);
	await expect(page.getByText("Dear Globex team,")).toHaveCount(0);

	await page.goto("/dashboard/documents");
	await page.getByRole("tab", { name: /^Letters/ }).click();
	await expect(page.getByRole("heading", { name: /— Letter to Globex$/ })).toHaveCount(1);
});
