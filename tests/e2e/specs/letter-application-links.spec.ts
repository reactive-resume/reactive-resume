import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";

async function createFixture(page: Page) {
	// Wide enough for the 480px details sheet to sit fully on screen in the guide capture.
	await page.setViewportSize({ width: 1600, height: 1000 });
	const jobResponse = await page.request.post("/api/openapi/applications", {
		data: { company: "Lumen Labs", role: "Platform Engineer" },
	});
	await expect(jobResponse).toBeOK();
	const applicationId: string = await jobResponse.json();
	const letterResponse = await page.request.post("/api/openapi/cover-letters", {
		data: { name: "Lumen letter", content: "<p>I build reliable systems.</p>" },
	});
	await expect(letterResponse).toBeOK();
	const letter = await letterResponse.json();
	return { applicationId, letter };
}

test("links a prepared letter from application details and returns to the same job record", async ({
	authPage: page,
}, testInfo) => {
	const { applicationId, letter } = await createFixture(page);
	await page.goto(`/dashboard/applications?applicationId=${applicationId}`);
	await page.getByLabel("Use an existing letter").selectOption(letter.id);
	await expect(page.getByRole("link", { name: "Open", exact: true })).toHaveAttribute(
		"href",
		new RegExp(`/builder/letter/${letter.id}`),
	);
	await expect
		.poll(
			async () =>
				(await (await page.request.get(`/api/openapi/cover-letters/${letter.id}`)).json()).sourceApplicationId,
		)
		.toBe(applicationId);
	await page.screenshot({ animations: "disabled", path: testInfo.outputPath("application-detail.png") });
	await page.goto(`/builder/letter/${letter.id}`);
	await page.getByRole("link", { name: "Back to Lumen Labs" }).click();
	// The list consumes ?applicationId= and opens the record, so assert the sheet itself rather than a transient URL.
	const detail = page.getByRole("dialog");
	await expect(detail.getByRole("heading", { name: "Platform Engineer" })).toBeVisible();
	await expect(detail.getByLabel("Use an existing letter")).toHaveValue(letter.id);

	await page.goto(`/dashboard/applications/${applicationId}/apply`);
	await page.getByRole("link", { name: "Stage, details and timeline" }).click();
	await expect(page.getByLabel("Log an update")).toBeVisible();
	await expect(
		page.getByText("Dated updates. For things to remember and share with the coach, use Notes."),
	).toBeVisible();
});

test("submitted letter targets are disabled and stale HTTP links cannot replace sent snapshots", async ({
	authPage: page,
}, testInfo) => {
	const { applicationId, letter } = await createFixture(page);
	await expect(
		await page.request.post("/api/openapi/documents/application", {
			data: { type: "letter", id: letter.id, applicationId },
		}),
	).toBeOK();
	const applied = await page.request.patch(`/api/openapi/applications/${applicationId}`, {
		data: { status: "applied" },
	});
	await expect(applied).toBeOK();
	const submitted = await (await page.request.get(`/api/openapi/applications/${applicationId}`)).json();
	expect(submitted.sentCoverLetterVersionId).toEqual(expect.any(String));
	const otherResponse = await page.request.post("/api/openapi/cover-letters", { data: { name: "Another letter" } });
	await expect(otherResponse).toBeOK();
	const other = await otherResponse.json();
	await page.goto(`/builder/letter/${other.id}`);
	await page.getByRole("button", { name: "Link an application" }).click();
	await expect(
		page.getByRole("menuitem", { name: /Platform Engineer.*Lumen Labs.*Letter already sent/ }),
	).toBeDisabled();
	await expect(page.getByRole("status", { name: "Loading", exact: true })).toHaveCount(0);
	await page.screenshot({ animations: "disabled", path: testInfo.outputPath("submitted-letter-picker.png") });
	const refused = await page.request.post("/api/openapi/documents/application", {
		data: { type: "letter", id: other.id, applicationId },
	});
	expect(refused.status()).toBe(400);
	expect(await refused.json()).toMatchObject({ data: { reason: "SUBMITTED_DOCUMENT_LOCKED" } });
	const unchanged = await (await page.request.get(`/api/openapi/applications/${applicationId}`)).json();
	expect(unchanged.coverLetterId).toBe(letter.id);
	expect(unchanged.sentCoverLetterVersionId).toBe(submitted.sentCoverLetterVersionId);
});

