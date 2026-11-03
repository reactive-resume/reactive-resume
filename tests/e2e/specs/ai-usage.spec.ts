import { approveLocalStubOperations } from "../fixtures/ai-consent";
import { startAiStub } from "../fixtures/ai-stub";
import { expect, test } from "../fixtures/test";

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.beforeEach(() => {
	stub.requests.length = 0;
});
test.afterAll(async () => {
	await stub?.close();
});

test("letter Improve reviews an owned posting paragraph through the canonical service", async ({
	authPage: page,
}, testInfo) => {
	test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs isolated local AI stub permission");
	await page.setViewportSize({ width: 1440, height: 1000 });
	await approveLocalStubOperations(page);
	const connection = await page.request.post("/api/openapi/ai-providers", {
		data: {
			label: "Fictional Letter AI",
			provider: "openai-compatible",
			model: "letter-main",
			fastModel: "letter-fast",
			baseURL: stub.baseURL,
			apiKey: "stub-key",
		},
	});
	await expect(connection).toBeOK();
	const { id: providerId } = await connection.json();
	await expect(await page.request.post(`/api/openapi/ai-providers/${providerId}/test`)).toBeOK();
	const application = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Cedar", role: "Engineer", jobDescription: "Maintain fictional reliable services." },
	});
	await expect(application).toBeOK();
	const applicationId = await application.json();
	const created = await page.request.post("/api/openapi/cover-letters", {
		data: { name: "Fictional paragraph review", applicationId, content: "<p>I maintain reliable services.</p>" },
	});
	await expect(created).toBeOK();
	const { id } = await created.json();
	await page.goto(`/builder/letter/${id}`);
	const body = page.getByRole("region", { name: "Letter", exact: true });
	await body.getByRole("textbox", { name: "Letter body", exact: true }).click();
	await body.getByRole("button", { name: "Improve", exact: true }).click();
	await expect(body.getByRole("button", { name: "Warmer", exact: true })).toBeVisible();
	await expect(body.getByRole("button", { name: "Shorter", exact: true })).toBeVisible();
	const before = stub.requests.length;
	await body.getByRole("button", { name: "Tie to the posting", exact: true }).click();
	await expect(body.getByText("Led fictional delivery work.", { exact: true })).toBeVisible();
	expect(stub.requests.length - before).toBe(1);
	const request = stub.requests.at(-1);
	expect(request?.model).toBe("letter-fast");
	expect(JSON.stringify(request?.messages)).toContain("Maintain fictional reliable services.");
	expect((await (await page.request.get(`/api/openapi/cover-letters/${id}`)).json()).content).toBe(
		"<p>I maintain reliable services.</p>",
	);
	await body
		.getByText("Improve this paragraph", { exact: true })
		.locator("..")
		.screenshot({ path: testInfo.outputPath("letter-improve-review.png"), animations: "disabled" });
	await body.getByRole("button", { name: "Replace", exact: true }).click();
	await expect(body.getByRole("textbox", { name: "Letter body", exact: true })).toHaveText(
		"Led fictional delivery work.",
	);
});

test("letter Accept saves the displayed version's original model and request source", async ({
	authPage: page,
}, testInfo) => {
	test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs isolated local AI stub permission");
	test.setTimeout(90_000);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await approveLocalStubOperations(page);
	const before = stub.requests.length;
	const connection = await page.request.post("/api/openapi/ai-providers", {
		data: {
			label: "Fictional Letter AI",
			provider: "openai-compatible",
			model: "letter-model",
			baseURL: stub.baseURL,
			apiKey: "stub-key",
		},
	});
	await expect(connection).toBeOK();
	const { id: providerId } = await connection.json();
	await expect(await page.request.post(`/api/openapi/ai-providers/${providerId}/test`)).toBeOK();
	const resumeResponse = await page.request.post("/api/openapi/resumes", {
		data: { name: "Fictional services resume", tags: [], withSampleData: true },
	});
	await expect(resumeResponse).toBeOK();
	const resumeId = await resumeResponse.json();
	const created = await page.request.post("/api/openapi/cover-letters", {
		data: { name: "Fictional services letter", resumeId },
	});
	await expect(created).toBeOK();
	const { id } = await created.json();
	await page.goto(`/builder/letter/${id}`);
	await page.getByRole("button", { name: "Draft from your resume", exact: true }).click();
	const body = page.getByRole("region", { name: "Letter", exact: true });
	await expect(
		body.getByText("I build reliable services and would welcome the chance to discuss your team.", { exact: true }),
	).toBeVisible();
	await body.getByRole("button", { name: "Shorter", exact: true }).click();
	await expect(body.getByText("I build reliable services.", { exact: true })).toBeVisible();
	await body.getByRole("button", { name: "Previous version", exact: true }).click();
	await expect(
		body.getByText("I build reliable services and would welcome the chance to discuss your team.", { exact: true }),
	).toBeVisible();
	await body.getByRole("button", { name: "Accept", exact: true }).click();
	await expect(body.getByText("AI request attempts: 1", { exact: true })).toBeVisible();
	const saved = await (await page.request.get(`/api/openapi/cover-letters/${id}`)).json();
	expect(saved.content).toBe("<p>I build reliable services and would welcome the chance to discuss your team.</p>");
	expect(saved.aiOperationIds).toHaveLength(1);
	await expect(await page.request.delete(`/api/openapi/ai-providers/${providerId}`)).toBeOK();
	await page.reload();
	await expect(body.getByText("AI request attempts: 1", { exact: true })).toBeVisible();
	await expect(body.getByText("Fictional Letter AI · openai-compatible · letter-model", { exact: true })).toBeVisible();
	expect(stub.requests.length - before).toBe(3);
	const report = await (await page.request.get("/api/openapi/ai/usage")).json();
	expect(report.requests).toBe(3);
	expect(report.groups).toEqual(
		expect.arrayContaining([expect.objectContaining({ action: "draft-letter", requests: 2, model: "letter-model" })]),
	);
	await body.scrollIntoViewIfNeeded();
	await body.screenshot({ path: testInfo.outputPath("letter-ai-provenance.png"), animations: "disabled" });
});

