import { startAiStub } from "../fixtures/ai-stub";
import { expect, test } from "../fixtures/test";

test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs local stub URL permission");
let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
});

for (const width of [390, 1440]) {
	test(`failed posting read keeps one warning, reachable actions and the full posting at ${width}px`, async ({
		authPage: page,
	}, info) => {
		const created = await page.request.post("/api/openapi/ai-providers", {
			data: {
				label: "Fictional local reader",
				provider: "openai-compatible",
				model: "stub",
				baseURL: stub.baseURL,
				apiKey: "stub-key",
			},
		});
		expect(created.ok()).toBe(true);
		const provider = await created.json();
		expect((await page.request.post(`/api/openapi/ai-providers/${provider.id}/test`)).ok()).toBe(true);
		await page.setViewportSize({ width, height: 900 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto("/dashboard/applications");
		await page.getByRole("button", { name: "Save job", exact: true }).first().click();
		const dialog = page.getByRole("dialog", { name: "Save a job", exact: true });
		const posting =
			"Fictional responsibilities without structured employer details.\n" +
			"Build accessible tools and keep customer information private. ".repeat(15);
		await dialog.getByLabel("Job link or posting text").fill(posting);
		const before = stub.requests.length;
		await dialog.getByRole("button", { name: "Read with AI", exact: true }).click();
		await page.getByRole("alertdialog").getByRole("button", { name: "Don't share", exact: true }).click();
		expect(stub.requests).toHaveLength(before);
		await expect(dialog.getByLabel("Job link or posting text")).toHaveValue(posting);
		await dialog.getByRole("button", { name: "Read with AI", exact: true }).click();
		await page.getByRole("alertdialog").getByRole("button", { name: "Allow this operation", exact: true }).click();
		// The real provider transport returns "1", which cannot supply structured posting details.
		await expect(
			dialog.getByText("AI couldn't fill the details. The posting is retained; complete the fields manually.", {
				exact: true,
			}),
		).toBeVisible();
		await expect(dialog.getByText(/Some job details couldn't be read/)).toHaveCount(0);
		await expect(dialog.locator("textarea")).toHaveCount(1);
		await expect(dialog.getByLabel("Job link or posting text")).toHaveValue(posting);
		expect(stub.requests).toHaveLength(before + 1);
		await dialog.getByLabel("Role", { exact: true }).fill("Tools Engineer");
		await dialog.getByLabel("Company", { exact: true }).fill("Fictional Studio");
		const save = dialog.getByRole("button", { name: "Save job", exact: true });
		for (const fontSize of [16, 24]) {
			await page.evaluate((value) => {
				document.documentElement.style.fontSize = `${value}px`;
			}, fontSize);
			for (const end of [false, true]) {
				await dialog.evaluate((element, bottom) => {
					element.scrollTop = bottom ? element.scrollHeight : 0;
				}, end);
				const action = await save.boundingBox();
				const frame = await dialog.boundingBox();
				if (!action || !frame) throw new Error("Save action or dialog missing");
				expect(action.y).toBeGreaterThanOrEqual(frame.y);
				expect(action.y + action.height).toBeLessThanOrEqual(frame.y + frame.height + 1);
				expect(
					await save.evaluate((element) => {
						const box = element.getBoundingClientRect();
						return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
					}),
				).toBe(true);
			}
		}
		await page.evaluate(() => {
			document.documentElement.style.fontSize = "16px";
		});
		await dialog.screenshot({ path: info.outputPath("posting-recovery.png"), animations: "disabled" });
		await save.click();
		await expect(dialog).toBeHidden();
		const jobs = await (await page.request.get("/api/openapi/applications")).json();
		expect(jobs).toHaveLength(1);
		expect(jobs[0]).toMatchObject({
			company: "Fictional Studio",
			role: "Tools Engineer",
			jobDescription: posting.trim(),
		});
		await page.reload();
		expect((await (await page.request.get(`/api/openapi/applications/${jobs[0].id}`)).json()).jobDescription).toBe(
			posting.trim(),
		);
	});
}

test("closed application shows Outcome with its reason and no preparation or Edit action", async ({
	authPage: page,
}, info) => {
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Studio", role: "Tools Engineer", status: "closed", closedReason: "accepted" },
	});
	expect(created.ok()).toBe(true);
	await page.goto("/dashboard/applications?closed=true");
	await page.getByText("Tools Engineer", { exact: true }).first().click();
	const card = page.locator("section[aria-labelledby='application-next-step']");
	await expect(card.getByRole("heading", { name: "Outcome", exact: true })).toBeVisible();
	await expect(card).toContainText("Accepted offer");
	await expect(card.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Prepare a resume", exact: true })).toHaveCount(0);
	await card.screenshot({ path: info.outputPath("closed-outcome.png"), animations: "disabled" });
});
