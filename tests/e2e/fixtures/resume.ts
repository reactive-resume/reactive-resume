import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";
import { createResumeName } from "./data";

/**
 * Creates a sample resume named after the test and opens it in the editor. It goes through the API: the JSON import
 * spec covers the New dialog, and every other spec just needs a resume.
 */
export async function createSampleResumeFromDashboard(page: Page, testInfo: TestInfo) {
	const resumeName = createResumeName(testInfo);

	const response = await page.request.post("/api/openapi/resumes", {
		data: { name: resumeName, tags: [], withSampleData: true },
	});
	expect(response.ok()).toBe(true);
	const resumeId = (await response.json()) as string;

	await page.goto(`/builder/${resumeId}`);
	await page.waitForURL(/\/builder\/.+/);

	return resumeName;
}

export async function openSidebarSection(page: Page, title: string) {
	// Sharing is the Share mode, beside Write, Design and Check.
	if (title === "Sharing") {
		await page.getByRole("tab", { name: "Share", exact: true }).click();
		await expect(page.getByRole("textbox", { name: "Address" })).toBeVisible();
		return;
	}

	// Write: the Basics card is open by default; every other section is an outline row that opens on click.
	await page.getByRole("tab", { name: "Write", exact: true }).click();
	if (title === "Basics") {
		await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toBeVisible();
		return;
	}
	// A custom section can share a built-in's title (the sample has two "Experience" sections); prefer the built-in.
	const builtIn = page.locator(`#sidebar-${title.toLowerCase()}`).getByRole("button", { name: title, exact: true });
	const row = (await builtIn.count()) > 0 ? builtIn : page.getByRole("button", { name: title, exact: true }).first();
	await row.scrollIntoViewIfNeeded();
	if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
	await expect(row).toHaveAttribute("aria-expanded", "true");
}

/** Opens Download & history on its Download tab, from the ▾ next to Download PDF. */
export async function openDownloadDialog(page: Page) {
	await page.getByRole("button", { name: "More download formats", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "Download & history" });
	await expect(sheet.getByRole("tab", { name: "Download", exact: true })).toHaveAttribute("aria-selected", "true");
	return sheet;
}

/** Publishes the web page in Share mode and returns its address. */
export async function makeResumePublic(page: Page) {
	await openSidebarSection(page, "Sharing");
	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(page.getByRole("switch", { name: "Public link" })).toBeChecked();
	return getPublicUrl(page);
}

/** The web page's address, from Share's "Open web page" (it fills in once the session has loaded). */
export async function getPublicUrl(page: Page) {
	const link = page.getByRole("link", { name: "Open web page" });
	await expect(link).toHaveAttribute("href", /\/e2e_/);
	return (await link.getAttribute("href")) as string;
}
