import { readFile } from "node:fs/promises";
import { expect, test } from "../fixtures/test";

for (const width of [1280, 390]) {
	test(`reviewed answers reuse without AI and retain immutable submissions (${width}px)`, async ({
		authPage: page,
	}, testInfo) => {
		test.setTimeout(60_000);
		page.setDefaultTimeout(10_000);
		await page.setViewportSize({ width, height: 1000 });
		const create = async (company: string) => {
			const response = await page.request.post("/api/openapi/applications", {
				data: { company, role: "Operations lead", status: "saved" },
			});
			await expect(response).toBeOK();
			return (await response.json()) as string;
		};
		const first = await create("Harbor Labs");
		const second = await create("Nova Works");
		const draft = {
			id: "project",
			question: "Describe your project",
			answer: "I wrote a setup checklist and reviewed it with support.",
			factIds: [],
		};
		await expect(
			await page.request.patch(`/api/openapi/career/workspace/${first}`, {
				data: { answers: [draft], expected: { answers: [] } },
			}),
		).toBeOK();
		await page.goto(`/dashboard/applications/${first}/apply`);
		await page.getByRole("button", { name: "Save for other applications", exact: true }).click();
		let dialog = page.getByRole("dialog", { name: "Save for other applications" });
		await expect(dialog.getByLabel("Reuse scope")).toHaveValue("employer");
		await dialog.getByLabel("Reuse scope").selectOption("reusable");
		await dialog
			.getByRole("checkbox", { name: "I removed employer-specific wording and reviewed reuse across employers." })
			.check();
		await dialog
			.getByRole("checkbox", { name: "I reviewed this answer, its evidence and the application context." })
			.check();
		await dialog.getByRole("button", { name: "Save reviewed answer" }).click();
		await expect(dialog).toBeHidden();
		await page.goto(`/dashboard/applications/${second}/apply`);
		await page.getByRole("button", { name: "Use a saved answer", exact: true }).click();
		dialog = page.getByRole("dialog", { name: "Use a saved answer" });
		await expect(dialog.getByText(draft.answer)).toBeVisible();
		await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
		await dialog.getByRole("button", { name: "Copy", exact: true }).click();
		await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(draft.answer);
		const downloaded = page.waitForEvent("download");
		await dialog.getByRole("button", { name: "Export saved answers" }).click();
		const exported = await (await downloaded).path();
		if (!exported) throw new Error("Expected a local answer export.");
		expect(JSON.parse(await readFile(exported, "utf8"))).toMatchObject([
			{ question: draft.question, answer: draft.answer, scope: "reusable", source: "application" },
		]);
		await dialog.screenshot({ path: testInfo.outputPath("reviewed-answers.jpg"), type: "jpeg", quality: 85 });
		await dialog.getByRole("button", { name: "Review and use", exact: true }).click();
		dialog = page.getByRole("dialog", { name: "Review for this application" });
		await expect(dialog.getByRole("button", { name: "Use reviewed answer" })).toBeDisabled();
		await dialog
			.getByRole("textbox", { name: "Answer", exact: true })
			.fill("I wrote a setup checklist and reviewed the handoff with support.");
		const review = dialog.getByRole("checkbox", {
			name: "I reviewed this answer, its evidence and the application context.",
		});
		// Keyboard remains a complete route through the explicit approval.
		await review.focus();
		await page.keyboard.press("Space");
		await dialog.getByRole("button", { name: "Use reviewed answer" }).click();
		await expect(dialog).toBeHidden();
		const answer = page.getByRole("textbox", { name: draft.question, exact: true });
		await expect(answer).toHaveValue("I wrote a setup checklist and reviewed the handoff with support.");
		await page.getByRole("button", { name: "Mark as applied", exact: true }).click();
		await expect(page.getByRole("button", { name: "View recorded answers" })).toBeVisible();
		const response = await page.request.get(`/api/openapi/career/answers?applicationId=${second}`);
		await expect(response).toBeOK();
		const [saved] = (await response.json()) as { id: string; revision: number }[];
		if (!saved) throw new Error("Expected the reviewed library entry.");
		await expect(
			await page.request.delete(`/api/openapi/career/answers/${saved.id}`, {
				data: { expectedRevision: saved.revision },
			}),
		).toBeOK();
		await page.getByRole("button", { name: "View recorded answers" }).click();
		await expect(answer).toHaveCount(0);
		await expect(
			page.getByText("I wrote a setup checklist and reviewed the handoff with support.", { exact: true }),
		).toBeVisible();
	});
}
