import { failRpcProcedure } from "../fixtures/rpc-failure";
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

test("Needs you keeps offers visible when their terms cannot load, then uses known hints", async ({
	authPage: page,
}) => {
	await expect(
		await page.request.post("/api/openapi/applications", {
			data: {
				company: "Fictional Cedar",
				role: "Pending offer",
				status: "offer",
				followUpAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
			},
		}),
	).toBeOK();
	let failures = 0;
	await page.route("**/api/rpc/**", async (route) => {
		if (await failRpcProcedure(route, "/api/rpc/career/savedItems", "Offer hints unavailable")) failures++;
	});
	await page.goto("/dashboard/applications?needsYou=true");
	await expect.poll(() => failures).toBeGreaterThan(0);
	await expect(page.getByText("Pending offer", { exact: true })).toBeVisible();
	await page.unroute("**/api/rpc/**");
	await page.reload();
	await expect(page.getByText("Pending offer", { exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Clear filters", exact: true })).toBeVisible();
});

test("Calendar and Insights explain filtered-empty results and clear the filters", async ({ authPage: page }) => {
	for (const data of [
		{ role: "Saved reminder", status: "saved", followUpAt: new Date(Date.now() - 86_400_000).toISOString() },
		{ role: "Sent application", status: "applied" },
	])
		await expect(
			await page.request.post("/api/openapi/applications", { data: { company: "Fictional Cedar", ...data } }),
		).toBeOK();
	await page.goto("/dashboard/applications?view=calendar&needsYou=true");
	await expect(page.getByText("Try different words or clear your filters.", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Clear filters", exact: true }).click();
	await expect(page.getByRole("button", { name: "Needs you", exact: true })).toHaveAttribute("aria-pressed", "false");
	await page.getByRole("button", { name: "Needs you", exact: true }).click();
	await page.getByRole("tab", { name: "Insights", exact: true }).click();
	await expect(page.getByText("Try different words or clear your filters.", { exact: true })).toBeVisible();
	await expect(page.getByText("Once you've sent a few applications", { exact: false })).toHaveCount(0);
	await page.getByRole("button", { name: "Clear filters", exact: true }).click();
	await expect(page.getByRole("img", { name: "Pipeline flow", exact: true })).toBeVisible();
	await page.getByRole("searchbox", { name: "Search applications", exact: true }).fill("Saved reminder");
	await expect(page.getByText("Try different words or clear your filters.", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Clear filters", exact: true }).click();
	await expect(page.getByRole("img", { name: "Pipeline flow", exact: true })).toBeVisible();
});
