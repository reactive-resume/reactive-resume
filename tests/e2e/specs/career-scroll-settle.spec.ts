import { approveLocalStubOperations } from "../fixtures/ai-consent";
import { startAiStub } from "../fixtures/ai-stub";
import { expect, test } from "../fixtures/test";

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => await stub.close());

test("Latest hides at the newest message including a small settled gap", async ({ authPage: page }, info) => {
	test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs the isolated AI stub.");
	await approveLocalStubOperations(page);
	await page.setViewportSize({ width: 390, height: 844 });
	const response = await page.request.post("/api/openapi/ai-providers", {
		data: {
			label: "Fictional chat",
			provider: "openai-compatible",
			model: "stub",
			baseURL: stub.baseURL,
			apiKey: "stub-key",
		},
	});
	await expect(response).toBeOK();
	const { id } = (await response.json()) as { id: string };
	await expect(await page.request.post(`/api/openapi/ai-providers/${id}/test`)).toBeOK();
	await page.goto("/dashboard/career/coach");
	await page.getByPlaceholder("Ask about your next career step…").fill("Answer slowly please, with a long reply.");
	await page.getByRole("button", { name: "Send", exact: true }).click();
	await expect(page.getByText(/word59/)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
	const viewport = page.locator('[data-slot="message-scroller-viewport"]');
	const latest = page.locator('[data-slot="message-scroller-button"][data-direction="end"]');
	const setGap = (gap: number) =>
		viewport.evaluate((element, value) => {
			element.scrollTop = element.scrollHeight - element.clientHeight - value;
			element.dispatchEvent(new Event("scroll"));
		}, gap);
	await setGap(0);
	await expect(latest).toHaveAttribute("data-active", "false");
	await expect(latest).toHaveAttribute("inert");
	await expect(latest).toHaveAttribute("tabindex", "-1");
	await viewport.dispatchEvent("wheel", { deltaY: -96 });
	await setGap(96);
	await expect(latest).toHaveAttribute("data-active", "true");
	await setGap(17);
	await expect
		.poll(() => viewport.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
		.toBe(17);
	await expect(latest).toHaveAttribute("data-active", "false");
	await expect(latest).toHaveAttribute("inert");
	await expect(latest).toHaveAttribute("tabindex", "-1");
	await expect(latest).toHaveCSS("opacity", "0");
	await page.screenshot({ path: info.outputPath("settled-gap.png") });
});