test("application-side create and edit keep the letter's job in step over HTTP", async ({ authPage: page }) => {
	const letterResponse = await page.request.post("/api/openapi/cover-letters", { data: { name: "Prepared letter" } });
	await expect(letterResponse).toBeOK();
	const letter: { id: string } = await letterResponse.json();

	const firstResponse = await page.request.post("/api/openapi/applications", {
		data: { company: "Lumen Labs", role: "First role", coverLetterId: letter.id },
	});
	await expect(firstResponse).toBeOK();
	const firstId: string = await firstResponse.json();
	expect((await (await page.request.get(`/api/openapi/applications/${firstId}`)).json()).coverLetterId).toBe(letter.id);
	expect((await (await page.request.get(`/api/openapi/cover-letters/${letter.id}`)).json()).sourceApplicationId).toBe(
		firstId,
	);

	const secondResponse = await page.request.post("/api/openapi/applications", {
		data: { company: "Orbit Labs", role: "Second role", coverLetterId: letter.id },
	});
	await expect(secondResponse).toBeOK();
	const secondId: string = await secondResponse.json();
	expect((await (await page.request.get(`/api/openapi/applications/${secondId}`)).json()).coverLetterId).toBe(
		letter.id,
	);
	expect((await (await page.request.get(`/api/openapi/applications/${firstId}`)).json()).coverLetterId).toBeNull();
	expect((await (await page.request.get(`/api/openapi/cover-letters/${letter.id}`)).json()).sourceApplicationId).toBe(
		secondId,
	);

	const otherResponse = await page.request.post("/api/openapi/cover-letters", { data: { name: "Other letter" } });
	await expect(otherResponse).toBeOK();
	const other: { id: string } = await otherResponse.json();
	const patched = await page.request.patch(`/api/openapi/applications/${firstId}`, {
		data: { coverLetterId: other.id },
	});
	await expect(patched).toBeOK();
	expect((await (await page.request.get(`/api/openapi/applications/${firstId}`)).json()).coverLetterId).toBe(other.id);
	expect((await (await page.request.get(`/api/openapi/cover-letters/${other.id}`)).json()).sourceApplicationId).toBe(
		firstId,
	);
	expect((await (await page.request.get(`/api/openapi/cover-letters/${letter.id}`)).json()).sourceApplicationId).toBe(
		secondId,
	);
});

test("workspace sidebar returns a shared resume to the selected job rather than the most recent job", async ({
	authPage: page,
}) => {
	// Wide enough for the 480px details sheet to sit fully on screen in the guide capture.
	await page.setViewportSize({ width: 1600, height: 1000 });
	const resumeResponse = await page.request.post("/api/openapi/resumes", {
		data: { name: "Shared resume", tags: [], withSampleData: false },
	});
	await expect(resumeResponse).toBeOK();
	const resumeId = await resumeResponse.json();
	const first = await page.request.post("/api/openapi/applications", {
		data: { company: "Lumen Labs", role: "First role", resumeId },
	});
	await expect(first).toBeOK();
	const firstId = await first.json();
	const second = await page.request.post("/api/openapi/applications", {
		data: { company: "Orbit Labs", role: "Second role", resumeId },
	});
	await expect(second).toBeOK();
	await page.goto(`/dashboard/applications/${firstId}/apply`);
	await page
		.getByRole("complementary", { name: "Application details" })
		.getByRole("link", { name: /Shared resume/ })
		.click();
	await page.getByRole("link", { name: "Back to Lumen Labs" }).click();
	// The first job's record, not the second job that shares the resume.
	await expect(page.getByRole("dialog").getByRole("heading", { name: "First role" })).toBeVisible();
});
