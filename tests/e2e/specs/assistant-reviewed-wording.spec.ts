import { approveLocalStubOperations } from "../fixtures/ai-consent";
import { startAiStub } from "../fixtures/ai-stub";
import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs the isolated local AI stub URL flag.");

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub.close();
});

test("restored assistant edits save reviewed wording through acceptance, Undo, Redo and reload", async ({
	authPage: page,
}, info) => {
	await approveLocalStubOperations(page);
	const provider = await page.request.post("/api/openapi/ai-providers", {
		data: {
			label: "Fictional review connection",
			provider: "openai-compatible",
			model: "stub",
			baseURL: stub.baseURL,
			apiKey: "stub-key",
		},
	});
	await expect(provider).toBeOK();
	await expect(await page.request.post(`/api/openapi/ai-providers/${(await provider.json()).id}/test`)).toBeOK();
	await createSampleResumeFromDashboard(page, info);
	const id = new URL(page.url()).pathname.split("/").at(-1);
	const read = async () => {
		const response = await page.request.get(`/api/openapi/resumes/${id}`);
		await expect(response).toBeOK();
		return (await response.json()).data;
	};
	const original = await read();
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	const assistant = page.getByRole("region", { name: "Assistant", exact: true });
	await assistant.getByLabel("Message the assistant").fill("Propose overlapping edits");
	await assistant.getByRole("button", { name: "Send", exact: true }).click();
	const edits = assistant.getByRole("list", { name: "Proposed edits" });
	await expect(edits.locator("[data-proposal-index]")).toHaveCount(4);
	await expect(assistant.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
	await assistant.getByRole("button", { name: "Reject all", exact: true }).click();
	const first = edits.locator("[data-proposal-index]").first();
	await first.getByRole("button", { name: "Undo", exact: true }).click();
	await first.getByRole("button", { name: "Edit", exact: true }).click();
	const wording = "Audited the fictional checkout flow with keyboard users.";
	await first.getByLabel("Your wording").fill(wording);
	await first.getByRole("button", { name: "Save wording", exact: true }).click();
	await expect(first.getByText("Edited by you", { exact: true })).toBeVisible();
	await expect(first.locator("ins")).toContainText(wording);
	expect(await read()).toEqual(original);
	await first.getByRole("button", { name: "Accept", exact: true }).click();
	await expect.poll(async () => (await read()).summary.content).toContain(wording);
	await page.getByRole("button", { name: "Undo", exact: true }).first().click();
	await expect.poll(async () => (await read()).summary.content).toBe(original.summary.content);
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect.poll(async () => (await read()).summary.content).toContain(wording);
	await page.reload();
	await expect(edits.getByText("Applied", { exact: true })).toHaveCount(1);
	await expect(edits.locator("[data-proposal-index]").filter({ hasText: "Rejected" })).toHaveCount(3);
	await first.getByRole("button", { name: "Show edit 1", exact: true }).click();
	await expect(first.locator("ins")).toContainText(wording);
	await edits.screenshot({ path: info.outputPath("reviewed-wording.png") });
});
