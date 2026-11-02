import { Pool } from "pg";
import { expect, test } from "../fixtures/test";

for (const status of ["saved", "applied"] as const) {
	test(`company matches link existing documents (${status}) without inventing sent versions`, async ({
		authPage: page,
	}, testInfo) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const resumeName = status === "applied" ? "Fictional Cedar — ".padEnd(100, "W") : "Fictional Cedar — Portfolio";
		const resumeResponse = await page.request.post("/api/openapi/resumes", {
			data: { name: resumeName, tags: [] },
		});
		await expect(resumeResponse).toBeOK();
		const resumeId: string = await resumeResponse.json();
		const letterResponse = await page.request.post("/api/openapi/cover-letters", {
			data: { name: "Fictional Cedar — Introduction" },
		});
		await expect(letterResponse).toBeOK();
		const { id: letterId } = await letterResponse.json();
		const applicationResponse = await page.request.post("/api/openapi/applications", {
			data: { company: "Fictional Cedar", role: "Product designer", status },
		});
		await expect(applicationResponse).toBeOK();
		const id: string = await applicationResponse.json();
		await page.goto("/dashboard/applications");
		await page.getByText("Product designer", { exact: true }).click();
		const detail = page.getByRole("dialog", { name: "Product designer", exact: true });
		const useResume = detail.getByRole("button", { name: `Use ${resumeName} · Resume`, exact: true });
		const useLetter = detail.getByRole("button", {
			name: "Use Fictional Cedar — Introduction · Cover letter",
			exact: true,
		});
		await expect(useResume).toBeVisible();
		await expect(useLetter).toBeVisible();
		await detail.screenshot({
			path: testInfo.outputPath("application-document-suggestions.png"),
			animations: "disabled",
		});
		await page.setViewportSize({ width: 390, height: 844 });
		for (const suggestion of [useResume, useLetter]) {
			const bounds = await suggestion.boundingBox();
			if (!bounds) throw new Error("Document suggestion is missing on a phone");
			expect(bounds.x).toBeGreaterThanOrEqual(0);
			expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
			expect(await suggestion.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
		}
		await page.setViewportSize({ width: 1440, height: 1000 });

		const linking = "**/api/rpc/documents/linkApplication";
		let started!: () => void;
		let release!: () => void;
		const dispatched = new Promise<void>((resolve) => {
			started = resolve;
		});
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		await page.route(linking, async (route) => {
			started();
			await held;
			await route.abort("failed");
		});
		const failed = page.waitForEvent("requestfailed", {
			predicate: (request) => request.url().endsWith("/documents/linkApplication"),
		});
		await useResume.click();
		await dispatched;
		try {
			await expect(useLetter).toBeDisabled();
			await expect(detail.getByRole("button", { name: "Prepare a resume", exact: true })).toBeDisabled();
			await expect(detail.getByRole("button", { name: "Write a letter", exact: true })).toBeDisabled();
		} finally {
			release();
		}
		await failed;
		await expect(
			page.getByText("Couldn't reach Reactive Resume. Check your internet connection, then try again.", {
				exact: true,
			}),
		).toBeVisible();
		await expect(useResume).toBeEnabled();
		await page.unroute(linking);
		await useResume.click();
		await expect(useResume).toHaveCount(0);
		await useLetter.click();
		await expect(useLetter).toHaveCount(0);
		await expect(detail.getByText("Linked · not sent yet", { exact: true })).toHaveCount(2);
		await page.reload();
		await page.getByText("Product designer", { exact: true }).click();
		await expect(detail.getByText(resumeName, { exact: true })).toBeVisible();
		if (status === "saved")
			await expect(detail.getByRole("combobox", { name: "Use an existing letter", exact: true })).toHaveValue(letterId);
		else await expect(detail.getByText("Fictional Cedar — Introduction", { exact: true })).toBeVisible();
		const application = await page.request.get(`/api/openapi/applications/${id}`);
		await expect(application).toBeOK();
		expect(await application.json()).toMatchObject({
			resumeId,
			coverLetterId: letterId,
			status,
			sentResumeVersionId: null,
			sentCoverLetterVersionId: null,
		});
		const documents = await page.request.get("/api/openapi/documents");
		await expect(documents).toBeOK();
		const library = await documents.json();
		expect(library).toHaveLength(2);
		for (const documentId of [resumeId, letterId])
			expect(library.find((document: { id: string }) => document.id === documentId)?.application?.id).toBe(id);

		const pool = new Pool({ connectionString: process.env.DATABASE_URL });
		try {
			const stored = await pool.query(
				`select a.resume_id, a.cover_letter_id, a.sent_resume_version_id, a.sent_cover_letter_version_id,
			 r.application_id as resume_application, c.source_application_id as letter_application
			 from application a join resume r on r.id = a.resume_id join cover_letter c on c.id = a.cover_letter_id
			 where a.id = $1`,
				[id],
			);
			expect(stored.rows).toEqual([
				{
					resume_id: resumeId,
					cover_letter_id: letterId,
					sent_resume_version_id: null,
					sent_cover_letter_version_id: null,
					resume_application: id,
					letter_application: id,
				},
			]);
		} finally {
			await pool.end();
		}
	});
}
