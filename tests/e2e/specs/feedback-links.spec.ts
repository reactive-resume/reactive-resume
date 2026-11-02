import { openSidebarSection } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test("a reviewer reads the shared version, comments, and loses access once the link is turned off", async ({
	authPage: page,
	browser,
}) => {
	const resumeResponse = await page.request.post("/api/openapi/resumes", {
		data: { name: "Coach review", tags: [], withSampleData: true },
	});
	await expect(resumeResponse).toBeOK();
	const resumeId: string = await resumeResponse.json();
	const jobResponse = await page.request.post("/api/openapi/applications", {
		data: { company: "Lumen Labs", role: "Platform Engineer", notes: "Private salary talk" },
	});
	await expect(jobResponse).toBeOK();
	const applicationId: string = await jobResponse.json();

	const linkResponse = await page.request.post("/api/openapi/feedback-links", {
		data: { resumeId, label: "Coach Ana", allowComments: true, applicationIds: [applicationId] },
	});
	await expect(linkResponse).toBeOK();
	const link: { id: string; url: string } = await linkResponse.json();
	const path = new URL(link.url).pathname;

	const reviewer = await browser.newContext();
	try {
		const review = await reviewer.newPage();
		await review.goto(path);
		await expect(review.getByRole("heading", { level: 1 })).toContainText("asked for your feedback");
		await expect(review.getByText("Platform Engineer · Lumen Labs")).toBeVisible();
		await expect(review.getByText("Private salary talk")).toHaveCount(0);
		await review.getByLabel("Your name").fill("Ana");
		await review.getByLabel("Comment", { exact: true }).fill("Lead with the migration project.");
		await review.getByRole("button", { name: "Send comment" }).click();
		await expect(review.getByText("Lead with the migration project.")).toBeVisible();

		// The owner sees the comment; it never changes the resume.
		const detail = await (await page.request.get(`/api/openapi/feedback-links/${link.id}`)).json();
		expect(detail.comments).toEqual([expect.objectContaining({ authorName: "Ana" })]);

		await expect(await page.request.post(`/api/openapi/feedback-links/${link.id}/revoke`)).toBeOK();
		await review.reload();
		await expect(review.getByRole("heading", { name: "This link was turned off" })).toBeVisible();
	} finally {
		await reviewer.close();
	}
});

test("the owner makes a feedback link from Share", async ({ authPage: page }) => {
	const resumeResponse = await page.request.post("/api/openapi/resumes", {
		data: { name: "Share feedback", tags: [], withSampleData: true },
	});
	await expect(resumeResponse).toBeOK();
	const resumeId: string = await resumeResponse.json();
	await page.goto(`/builder/${resumeId}`);
	await openSidebarSection(page, "Sharing");
	await page.getByRole("button", { name: "New feedback link" }).click();
	const dialog = page.getByRole("dialog", { name: "New feedback link" });
	await dialog.getByLabel("Who is it for?").fill("Careers office");
	await dialog.getByRole("button", { name: "Make link" }).click();
	await expect(page.getByRole("dialog", { name: "Careers office" })).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Feedback link" })).toHaveValue(/\/feedback\/[^/]+~[^/]+$/);
});
