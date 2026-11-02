import { expect, test } from "../fixtures/test";

test("Needs you filters every Applications view and clears without changing saved applications", async ({
	authPage: page,
}, info) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	const now = Date.now();
	const at = (days: number) => new Date(now + days * 86_400_000).toISOString();
	const jobs = [
		{ role: "Platform engineer", status: "saved", source: "Fictional idle source" },
		{ role: "Product designer", status: "applied", source: "Fictional idle source" },
		{ role: "Frontend engineer", status: "applied", stageEnteredAt: at(-14).slice(0, 10) },
		{ role: "Engineering manager", status: "applied", followUpAt: at(-1), followUpDateOnly: false },
		{ role: "Data analyst", status: "applied", followUpAt: at(3), followUpDateOnly: false },
		{ role: "Product engineer", status: "interview" },
		{ role: "Research engineer", status: "interview", source: "Fictional idle source" },
		{ role: "Staff engineer", status: "offer" },
		{ role: "Operations analyst", status: "closed", followUpAt: at(-1), followUpDateOnly: false },
	];
	for (const job of jobs) {
		const response = await page.request.post("/api/openapi/applications", {
			data: { company: "Fictional Cedar", source: "Fictional active source", ...job },
		});
		await expect(response).toBeOK();
		const id: string = await response.json();
		if (job.role === "Product engineer" || job.role === "Research engineer")
			await expect(
				await page.request.post(`/api/openapi/applications/${id}/interviews`, {
					data: { kind: "technical", at: at(job.role === "Product engineer" ? 2 : 20), durationMinutes: 30 },
				}),
			).toBeOK();
	}
	const before = await (await page.request.get("/api/openapi/applications")).json();
	await page.goto("/dashboard/applications");
	const needsYou = page.getByRole("button", { name: "Needs you", exact: true });
	await expect(needsYou).toHaveAttribute("aria-pressed", "false");
	await needsYou.click();
	await expect(needsYou).toHaveAttribute("aria-pressed", "true");
	await expect(page).toHaveURL(/needsYou=true/);
	for (const role of ["Frontend engineer", "Engineering manager", "Product engineer", "Staff engineer"])
		await expect(page.getByText(role, { exact: true })).toBeVisible();
	for (const role of [
		"Platform engineer",
		"Product designer",
		"Data analyst",
		"Research engineer",
		"Operations analyst",
	])
		await expect(page.getByText(role, { exact: true })).toHaveCount(0);
	await page.reload();
	await expect(needsYou).toHaveAttribute("aria-pressed", "true");
	await page
		.getByRole("main")
		.screenshot({ path: info.outputPath("applications-needs-you.png"), animations: "disabled" });
	await page.setViewportSize({ width: 390, height: 844 });
	await expect(needsYou).toBeInViewport({ ratio: 1 });
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.getByRole("tab", { name: "Board", exact: true }).click();
	await expect(needsYou).toHaveAttribute("aria-pressed", "true");
	await expect(page.getByText("Product designer", { exact: true })).toHaveCount(0);
	await expect(page.getByText("Staff engineer", { exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Calendar", exact: true }).click();
	await expect(page.getByText("Product engineer", { exact: true }).first()).toBeVisible();
	await expect(page.getByText("Research engineer", { exact: true })).toHaveCount(0);
	await page.getByRole("tab", { name: "Insights", exact: true }).click();
	await expect(page.getByRole("img", { name: "Pipeline flow", exact: true })).toContainText("4 active applications");
	await expect(page.getByText("Fictional active source", { exact: true })).toBeVisible();
	await expect(page.getByText("Fictional idle source", { exact: true })).toHaveCount(0);
	await page.getByRole("tab", { name: "List", exact: true }).click();
	await page.getByRole("searchbox", { name: "Search applications", exact: true }).fill("Product designer");
	await expect(page.getByText("No matching applications", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Clear filters", exact: true }).click();
	await expect(needsYou).toHaveAttribute("aria-pressed", "false");
	await expect(page.getByRole("searchbox", { name: "Search applications", exact: true })).toHaveValue("");
	await expect(page.getByText("Product designer", { exact: true })).toBeVisible();
	const after = await (await page.request.get("/api/openapi/applications")).json();
	expect(after).toEqual(before);
});
