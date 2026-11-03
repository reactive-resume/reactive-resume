import { approveLocalStubOperations } from "../fixtures/ai-consent";
import { startAiStub } from "../fixtures/ai-stub";
import { expect, test } from "../fixtures/test";

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
});

for (const width of [390, 1440]) {
	test(`conversation header renames the saved thread at ${width}px`, async ({ authPage: page }, info) => {
		await approveLocalStubOperations(page);
		const provider = await page.request.post("/api/openapi/ai-providers", {
			data: {
				label: "Fictional Northwind AI",
				provider: "openai-compatible",
				model: "stub",
				baseURL: stub.baseURL,
				apiKey: "stub-key",
			},
		});
		await expect(provider).toBeOK();
		const { id: providerId } = await provider.json();
		await expect(await page.request.post(`/api/openapi/ai-providers/${providerId}/test`)).toBeOK();
		const created = await page.request.post("/api/openapi/agent/threads", { data: { scope: "career" } });
		await expect(created).toBeOK();
		const { id } = (await created.json()) as { id: string };
		await expect(
			await page.request.patch(`/api/openapi/agent/threads/${id}`, { data: { title: "Northwind interview" } }),
		).toBeOK();
		await page.setViewportSize({ width, height: 844 });
		await page.goto(`/dashboard/career/coach/${id}`);
		const header = page.getByRole("region", { name: "Coach", exact: true }).locator("header");
		await expect(header.getByRole("heading", { name: /Northwind interview$/ })).toBeVisible();
		await header.getByRole("button", { name: "Rename: Northwind interview", exact: true }).click();
		const input = page.getByRole("textbox", { name: "Conversation name", exact: true });
		await expect(input).toBeFocused();
		await input.fill("Discarded title");
		await input.press("Escape");
		await expect(input).toHaveCount(0);
		if (width < 1024) await expect(page.getByRole("dialog", { name: "Conversations", exact: true })).toBeHidden();
		await expect(header.getByRole("heading", { name: /Northwind interview$/ })).toBeVisible();
		await expect(header.getByRole("button", { name: "Rename: Northwind interview", exact: true })).toBeFocused();
		await header.getByRole("button", { name: "Rename: Northwind interview", exact: true }).click();
		await input.fill("Northwind practice plan");
		await page.screenshot({ path: info.outputPath("conversation-rename.png"), animations: "disabled" });
		await input.press("Enter");
		await expect
			.poll(async () => {
				const stored = await page.request.get(`/api/openapi/agent/threads/${id}`);
				await expect(stored).toBeOK();
				return (await stored.json()).thread.title;
			})
			.toBe("Northwind practice plan");
		if (width < 1024) {
			await page
				.getByRole("dialog", { name: "Conversations", exact: true })
				.getByRole("button", { name: "Close", exact: true })
				.click();
		}
		const stored = await page.request.get(`/api/openapi/agent/threads/${id}`);
		await expect(stored).toBeOK();
		expect((await stored.json()).thread.title).toBe("Northwind practice plan");
		await page.reload();
		await expect(header.getByRole("heading", { name: /Northwind practice plan$/ })).toBeVisible();
	});
}
