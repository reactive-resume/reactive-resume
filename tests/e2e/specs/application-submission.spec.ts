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
			await expect(page.getByRole("heading", { name: "Content review", exact: true })).toBeVisible();
		} else {
			await expect(
				await page.request.put(`/api/openapi/applications/${id}`, {
					data: { status: "applied" },
				}),
			).toBeOK();
		}

		await page.goto(`/dashboard/applications/${id}/apply`);
		const verify = async () => {
			await expect(page.getByRole("heading", { name: "Content review", exact: true })).toBeVisible();
			await expect(page.getByText(/Submitted on/)).toBeVisible();
			await expect(page.getByText("Before you submit", { exact: true })).toHaveCount(0);
			await expect(page.getByRole("button", { name: "Mark as applied", exact: true })).toHaveCount(0);
			await expect(
				page.getByText("Submit through the employer's application page yourself.", { exact: true }),
			).toHaveCount(0);
			await expect(
				page.getByText("Mark the application as applied to keep the versions you sent.", { exact: true }),
			).toHaveCount(0);
			await expect(page.getByRole("checkbox")).toHaveCount(3);
			await expect(
				page.getByRole("checkbox", { name: "Review the selected resume and cover letter in their editors." }),
			).not.toBeChecked();
			await expect(
				page.getByRole("checkbox", { name: "Check every claim, date and result against your experience." }),
			).toBeChecked();
			await expect(
				page.getByRole("checkbox", { name: "Review required form answers and remove unsupported claims." }),
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
		expect((await stored.json()).checklist).toEqual(checklist);
		if (entry === "detail")
			await page
				.getByRole("heading", { name: "Content review", exact: true })
				.locator("../../..")
				.screenshot({ path: testInfo.outputPath("apply-submitted.jpg") });
	});
}
