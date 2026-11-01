import { execFileSync } from "node:child_process";
import { expect, test } from "../fixtures/test";

test("writes and exports standalone sender details, then edits a linked copy without changing its resume", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(90_000);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await page.route(/^https:\/\/fonts\.gstatic\.(?:com|cn)\//, async (route) => {
		const response = await route.fetch();
		await route.fulfill({ response });
	});
	const created = await page.request.post("/api/openapi/cover-letters", {
		data: { name: "Standalone letter", content: "<p>I would love to join your team.</p>" },
	});
	expect(created.ok()).toBe(true);
	const { id } = await created.json();
	await page.goto(`/builder/letter/${id}`);
	const from = page.getByRole("region", { name: "From", exact: true });
	await from.getByRole("textbox", { name: "Full name", exact: true }).fill("Jordan Reyes");
	await from.getByRole("textbox", { name: "Email", exact: true }).fill("jordan@example.test");
	await from.getByRole("textbox", { name: "Phone", exact: true }).fill("+49 30 5550100");
	await from.getByRole("textbox", { name: "Location", exact: true }).fill("Berlin");
	await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
	await page.reload();
	await expect(from.getByRole("textbox", { name: "Full name", exact: true })).toHaveValue("Jordan Reyes");
	const downloaded = page.waitForEvent("download");
	await page.getByRole("button", { name: "Download PDF", exact: true }).click();
	const download = await downloaded;
	expect(await download.failure()).toBeNull();
	const path = await download.path();
	if (!path) throw new Error("Missing letter PDF");
	const text = execFileSync("pdftotext", [path, "-"], { encoding: "utf8" });
	expect(text).toContain("Jordan Reyes");
	expect(text).toContain("jordan@example.test");
	await expect(page.getByRole("status", { name: "Loading", exact: true })).toHaveCount(0);
	await from.scrollIntoViewIfNeeded();
	await page.screenshot({ path: testInfo.outputPath("letter-sender-details.png") });

	const resumeResponse = await page.request.post("/api/openapi/resumes", {
		data: { name: "Source resume", tags: [], withSampleData: true },
	});
	expect(resumeResponse.ok()).toBe(true);
	const resumeId = await resumeResponse.json();
	const original = await (await page.request.get(`/api/openapi/resumes/${resumeId}`)).json();
	await page.reload();
	await expect(
		from.getByText("Enter your details below. Choosing a resume replaces them and links its design."),
	).toBeVisible();
	await from.getByLabel("Resume", { exact: true }).selectOption(resumeId);
	const linked = from.getByRole("switch", { name: "Use details from “Source resume”", exact: true });
	await expect(linked).toBeChecked();
	await expect(from.getByRole("textbox", { name: "Full name", exact: true })).toHaveCount(0);
	await linked.click();
	await expect(linked).not.toBeChecked();
	await expect(from.getByRole("textbox", { name: "Full name", exact: true })).toHaveValue(original.data.basics.name);
	await from.getByRole("textbox", { name: "Full name", exact: true }).fill("Letter only sender");
	await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
	await expect(from.getByText(/Turning this on replaces them with the resume’s current details/)).toBeVisible();
	const unchanged = await (await page.request.get(`/api/openapi/resumes/${resumeId}`)).json();
	expect(unchanged.data).toEqual(original.data);
	await linked.click();
	await expect(linked).toBeChecked();
	const letter = await (await page.request.get(`/api/openapi/cover-letters/${id}`)).json();
	expect(letter.style.basics).toEqual(original.data.basics);
	await from.getByLabel("Resume", { exact: true }).selectOption("");
	await expect(from.getByRole("textbox", { name: "Full name", exact: true })).toHaveValue(original.data.basics.name);
});
