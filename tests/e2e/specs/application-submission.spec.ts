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
		const receipt = await stored.json();
		expect(receipt.checklist).toEqual(checklist);
		expect(receipt.submissionReview).toEqual({ at: expect.any(String), checklist, documents: false, answers: true });
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
		await pool.query("UPDATE career_workspace SET data=data-'submissionReview' WHERE application_id=$1", [id]);
		await page.reload();
		await expect(review).toContainText("Historical review checks unavailable.");
		await expect(review.getByRole("checkbox")).toHaveCount(0);
		expect((await (await page.request.get(path)).json()).submissionReview).toBeNull();
	} finally {
		await pool.end();
	}
});
