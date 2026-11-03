import { Pool } from "pg";
import { expect, test } from "../fixtures/test";

for (const entry of ["detail", "workspace", "api"] as const) {
	test(`Apply reconciles submission from ${entry} without inventing review checks`, async ({
		authPage: page,
	}, testInfo) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const created = await page.request.post("/api/openapi/applications", {
			data: { company: "Northstar Labs", role: "Product engineer", status: "saved" },
		});
		await expect(created).toBeOK();
		const id = (await created.json()) as string;
		const workspaceUrl = `/api/openapi/career/workspace/${id}`;
		const checklist = entry === "api" ? [1, 3, 4] : [1];
		await expect(
			await page.request.patch(workspaceUrl, {
				data: {
					checklist,
					answers: [
						{
							id: "project",
							question: "Describe a project you led.",
							answer:
								"I wrote an onboarding checklist and reviewed it with support. We used feedback from new customers to clarify the setup steps.",
							factIds: [],
						},
						{
							id: "motivation",
							question: "Why are you interested in this role?",
							answer:
								"I want to work with product and engineering teams on practical improvements to customer onboarding.",
							factIds: [],
						},
					],
					expected: { checklist: [], answers: [] },
				},
			}),
		).toBeOK();

		if (entry === "detail") {
			await page.goto("/dashboard/applications");
			await page.getByText("Product engineer", { exact: true }).click();
			await page.getByRole("button", { name: "Mark as applied", exact: true }).click();
			const submitted = page.waitForResponse(
				(response) => response.url().includes("/applications/update") && response.ok(),
			);
			await page.getByRole("button", { name: "Confirm applied", exact: true }).click();
			await submitted;
		} else if (entry === "workspace") {
			await page.goto(`/dashboard/applications/${id}/apply`);
			await page.getByRole("button", { name: "Mark as applied", exact: true }).click();
			await expect(page.getByRole("heading", { name: "Review checks", exact: true })).toBeVisible();
		} else {
			await expect(
				await page.request.put(`/api/openapi/applications/${id}`, {
					data: { status: "applied" },
				}),
			).toBeOK();
		}

		await page.goto(`/dashboard/applications/${id}/apply`);
		const verify = async () => {
			await expect(page.getByRole("heading", { name: "Review checks", exact: true })).toBeVisible();
			await expect(page.getByText(/Submission recorded .*The sent versions never change/)).toBeVisible();
			await expect(page.getByText("Before you submit", { exact: true })).toHaveCount(0);
			await expect(page.getByRole("button", { name: "Mark as applied", exact: true })).toHaveCount(0);
			await expect(
				page.getByText("Submit through the employer's application page yourself.", { exact: true }),
			).toHaveCount(0);
			await expect(
				page.getByText("Mark the application as applied to keep the versions you sent.", { exact: true }),
			).toHaveCount(0);
			await expect(page.locator("#application-readiness").getByRole("checkbox")).toHaveCount(2);
			await expect(
				page
					.locator("#application-readiness")
					.getByRole("checkbox", { name: "Review the selected resume and cover letter in their editors." }),
			).toHaveCount(0);
			await expect(page.locator("#application-readiness").getByRole("checkbox", { checked: true })).toBeDisabled();
			await expect(page.locator("#application-readiness").getByRole("checkbox", { checked: false })).toBeDisabled();
			await expect(page.locator("#application-readiness")).not.toContainText(/\d+ of \d+/);
			await expect(
				page
					.locator("#application-readiness")
					.getByRole("checkbox", { name: "Check every claim, date and result against your experience." }),
			).toBeChecked();
			await expect(
				page
					.locator("#application-readiness")
					.getByRole("checkbox", { name: "Review required form answers and remove unsupported claims." }),
			).not.toBeChecked();
		};
		await verify();
		await page.reload();
		await verify();
		await expect(
			await page.request.put(`/api/openapi/applications/${id}`, {
				data: { status: "interview" },
			}),
		).toBeOK();
		await page.reload();
		await verify();
		const stored = await page.request.get(workspaceUrl);
		await expect(stored).toBeOK();
		let receipt = await stored.json();
		expect(receipt.checklist).toEqual(checklist);
		expect(receipt.submissionReview).toMatchObject({
			at: expect.any(String),
			checklist,
			documents: false,
			answers: true,
		});
		if (entry === "api") {
			await expect(await page.request.post(`${workspaceUrl}/answers`)).toBeOK();
			receipt = await (await page.request.get(workspaceUrl)).json();
		}
		const pool = new Pool({ connectionString: process.env.DATABASE_URL });
		try {
			const stored = await pool.query("SELECT data, submission_review FROM career_workspace WHERE application_id=$1", [
				id,
			]);
			expect(stored.rows[0].data).not.toHaveProperty("submissionReview");
			expect(stored.rows[0].submission_review).toEqual(receipt.submissionReview);
			// An old server's whole-JSON write cannot erase a receipt created by a new server.
			await pool.query(
				"UPDATE career_workspace SET data=jsonb_set(data, '{ticks}', '{\"legacy\":[]}'::jsonb) WHERE application_id=$1",
				[id],
			);
			expect((await (await page.request.get(workspaceUrl)).json()).submissionReview).toEqual(receipt.submissionReview);
		} finally {
			await pool.end();
		}
		const exported = await page.request.get("/api/openapi/auth/account/export");
		await expect(exported).toBeOK();
		const exportedWorkspace = (await exported.json()).career.workspaces.find(
			(row: { applicationId: string }) => row.applicationId === id,
		);
		expect(exportedWorkspace.submissionReview).toEqual(receipt.submissionReview);
		expect(exportedWorkspace.data).not.toHaveProperty("submissionReview");
		if (entry === "detail") expect(receipt.submissionReview.answerVersionId).toBeNull();
		else {
			expect(receipt.submissionReview.answerVersionId).toEqual(expect.any(String));
			await page.goto(`/dashboard/applications/${id}/apply?version=${receipt.submissionReview.answerVersionId}`);
			await expect(page.locator("#application-readiness")).toContainText("Review checks recorded at first submission.");
			await expect(page.locator("#application-readiness").getByRole("checkbox")).toHaveCount(2);
			await page.goto(`/dashboard/applications/${id}/apply`);
		}
		expect(
			(await page.request.patch(workspaceUrl, { data: { checklist: [2], expected: { checklist } } })).status(),
		).toBe(409);
		await expect(
			await page.request.patch(workspaceUrl, {
				data: { submissionReview: null, message: "Other preparation remains editable", expected: { message: "" } },
			}),
		).toBeOK();
		expect((await (await page.request.get(workspaceUrl)).json()).submissionReview).toEqual(receipt.submissionReview);
		if (entry === "detail")
			await page
				.getByRole("heading", { name: "Review checks", exact: true })
				.locator("../../..")
				.screenshot({ path: testInfo.outputPath("apply-submitted.jpg") });
	});
}

