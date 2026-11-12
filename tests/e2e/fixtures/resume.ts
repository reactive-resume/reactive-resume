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

	// Write has one level at a time: return to its outline, then open the requested section.
	await page.getByRole("tab", { name: "Write", exact: true }).click();
	const back = page.getByRole("button", { name: "Sections", exact: true });
	if (await back.isVisible()) await back.click();
	const builtIn = page.locator(`#sidebar-${title.toLowerCase()}`).getByRole("button", { name: title, exact: true });
	const row = (await builtIn.count()) > 0 ? builtIn : page.getByRole("button", { name: title, exact: true }).first();
	await row.click();
	await expect(page.locator(`#sidebar-${title.toLowerCase()}`)).toBeVisible();
}

/** Opens the Download menu, the ▾ next to Download PDF: each format is a row that downloads it. */
export async function openDownloadDialog(page: Page) {
	await page.getByRole("button", { name: "More download formats", exact: true }).click();
	const menu = page.getByRole("dialog", { name: "Download", exact: true });
	await expect(menu.getByRole("textbox", { name: "File name" })).toBeVisible();
	return menu;
}

/** From Share's first level, opens Privacy and downloads (password, search engines, downloads, credit). */
export async function openSharePrivacy(page: Page) {
	await page.getByRole("button", { name: /^Privacy and downloads/ }).click();
	await expect(page.getByRole("heading", { name: "Privacy and downloads", level: 2 })).toBeVisible();
}

/** Back from a Share sub-page to its first level. */
export async function backToShare(page: Page) {
	await page
		.getByRole("navigation", { name: "Breadcrumb" })
		.getByRole("button", { name: "Share", exact: true })
		.click();
	await expect(page.getByRole("textbox", { name: "Address" })).toBeVisible();
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