test("real AI attempts reach weekly usage and saved provenance after connection rename and deletion", async ({
	authPage: page,
}, testInfo) => {
	test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs isolated local AI stub permission");
	test.setTimeout(90_000);
	await approveLocalStubOperations(page);
	const provider = await page.request.post("/api/openapi/ai-providers", {
		data: {
			label: "Fictional Cedar AI",
			provider: "openai-compatible",
			model: "offer-fixture",
			baseURL: stub.baseURL,
			apiKey: "stub-key",
		},
	});
	await expect(provider).toBeOK();
	const { id: providerId } = await provider.json();
	await expect(await page.request.post(`/api/openapi/ai-providers/${providerId}/test`)).toBeOK();
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Cedar", role: "Operations lead", status: "interview" },
	});
	await expect(created).toBeOK();
	const id = await created.json();
	await page.goto(`/dashboard/applications/${id}/messages`);
	await page
		.getByLabel("Paste a message from Fictional Cedar")
		.fill("We are pleased to offer you EUR 90,000. Please reply by 20 November 2030.");
	await page.getByRole("button", { name: "Read it for me", exact: true }).click();
	await expect(page.getByText("They're making an offer", { exact: true })).toBeVisible({ timeout: 30_000 });
	const reportResponse = await page.request.get("/api/openapi/ai/usage");
	await expect(reportResponse).toBeOK();
	const report = await reportResponse.json();
	expect(report.requests).toBe(2);
	expect(report.groups).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				action: "provider-test",
				providerId,
				label: "Fictional Cedar AI",
				model: "offer-fixture",
				requests: 1,
			}),
			expect.objectContaining({
				action: "reply",
				providerId,
				label: "Fictional Cedar AI",
				model: "offer-fixture",
				requests: 1,
			}),
		]),
	);
	expect(stub.requests).toHaveLength(2);
	await expect(
		await page.request.patch(`/api/openapi/ai-providers/${providerId}`, {
			data: { label: "Renamed connection", model: "another-model" },
		}),
	).toBeOK();
	await expect(await page.request.delete(`/api/openapi/ai-providers/${providerId}`)).toBeOK();
	await page.goto(`/dashboard/applications/${id}/saved`);
	await expect(page.getByText("AI request attempts: 1", { exact: true })).toBeVisible();
	await expect(page.getByText("Fictional Cedar AI · openai-compatible · offer-fixture", { exact: true })).toBeVisible();
	await page.reload();
	await expect(page.getByText("AI request attempts: 1", { exact: true })).toBeVisible();
	await page
		.getByRole("main")
		.screenshot({ path: testInfo.outputPath("saved-ai-provenance.png"), animations: "disabled" });
	await page.goto("/dashboard/settings/ai#ai-usage");
	const usage = page.getByRole("region", { name: "AI usage this week", exact: true });
	await expect(usage.getByText("AI request attempts: 2", { exact: true })).toHaveCount(2);
	await expect(usage.getByText("Reply · offer-fixture · Fictional Cedar AI · 1", { exact: true })).toBeVisible();
	await expect(
		usage.getByText("Provider test · offer-fixture · Fictional Cedar AI · 1", { exact: true }),
	).toBeVisible();
	await usage.getByRole("button", { name: "Refresh usage" }).click();
	await expect(usage.getByRole("button", { name: "Refresh usage" })).toBeEnabled();
	expect(stub.requests).toHaveLength(2);
	await usage.screenshot({ path: testInfo.outputPath("weekly-ai-usage.png"), animations: "disabled" });
});