test("Apply hides absent subjects and empty answer actions, with honest legacy history", async ({ authPage: page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Harbor", role: "Platform engineer", status: "saved" },
	});
	await expect(created).toBeOK();
	const id = (await created.json()) as string;
	const path = `/api/openapi/career/workspace/${id}`;
	await page.goto(`/dashboard/applications/${id}/apply`);
	const review = page.locator("#application-readiness");
	await expect(review.getByRole("checkbox")).toHaveCount(1);
	await expect(review.getByRole("button", { name: "Copy answers" })).toHaveCount(0);
	await expect(review.getByRole("button", { name: "Download", exact: true })).toHaveCount(0);
	const saved = page.waitForResponse((response) => response.url().includes("/career/saveWorkspace") && response.ok());
	await review.getByRole("checkbox").click();
	await expect(review.getByRole("checkbox")).toBeChecked();
	await saved;
	await page.reload();
	await expect(review.getByRole("checkbox")).toBeChecked();
	expect((await (await page.request.get(path)).json()).checklist).toEqual([3]);
	await expect(await page.request.put(`/api/openapi/applications/${id}`, { data: { status: "applied" } })).toBeOK();
	await page.reload();
	await expect(review.getByRole("checkbox")).toHaveCount(0);
	await expect(review).toContainText("Review checks recorded at first submission.");
	await expect(review).not.toContainText(/\d+ of \d+/);
	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		// Represent an older stored workspace with no review receipt; never backfill current ticks as history.
		await pool.query("UPDATE career_workspace SET submission_review=NULL WHERE application_id=$1", [id]);
		await page.reload();
		await expect(review).toContainText("Historical review checks unavailable.");
		await expect(review.getByRole("checkbox")).toHaveCount(0);
		expect((await (await page.request.get(path)).json()).submissionReview).toBeNull();
	} finally {
		await pool.end();
	}
});

test("Apply copies and downloads the first unsaved answer while offline, then hides empty actions", async ({
	authPage: page,
}) => {
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Harbor", role: "Local drafts", status: "saved" },
	});
	await expect(created).toBeOK();
	const id = (await created.json()) as string;
	await expect(
		await page.request.patch(`/api/openapi/career/workspace/${id}`, {
			data: {
				answers: [{ id: "draft", question: "Why this role?", answer: "", factIds: [] }],
				expected: { answers: [] },
			},
		}),
	).toBeOK();
	await page.goto(`/dashboard/applications/${id}/apply`);
	const input = page.getByRole("textbox", { name: "Why this role?", exact: true });
	await expect(input).toBeVisible();
	const review = page.locator("#application-readiness");
	await expect(review.getByRole("button", { name: "Copy answers" })).toHaveCount(0);
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.context().setOffline(true);
	try {
		await input.fill("First local answer before autosave.");
		await review.getByRole("button", { name: "Copy answers" }).click();
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe("Why this role?\nFirst local answer before autosave.");
		await review.getByRole("button", { name: "Download", exact: true }).click();
		const download = page.waitForEvent("download");
		await page.getByRole("menuitem", { name: "Plain text (.txt)" }).click();
		const downloaded = await download;
		const stream = await downloaded.createReadStream();
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(Buffer.from(chunk));
		expect(Buffer.concat(chunks).toString()).toContain("Why this role?\n\nFirst local answer before autosave.");
		await input.fill("   ");
		await expect(review.getByRole("button", { name: "Copy answers" })).toHaveCount(0);
		await expect(review.getByRole("button", { name: "Download", exact: true })).toHaveCount(0);
	} finally {
		await page.context().setOffline(false);
	}
});
