import type { Page } from "@playwright/test";
import { startAiStub } from "../fixtures/ai-stub";
import { expect, test } from "../fixtures/test";

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
});

async function createApplication(page: Page) {
	const response = await page.request.post("/api/openapi/applications", {
		data: { company: "Harbor Freight Labs", role: "Operations lead", status: "interview" },
	});
	await expect(response).toBeOK();
	const applicationId = (await response.json()) as string;
	const interview = await page.request.post(`/api/openapi/applications/${applicationId}/interviews`, {
		data: { at: new Date(Date.now() + 2 * 86_400_000).toISOString(), kind: "technical", timezone: "Europe/Berlin" },
	});
	await expect(interview).toBeOK();
	return applicationId;
}

test("coach stories wait for exact-content approval and respect Skip", async ({ authPage: page }, testInfo) => {
	test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs FLAG_ALLOW_UNSAFE_AI_BASE_URL=true");
	test.setTimeout(90_000);
	await page.setViewportSize({ width: 1280, height: 1100 });
	const provider = await page.request.post("/api/openapi/ai-providers", {
		data: {
			label: "Demo connection",
			provider: "openai-compatible",
			model: "stub",
			baseURL: stub.baseURL,
			apiKey: "stub-key",
		},
	});
	await expect(provider).toBeOK();
	await expect(await page.request.post(`/api/openapi/ai-providers/${(await provider.json()).id}/test`)).toBeOK();
	await expect(
		await page.request.post("/api/openapi/career/facts", {
			data: {
				text: "I wrote a setup checklist and reviewed it with support.",
				category: "experience",
				source: {
					kind: "manual",
					id: "security-story-fact",
					quote: "I wrote a setup checklist and reviewed it with support.",
				},
			},
		}),
	).toBeOK();
	const stories = async () => {
		const response = await page.request.get("/api/openapi/career/stories");
		await expect(response).toBeOK();
		return response.json();
	};
	await page.goto("/dashboard/career/coach");
	for (const approve of [false, true]) {
		const composer = page.getByPlaceholder("Ask about your next career step…");
		await composer.fill("Review a story about my onboarding work.");
		await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
		await composer.press("Enter");
		await expect(page.getByText("Save this story to Knowledge?", { exact: true })).toBeVisible({ timeout: 20_000 });
		await expect(page.getByRole("button", { name: "Save story", exact: true })).toBeEnabled();
		expect(await stories()).toEqual([]);
		if (approve)
			await page
				.getByText("Save this story to Knowledge?", { exact: true })
				.locator("..")
				.screenshot({ path: testInfo.outputPath("story-approval.png") });
		await page.getByRole("button", { name: approve ? "Save story" : "Skip", exact: true }).click();
		await expect(page.getByText("Save this story to Knowledge?", { exact: true })).toBeHidden();
		await expect(page.getByText("Story decision received.", { exact: true })).toHaveCount(approve ? 2 : 1, {
			timeout: 20_000,
		});
		if (approve)
			await expect.poll(stories).toEqual([
				expect.objectContaining({
					data: expect.objectContaining({
						title: "Improving customer onboarding",
						action: "I wrote a setup checklist and reviewed it with support.",
						result: "",
					}),
				}),
			]);
		else expect(await stories()).toEqual([]);
	}
});

test("knowledge corrections persist and the workspace opens without an AI provider", async ({ authPage: page }) => {
	const applicationId = await createApplication(page);
	const original = "I reduced packing errors by 12 percent.";
	const corrected = "I reduced packing errors by 8 percent.";

	await page.goto("/dashboard/career/knowledge/facts");
	await page.getByLabel("New fact").fill(original);
	await page.getByLabel("New fact").press("Enter");
	await expect(page.getByText(original, { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Correct", exact: true }).click();
	await page.getByLabel("Correct this fact").fill(corrected);
	const saved = page.waitForResponse((response) => response.url().includes("/career/updateFact") && response.ok());
	await page.getByRole("button", { name: "Save correction" }).click();
	await saved;
	await page.reload();
	await expect(page.getByText(corrected, { exact: true })).toBeVisible();

	// Stage Interview opens on Prepare; with no connection it says where to add one instead of failing.
	await page.goto(`/dashboard/applications/${applicationId}`);
	await expect(page.getByRole("tab", { name: /Prepare/, selected: true })).toBeVisible();
	await expect(page.getByRole("link", { name: "Connect an AI provider in Settings" })).toBeVisible();
});

test("a fit check's missing evidence is saved to Knowledge from the table", async ({ authPage: page }) => {
	test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs FLAG_ALLOW_UNSAFE_AI_BASE_URL=true");
	const applicationId = await createApplication(page);
	const provider = await page.request.post("/api/openapi/ai-providers", {
		data: { label: "Stub", provider: "openai-compatible", model: "stub", baseURL: stub.baseURL, apiKey: "stub-key" },
	});
	await expect(provider).toBeOK();
	await expect(await page.request.post(`/api/openapi/ai-providers/${(await provider.json()).id}/test`)).toBeOK();

	await page.goto(`/dashboard/applications/${applicationId}/fit`);
	await page.getByRole("button", { name: "Check fit" }).click();
	await expect(page.getByText("A relevant role, with one question to resolve")).toBeVisible({ timeout: 30_000 });
	await page.getByRole("button", { name: "Add evidence" }).click();
	const evidence = "I onboarded 40 enterprise accounts in 2024.";
	await page.getByLabel("What you did: Enterprise onboarding").fill(evidence);
	await page.getByRole("button", { name: "Save to Knowledge" }).click();
	await expect(page.getByText("Added by you").filter({ visible: true })).toBeVisible();

	await page.goto("/dashboard/career/knowledge/facts");
	await expect(page.getByText(evidence, { exact: true })).toBeVisible();
});
