import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";

async function createApplication(page: Page, company: string, status = "offer", closedReason?: string) {
	const response = await page.request.post("/api/openapi/applications", {
		data: { company, role: "Product engineer", status, ...(closedReason ? { closedReason } : {}) },
	});
	await expect(response).toBeOK();
	return (await response.json()) as string;
}
async function offer(page: Page, applicationId: string, version: "verbal" | "written", base: number) {
	const response = await page.request.post("/api/openapi/career/offers", {
		data: { applicationId, version, base, currency: "EUR", period: "year", variable: null },
	});
	await expect(response).toBeOK();
	return (await response.json()) as { id: string };
}

test("contextual offers, accepted outcomes, version changes and application picker", async ({
	authPage: page,
}, info) => {
	await page.setViewportSize({ width: 1440, height: 1100 });
	const lumen = await createApplication(page, "Lumen Health");
	const verbal = await offer(page, lumen, "verbal", 90000);
	const written = await offer(page, lumen, "written", 98000);
	const accepted = await createApplication(page, "Northwind Labs", "closed", "accepted");
	await offer(page, accepted, "written", 101000);
	const rejected = await createApplication(page, "Example Archived", "closed", "not-selected");
	await createApplication(page, "Example Saved", "saved");
	const other = await createApplication(page, "Canopy Systems");
	await offer(page, other, "written", 95000);
	await page.goto(`/dashboard/applications/${lumen}/messages`);
	await page.getByRole("link", { name: "Compare offers" }).click();
	await expect(page).toHaveURL(new RegExp(`a=${written.id}`));
	await page.goto(`/dashboard/career/offers?a=${written.id}&b=${verbal.id}`);
	await expect(page.getByRole("heading", { name: "Changes since Verbal offer" })).toBeVisible();
	await expect(page.getByText("+€8,000 vs Verbal offer", { exact: true })).toBeVisible();
	await expect(page.getByText("Ask both", { exact: true })).toHaveCount(0);
	await page
		.getByRole("main")
		.screenshot({ animations: "disabled", path: info.outputPath("offer-version-changes.png") });
	const offers = await (await page.request.get("/api/openapi/career/saved?kind=offer")).json();
	const acceptedOffer = offers.find((row: { applicationId: string }) => row.applicationId === accepted);
	await page.goto(`/dashboard/career/offers?a=${acceptedOffer.id}&b=${written.id}`);
	await expect(page.getByText(/Written offer.*Accepted/)).toBeVisible();
	await expect(page.getByText("Ask Northwind Labs", { exact: true })).toHaveCount(0);
	await page.getByRole("main").screenshot({ animations: "disabled", path: info.outputPath("offers.png") });
	await page.getByRole("button", { name: "Add offer", exact: true }).click();
	const choices = page.getByLabel("Application", { exact: true });
	await expect(choices.locator(`option[value="${rejected}"]`)).toHaveCount(0);
	await expect(choices.locator("option").nth(1)).toContainText("Offer");
});

test("reload and close preserve preferences, messages, answers and notes without replaying stale drafts", async ({
	authPage: page,
}, info) => {
	const job = await createApplication(page, "Lumen Health", "saved");
	await page.goto("/dashboard/career/knowledge/preferences");
	const priorities = page.getByLabel("What matters to you");
	await priorities.fill("Time for mentoring and thoughtful work");
	await page.reload();
	await expect(priorities).toHaveValue("Time for mentoring and thoughtful work");
	const recovered = page.getByRole("button", { name: "Save recovered draft" });
	if (await recovered.isVisible()) await recovered.click();
	await expect
		.poll(async () => (await (await page.request.get("/api/openapi/career/profile")).json()).priorities)
		.toBe("Time for mentoring and thoughtful work");
	await page.goto(`/dashboard/applications/${job}/messages`);
	const message = page.getByLabel("Paste a message from Lumen Health");
	await message.fill("Please send availability for a technical discussion.");
	await page.reload();
	await expect(message).toHaveValue("Please send availability for a technical discussion.");
	await page.getByRole("main").screenshot({ animations: "disabled", path: info.outputPath("messages.png") });
	await page.goto(`/dashboard/applications/${job}/apply`);
	await page.getByRole("button", { name: "Add a question from the form", exact: true }).click();
	const question = page.getByRole("textbox", { name: "Question from the form", exact: true });
	await question.fill("Why this role?");
	await question.press("Tab");
	const answer = page.getByRole("textbox", { name: "Why this role?", exact: true });
	await answer.fill("I enjoy supporting reliable systems and mentoring teams.");
	await page.reload();
	await expect(page.getByRole("textbox", { name: "Why this role?", exact: true })).toHaveValue(
		"I enjoy supporting reliable systems and mentoring teams.",
	);
	await page.getByRole("main").screenshot({ animations: "disabled", path: info.outputPath("apply-recovery.png") });
	const notes = page.getByLabel("Notes", { exact: true });
	await notes.fill("Ask about the team and the timeline.");
	await page.reload();
	await expect(notes).toHaveValue("Ask about the team and the timeline.");
	await notes.fill("Keep this note when its tab closes.");
	const context = page.context();
	await page.close();
	const reopened = await context.newPage();
	await reopened.goto(`/dashboard/applications/${job}/apply`);
	await expect(reopened.getByLabel("Notes", { exact: true })).toHaveValue("Keep this note when its tab closes.");
});

