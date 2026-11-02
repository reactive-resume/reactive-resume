import type { Locator } from "@playwright/test";
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

async function settledBox(locator: Locator) {
	await locator.evaluate(async (element) => {
		await Promise.all(
			element
				.getAnimations({ subtree: true })
				.filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
				.map((animation) => animation.finished),
		);
	});
	const box = await locator.boundingBox();
	if (!box) throw new Error("Visible target has no bounds");
	return box;
}

for (const configured of [false, true]) {
	for (const width of [1440, 390]) {
		test(`New targets stay put through ${configured ? "ready" : "empty"} AI lookup at ${width}px`, async ({
			authPage: page,
		}, info) => {
			if (configured) {
				const response = await page.request.post("/api/openapi/ai-providers", {
					data: {
						label: "Fictional import connection",
						provider: "openai-compatible",
						model: "stub",
						baseURL: stub.baseURL,
						apiKey: "stub-key",
					},
				});
				await expect(response).toBeOK();
				const { id } = await response.json();
				await expect(await page.request.post(`/api/openapi/ai-providers/${id}/test`)).toBeOK();
			}
			await page.setViewportSize({ width, height: 1000 });
			await page.goto("/dashboard");
			let release = () => {};
			const held = new Promise<void>((resolve) => {
				release = resolve;
			});
			await page.route("**/api/rpc/**", async (route) => {
				const request = route.request();
				const entries: { url: string }[] = new URL(request.url()).pathname.endsWith("/__batch__")
					? request.postDataJSON()
					: [{ url: request.url() }];
				if (!entries.some((entry) => new URL(entry.url).pathname === "/api/rpc/aiProviders/list")) {
					await route.continue();
					return;
				}
				// Hold the real response, including every sibling event; no lookup result is fabricated.
				const response = await route.fetch();
				await held;
				await route.fulfill({ response });
			});
			try {
				await page.getByRole("heading", { name: "Documents", level: 1 }).click();
				await page.keyboard.press("n");
				const dialog = page.getByRole("dialog", { name: "New", exact: true });
				await expect(dialog.getByRole("status")).toBeVisible();
				const title = dialog.getByRole("heading", { name: "New", exact: true });
				const start = dialog.getByRole("button", { name: /^Start blank/ });
				const targets = [
					dialog,
					title,
					dialog.getByRole("button", { name: /^Import a resume/ }),
					dialog.getByRole("button", { name: /^Copy a resume for a job/ }),
					start,
				];
				const before = await Promise.all(targets.map(settledBox));
				await dialog.screenshot({ path: info.outputPath("new-pending.png") });
				release();
				await expect(dialog.getByRole("status")).toHaveCount(0);
				const after = await Promise.all(targets.map(settledBox));
				await info.attach("target-geometry", {
					body: JSON.stringify({ before, after }, null, 2),
					contentType: "application/json",
				});
				for (const [index, box] of after.entries()) {
					const previous = before[index];
					if (!previous) throw new Error("Missing pending target bounds");
					for (const axis of ["x", "y", "width", "height"] as const)
						expect(Math.abs(box[axis] - previous[axis]), `target ${index} ${axis} moved`).toBeLessThanOrEqual(1);
				}
				await dialog.screenshot({ path: info.outputPath("new-ready.png") });
				// A click aimed while lookup was pending still opens the intended action after it finishes.
				const button = before[4];
				if (!button) throw new Error("Missing Start blank bounds");
				await page.mouse.click(button.x + button.width / 2, button.y + button.height / 2);
				await page.waitForURL(/\/builder\/.+/);
				await expect(page.getByRole("textbox", { name: "Full name", exact: true })).toBeVisible();
			} finally {
				release();
			}
		});
	}
}
