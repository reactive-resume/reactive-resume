import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test("overflow names its authored page and marks the actual continuation pages", async ({
	authPage: page,
}, testInfo) => {
	await createSampleResumeFromDashboard(page, testInfo);
	const resumeId = new URL(page.url()).pathname.split("/")[2];
	const patch = await page.request.patch(`/api/openapi/resumes/${resumeId}`, {
		data: { operations: [{ op: "replace", path: "/metadata/template", value: "onyx" }] },
	});
	expect(patch.ok()).toBe(true);
	await page.reload();
	const captions = page.locator("figcaption");
	await expect(captions).toHaveCount(5);
	await expect(captions.first()).toContainText(/Page 1 runs over by about \d+ lines/);
	for (let index = 1; index < 5; index++) {
		if (index === 1 || index === 3) await expect(captions.nth(index)).toHaveCSS("border-top-style", "dashed");
		else await expect(captions.nth(index)).not.toHaveCSS("border-top-style", "dashed");
	}
	const readResume = async () => {
		const response = await page.request.get(`/api/openapi/resumes/${resumeId}`);
		expect(response.ok()).toBe(true);
		return response.json();
	};
	const resume = await readResume();
	await captions.first().screenshot({ path: testInfo.outputPath("sample-overflow.png"), animations: "disabled" });
	await page.getByRole("button", { name: "Fit to 3 pages", exact: true }).click();
	const fitted = page.locator('[data-slot="toast"]').filter({ hasText: "Fits on 3 pages:" });
	await expect(fitted).toBeVisible();
	await expect(captions).toHaveCount(3);
	await fitted.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(captions).toHaveCount(5);
	await expect(captions.first()).toContainText(/Page 1 runs over by about \d+ lines/);
	await expect.poll(async () => (await readResume()).data.metadata).toEqual(resume.data.metadata);

	const entry = resume.data.sections.experience.items[0];
	const items = Array.from({ length: 16 }, (_, index) => ({
		...entry,
		id: crypto.randomUUID(),
		company: `Fictional Studio ${index + 1}`,
		description: `<ul>${Array.from({ length: 6 }, () => "<li>Delivered measurable outcomes for a fictional team.</li>").join("")}</ul>`,
	}));
	const longer = await page.request.patch(`/api/openapi/resumes/${resumeId}`, {
		data: {
			operations: [
				{ op: "replace", path: "/sections/experience/items", value: items },
				{
					op: "replace",
					path: "/metadata/layout/pages",
					value: [{ fullWidth: true, main: ["experience"], sidebar: [] }],
				},
			],
		},
	});
	expect(longer.ok()).toBe(true);
	await page.reload();
	await expect(captions.first()).toContainText(/Runs to \d+ pages/);
	const count = await captions.count();
	expect(count).toBeGreaterThan(3);
	await expect(captions.first()).toContainText(`Runs to ${count} pages`);
	for (let index = 1; index < count; index++) await expect(captions.nth(index)).toHaveCSS("border-top-style", "dashed");
	await captions.first().screenshot({ path: testInfo.outputPath("long-overflow.png"), animations: "disabled" });
});
