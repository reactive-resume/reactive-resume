import type { Locator, Page } from "@playwright/test";
import { startAiStub } from "../fixtures/ai-stub";
import { expect, test } from "../fixtures/test";

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
});

const box = async (locator: Locator) => {
	const value = await locator.boundingBox();
	expect(value).not.toBeNull();
	return value as { x: number; y: number; width: number; height: number };
};

async function vertical(locator: Locator, action: Locator) {
	const notice = await box(locator);
	const button = await box(action);
	expect(notice.y + notice.height).toBeLessThanOrEqual(button.y + 1);
}

async function createInterview(page: Page) {
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Harbor Fixture", role: "Operations lead", status: "interview" },
	});
	await expect(created).toBeOK();
	const id = (await created.json()) as string;
	await expect(
		await page.request.post(`/api/openapi/applications/${id}/interviews`, {
			data: {
				at: new Date(Date.now() + 2 * 86_400_000).toISOString(),
				kind: "technical",
				timezone: "Europe/Berlin",
			},
		}),
	).toBeOK();
	return id;
}

test("Fit and Interview prep keep notices in a vertical body above the action", async ({
	authPage: page,
}, testInfo) => {
	test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs FLAG_ALLOW_UNSAFE_AI_BASE_URL=true");
	test.setTimeout(90_000);
	await page.setViewportSize({ width: 1280, height: 1100 });
	const id = await createInterview(page);
	const provider = await page.request.post("/api/openapi/ai-providers", {
		data: {
			label: "Fictional local provider",
			provider: "openai-compatible",
			model: "stub",
			baseURL: stub.baseURL,
			apiKey: "stub-key",
		},
	});
	await expect(provider).toBeOK();
	const providerId = (await provider.json()).id as string;
	await expect(await page.request.post(`/api/openapi/ai-providers/${providerId}/test`)).toBeOK();

	await page.goto(`/dashboard/applications/${id}/fit`);
	const fitNotice = page.getByText("Sends your preferences to Fictional local provider.", { exact: true });
	const fitAction = page.getByRole("button", { name: "Check fit", exact: true });
	await expect(fitNotice).toBeVisible();
	await expect(fitAction).toBeVisible();
	await vertical(fitNotice, fitAction);
	await page.screenshot({
		path: testInfo.outputPath("fit-provider-vertical.png"),
		fullPage: true,
		animations: "disabled",
	});

	await page.goto(`/dashboard/applications/${id}/prepare`);
	const prepNotice = page.getByText("Sends your preferences and the interview details to Fictional local provider.", {
		exact: true,
	});
	const prepAction = page.getByRole("button", { name: "Plan my preparation", exact: true });
	await expect(prepNotice).toBeVisible();
	await expect(prepAction).toBeVisible();
	await vertical(prepNotice, prepAction);
	await page.screenshot({
		path: testInfo.outputPath("prepare-provider-vertical.png"),
		fullPage: true,
		animations: "disabled",
	});

	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto(`/dashboard/career?schedule=new:prepare:${id}`);
	const schedule = page.locator('[data-slot="sheet-content"]');
	await expect(schedule.getByText("New schedule", { exact: true })).toBeVisible();
	await expect(schedule.getByText("Interview prep", { exact: true })).toBeVisible();
	await page.waitForTimeout(400);
	await schedule.screenshot({ path: testInfo.outputPath("prepare-schedule.png") });

	await expect(await page.request.delete(`/api/openapi/ai-providers/${providerId}`)).toBeOK();
	await page.goto(`/dashboard/applications/${id}/fit`);
	await page.reload();
	await expect(page.getByRole("button", { name: "Set up AI", exact: true }).first()).toBeVisible();
	await expect(page.getByRole("button", { name: "Check fit", exact: true })).toHaveCount(0);
	await page.screenshot({ path: testInfo.outputPath("fit-no-provider.png"), fullPage: true, animations: "disabled" });

	await page.goto(`/dashboard/applications/${id}/prepare`);
	await page.reload();
	await expect(page.getByRole("button", { name: "Set up AI", exact: true }).first()).toBeVisible();
	await expect(page.getByRole("button", { name: "Plan my preparation", exact: true })).toHaveCount(0);
	await page.screenshot({
		path: testInfo.outputPath("prepare-no-provider.png"),
		fullPage: true,
		animations: "disabled",
	});
});