test("follow-up writes project to Today and back, and attached PDFs count as sent", async ({
	authPage: page,
}, info) => {
	await page.setViewportSize({ width: 1440, height: 1100 });
	const job = await createApplication(page, "Lumen Health", "applied");
	const at = new Date(Date.now() + 3 * 86400000).toISOString();
	await expect(
		await page.request.patch(`/api/openapi/applications/${job}`, {
			data: { followUpAt: at, followUpNote: "Ask about the timeline" },
		}),
	).toBeOK();
	const response = await page.request.get("/api/openapi/career/schedules");
	await expect(response).toBeOK();
	const schedules = await response.json();
	const reminder = schedules.find((row: { applicationId: string }) => row.applicationId === job);
	expect(reminder).toMatchObject({ kind: "follow-up", query: "Ask about the timeline" });
	await page.goto("/dashboard/career");
	await expect(
		page.getByText("Lumen Health · Product engineer · Ask about the timeline", { exact: true }).first(),
	).toBeVisible();
	await page
		.getByText("Lumen Health · Product engineer · Ask about the timeline", { exact: true })
		.first()
		.scrollIntoViewIfNeeded();
	await page.getByRole("main").screenshot({ animations: "disabled", path: info.outputPath("today.png") });
	await page.goto(`/dashboard/applications/${job}/apply`);
	await page.getByRole("button", { name: "Attach a file instead", exact: true }).click();
	const large = Buffer.alloc(10 * 1024 * 1024 + 1);
	large.write("%PDF-1.4\n");
	await page
		.locator('input[type="file"][accept="application/pdf"]')
		.first()
		.setInputFiles({ name: "large.pdf", mimeType: "application/pdf", buffer: large });
	await expect(
		page.getByText("This PDF is larger than 10 MB. Compress it or export a smaller PDF, then attach it again."),
	).toBeVisible();
	const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF");
	await page
		.locator('input[type="file"][accept="application/pdf"]')
		.first()
		.setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: pdf });
	await expect
		.poll(async () => (await (await page.request.get(`/api/openapi/applications/${job}`)).json()).resumeFileUrl)
		.toBeTruthy();
	await page.goto("/dashboard/applications");
	const row = page.getByRole("row").filter({ hasText: "Lumen Health" });
	await expect(row.getByRole("cell", { name: "Resume file", exact: true })).toBeVisible();
	await row.click();
	await expect(page.getByLabel("Notes", { exact: true })).toBeVisible();
	await page.getByLabel("Notes", { exact: true }).scrollIntoViewIfNeeded();
	await page.screenshot({ animations: "disabled", path: info.outputPath("application-detail.png") });
});

test("unreadable and oversized photos keep the current photo and preserve the crop path in German", async ({
	authPage: page,
}, info) => {
	const created = await page.request.post("/api/openapi/resumes", { data: { name: "Morgan Vale", tags: [] } });
	await expect(created).toBeOK();
	const resumeId = await created.json();
	const resume = await (await page.request.get(`/api/openapi/resumes/${resumeId}`)).json();
	resume.data.basics.name = "Morgan Vale";
	await expect(await page.request.put(`/api/openapi/resumes/${resumeId}`, { data: { data: resume.data } })).toBeOK();
	await page.goto(`/builder/${resumeId}`);
	await page.getByRole("button", { name: "Add", exact: true }).first().click();
	const input = page.locator('input[type="file"][accept*="image"]').first();
	await input.setInputFiles({ name: "bad.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
	await expect(
		page.getByText("This file isn't a readable image. Choose a PNG, JPEG, WebP or GIF photo."),
	).toBeVisible();
	await expect(page.getByRole("dialog", { name: "Crop photo" })).toHaveCount(0);
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
		"base64",
	);
	await input.setInputFiles({
		name: "large.png",
		mimeType: "image/png",
		buffer: Buffer.concat([png, Buffer.alloc(11 * 1024 * 1024)]),
	});
	await expect(page.getByRole("button", { name: "Skip and upload", exact: true })).toBeDisabled();
	await expect(page.getByRole("button", { name: "Crop and upload", exact: true })).toBeEnabled();
	await page.getByRole("button", { name: "Crop and upload", exact: true }).click();
	await expect
		.poll(async () => (await (await page.request.get(`/api/openapi/resumes/${resumeId}`)).json()).data.picture.url)
		.not.toBe("");
	const savedPhoto = (await (await page.request.get(`/api/openapi/resumes/${resumeId}`)).json()).data.picture.url;
	await page.goto(`/builder/${resumeId}?locale=de-DE`);
	await expect(page.locator('canvas[aria-label^="Resume page"]').first()).toBeVisible({ timeout: 30000 });
	await expect(page.getByLabel(/Loading resume page/)).toHaveCount(0);
	await page
		.getByRole("button", { name: /Bearbeiten|Edit/ })
		.first()
		.click();
	await page
		.locator('input[type="file"][accept*="image"]')
		.first()
		.setInputFiles({ name: "bad.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
	await expect(
		page.getByText("Diese Datei ist kein lesbares Bild. Wähle ein Foto im Format PNG, JPEG, WebP oder GIF."),
	).toBeVisible();
	expect((await (await page.request.get(`/api/openapi/resumes/${resumeId}`)).json()).data.picture.url).toBe(savedPhoto);
	await page.screenshot({ path: info.outputPath("photo-error-de.png"), animations: "disabled" });
});
