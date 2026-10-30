import { readFile } from "node:fs/promises";
import { expect, test } from "../fixtures/test";

test("prepares documents and answers manually, then keeps submission separate from later drafts", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(120_000);
	await page.setViewportSize({ width: 1440, height: 1250 });
	const base = await page.request.post("/api/openapi/resumes", { data: { name: "Morgan Vale", tags: [] } });
	await expect(base).toBeOK();
	const baseId = (await base.json()) as string;
	const baseResume = await (await page.request.get(`/api/openapi/resumes/${baseId}`)).json();
	baseResume.data.basics.name = "Morgan Vale";
	baseResume.data.basics.headline = "Operations lead";
	await expect(await page.request.put(`/api/openapi/resumes/${baseId}`, { data: { data: baseResume.data } })).toBeOK();
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Harbor Labs", role: "Operations lead", status: "saved" },
	});
	await expect(created).toBeOK();
	const id = (await created.json()) as string;
	const application = async () => (await page.request.get(`/api/openapi/applications/${id}`)).json();

	await page.goto(`/dashboard/applications/${id}`);
	await expect(page.getByRole("tab", { name: "Apply", selected: true })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Save the job posting", exact: true })).toBeVisible();
	await expect(page.getByText("Step 1 of 6", { exact: true })).toBeVisible();
	await page
		.getByLabel("Job description", { exact: true })
		.fill("Lead customer onboarding and improve the setup process with the support team.");
	await page.getByRole("button", { name: "Save posting", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Choose a base resume", exact: true })).toBeVisible();
	await expect(
		page.getByText(/^No AI needed\. Edit documents and write answers yourself; nothing here is sent/),
	).toBeVisible();
	await page.getByRole("button", { name: "Copy a base resume for this job" }).click();
	await expect(page.getByRole("dialog")).toContainText("Harbor Labs");
	await page.getByRole("button", { name: "Create and open", exact: true }).click();
	await expect(page).toHaveURL(/\/builder\//);
	const selected = await application();
	expect(selected.status).toBe("saved");
	expect(selected.resumeId).not.toBe(baseId);
	await page.goto(`/dashboard/applications/${id}/apply`);
	await expect(page.getByRole("heading", { name: "Tailor and review your resume", exact: true })).toBeVisible();
	await expect(page.getByRole("combobox", { name: "Resume", exact: true })).toContainText("Harbor Labs");
	await page.getByRole("button", { name: "Cover letter options", exact: true }).click();
	await page.getByRole("menuitem", { name: "Write a letter", exact: true }).click();
	await expect(page).toHaveURL(/\/builder\/letter\//);
	const withLetter = await application();
	const letter = await (await page.request.get(`/api/openapi/cover-letters/${withLetter.coverLetterId}`)).json();
	await expect(
		await page.request.patch(`/api/openapi/cover-letters/${letter.id}`, {
			data: {
				expectedRevision: letter.revision,
				content: "<p>I coordinated customer onboarding with support and engineering.</p>",
			},
		}),
	).toBeOK();
	await page.goto(`/dashboard/applications/${id}/apply`);
	for (const menu of ["Resume options", "Cover letter options"]) {
		await page.getByRole("button", { name: menu, exact: true }).click();
		const download = page.waitForEvent("download");
		await page.getByRole("menuitem", { name: "Download PDF", exact: true }).click();
		const file = await download;
		const path = await file.path();
		if (!path) throw new Error("PDF download did not produce a file.");
		expect((await readFile(path)).subarray(0, 5).toString()).toBe("%PDF-");
	}
	await page.getByRole("button", { name: "Add a question from the form" }).click();
	await page.getByRole("textbox", { name: "Question from the form", exact: true }).fill("Why this role?");
	await page.getByRole("textbox", { name: "Question from the form", exact: true }).press("Enter");
	await page
		.getByRole("textbox", { name: "Why this role?" })
		.fill("I coordinated onboarding with support and engineering.");
	for (const label of [
		"Review the selected resume and cover letter in their editors.",
		"Check every claim, date and result against your experience.",
		"Review required form answers and remove unsupported claims.",
	]) {
		const checkbox = page.getByRole("checkbox", { name: label, exact: true });
		await checkbox.click();
		await expect(checkbox).toBeChecked();
	}
	await expect(
		page.getByRole("heading", { name: "Review readiness and record your submission", exact: true }),
	).toBeVisible();
	await expect(page.getByText("3 of 4", { exact: true })).toBeVisible();
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.getByRole("button", { name: "Copy answers", exact: true }).click();
	await expect
		.poll(() => page.evaluate(() => navigator.clipboard.readText()))
		.toBe("Why this role?\nI coordinated onboarding with support and engineering.");
	expect((await application()).status).toBe("saved");
	await page
		.getByRole("region", { name: "Application preparation" })
		.screenshot({ path: testInfo.outputPath("preparation.png") });
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(page.getByRole("button", { name: "Resume options", exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.setViewportSize({ width: 1440, height: 1250 });
	await page.getByRole("button", { name: "Mark as applied", exact: true }).click();
	await expect(
		page.getByRole("tabpanel", { name: "Apply" }).getByRole("heading", { name: "What you sent", exact: true }),
	).toBeVisible();
	await expect(page.getByText("3 of 3", { exact: true })).toBeVisible();
	const submitted = await application();
	expect(submitted).toMatchObject({ status: "applied", resumeId: selected.resumeId, coverLetterId: letter.id });
	expect(submitted.sentResumeVersionId).toBeTruthy();
	expect(submitted.sentCoverLetterVersionId).toBeTruthy();
	const snapshot = await (
		await page.request.get(`/api/openapi/resumes/${selected.resumeId}/versions/${submitted.sentResumeVersionId}`)
	).json();
	expect(snapshot.data.basics.headline).toBe("Operations lead");
	await page
		.getByRole("textbox", { name: "Why this role?" })
		.fill("I coordinated customer onboarding and wrote a support handoff guide.");
	await page.getByRole("textbox", { name: "Why this role?" }).blur();
	await page.getByRole("button", { name: "View recorded answers", exact: true }).click();
	await expect(page.getByText("You're looking at a saved version. It can't be edited.", { exact: true })).toBeVisible();
	await expect(page.getByText("I coordinated onboarding with support and engineering.", { exact: true })).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Why this role?" })).toHaveCount(0);
	await page.getByRole("button", { name: "Back to current", exact: true }).click();
	await expect(page.getByRole("textbox", { name: "Why this role?" })).toHaveValue(
		"I coordinated customer onboarding and wrote a support handoff guide.",
	);
	await expect(page.getByText("Marked as applied. The versions you sent are kept.", { exact: true })).toBeHidden();
	await page.screenshot({
		path: testInfo.outputPath("apply.jpg"),
		type: "jpeg",
		quality: 85,
		fullPage: true,
		animations: "disabled",
	});
});
