import type { Locator } from "@playwright/test";
import { startAiStub } from "../fixtures/ai-stub";
import { failRpcProcedure } from "../fixtures/rpc-failure";
import { expect, test } from "../fixtures/test";

test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs local stub URL permission");
let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
});

/** Wait for ancestor entrance motion once before measuring any of its targets. */
async function settledBoxes(dialog: Locator, targets: Locator[]) {
	await dialog.evaluate(async (element) => {
		await document.fonts.ready;
		await Promise.all(
			element
				.getAnimations({ subtree: true })
				.filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
				.map((animation) => animation.finished),
		);
	});
	return Promise.all(
		targets.map(async (target) => {
			const box = await target.boundingBox();
			if (!box) throw new Error("Visible target has no bounds");
			return box;
		}),
	);
}

for (const lookup of ["empty", "ready", "failed"] as const) {
	for (const width of [1440, 390]) {
		test(`New targets stay put through ${lookup} AI lookup at ${width}px`, async ({ authPage: page }, info) => {
			if (lookup === "ready") {
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
			let failLookup = lookup === "failed";
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
				if (failLookup) {
					await held;
					await failRpcProcedure(route, "/api/rpc/aiProviders/list", "Synthetic connection lookup failure");
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
				const before = await settledBoxes(dialog, targets);
				await dialog.screenshot({ path: info.outputPath("new-pending.png") });
				release();
				await expect(dialog.getByRole("status")).toHaveCount(0);
				if (lookup === "failed") await expect(dialog.getByRole("alert")).toBeVisible();
				const after = await settledBoxes(dialog, targets);
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
				if (lookup === "failed") {
					failLookup = false;
					await dialog.getByRole("button", { name: "Try again", exact: true }).click();
					await expect(dialog.getByRole("alert")).toHaveCount(0);
					const recovered = await settledBoxes(dialog, targets);
					for (const [index, box] of recovered.entries()) {
						const previous = before[index];
						if (!previous) throw new Error("Missing pending target bounds");
						for (const axis of ["x", "y", "width", "height"] as const)
							expect(
								Math.abs(box[axis] - previous[axis]),
								`recovered target ${index} ${axis} moved`,
							).toBeLessThanOrEqual(1);
					}
				}
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
