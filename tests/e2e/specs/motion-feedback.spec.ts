import type { Page, Request } from "@playwright/test";
import { createResumeName } from "../fixtures/data";
import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

const outlineOrder = async (page: Page) => {
	await expect(page.locator("#sidebar-education")).toBeVisible();
	return page
		.locator("[data-section-id]")
		.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-section-id")));
};

/** Whether an RPC request calls this procedure, alone or in a batch. */
const calls = (request: Request, procedure: string) =>
	`${request.url()} ${request.postData() ?? ""}`.includes(procedure);

const saved = (page: Page) => expect(page.getByText("Saved", { exact: true })).toBeVisible();

/** The live region of the drag context that last spoke (each list has its own). */
const lastAnnouncement = (page: Page) =>
	page
		.locator('[id^="DndLiveRegion"]')
		.evaluateAll((regions) => regions.map((region) => region.textContent ?? "").find(Boolean) ?? "");

test("a toast's Undo runs once and closes, so pressing it again can't undo an earlier edit", async ({
	authPage: page,
}, testInfo) => {
	await createSampleResumeFromDashboard(page, testInfo);
	await page.getByRole("button", { name: "Options for Education", exact: true }).click();
	await page
		.getByRole("menu", { name: "Options for Education" })
		.getByRole("menuitem", { name: "Move down", exact: true })
		.click();
	const moved = await outlineOrder(page);

	const experience = page.locator("#sidebar-experience");
	await experience.getByRole("button", { name: "Options for Experience", exact: true }).click();
	// The Education menu may still be closing: pick the item from Experience's menu.
	await page
		.getByRole("menu", { name: "Options for Experience" })
		.getByRole("menuitem", { name: "Clear section", exact: true })
		.click();
	// An emptied section leaves the outline.
	await expect(experience).toHaveCount(0);

	const toast = page.locator('[data-slot="toast"]').filter({ hasText: "Experience cleared" });
	const box = await toast.getByRole("button", { name: "Undo", exact: true }).boundingBox();
	if (!box) throw new Error("Undo isn't on screen");
	// Two quick presses, as a person double-clicking: the second lands while the toast leaves.
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

	await expect(toast).toBeHidden({ timeout: 1500 });
	await expect(experience).toBeVisible();
	expect(await outlineOrder(page)).toEqual(moved);

	await saved(page);
	await page.reload();
	await expect(page.locator("#sidebar-experience")).toBeVisible();
	expect(await outlineOrder(page)).toEqual(moved);
});

test("Undo from the keyboard restores a trashed document, and a failed restore says so", async ({
	authPage: page,
}, testInfo) => {
	const create = async (suffix: string) => {
		const name = `${createResumeName(testInfo)} ${suffix}`;
		const response = await page.request.post("/api/openapi/resumes", {
			data: { name, tags: [], withSampleData: false },
		});
		expect(response.ok()).toBe(true);
		return name;
	};
	const kept = await create("kept");
	const failing = await create("failing");
	await page.goto("/dashboard");

	const trash = async (name: string) => {
		await page
			.getByRole("button", { name: `Options for ${name}`, exact: true })
			.first()
			.click();
		await page.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
		const toast = page.locator('[data-slot="toast"]').filter({ hasText: "moved to Trash" });
		await expect(toast).toBeVisible();
		return toast;
	};

	const toast = await trash(kept);
	const undo = toast.getByRole("button", { name: "Undo", exact: true });
	await undo.focus();
	await page.keyboard.press("Enter");
	await page.keyboard.press("Enter");
	await expect(toast).toBeHidden({ timeout: 1500 });
	await expect(page.getByRole("button", { name: `Options for ${kept}`, exact: true }).first()).toBeVisible();

	await page.route("**/api/rpc/**", (route) =>
		calls(route.request(), "documents/restore") ? route.fulfill({ status: 500, body: "{}" }) : route.continue(),
	);
	const failed = await trash(failing);
	await failed.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.getByText("Couldn't restore the document. Try again.")).toBeVisible();
	await expect(page.getByRole("button", { name: `Options for ${failing}`, exact: true })).toHaveCount(0);
});

test("reordering sections from the keyboard is announced by name and undoes as one step", async ({
	authPage: page,
}, testInfo) => {
	await createSampleResumeFromDashboard(page, testInfo);
	const before = await outlineOrder(page);
	const handle = page.getByRole("button", { name: "Reorder Summary", exact: true });
	await expect(handle).toHaveAccessibleDescription(
		"To pick it up, press Space or Enter. Use the arrow keys to move it, Space or Enter to drop it, or Escape to cancel.",
	);

	await handle.focus();
	await page.keyboard.press("Space");
	await expect.poll(() => lastAnnouncement(page)).toBe("Picked up Summary.");
	await page.keyboard.press("ArrowDown");
	await expect.poll(() => lastAnnouncement(page)).toMatch(/^Summary is over position 2 of \d+/);
	await page.keyboard.press("Escape");
	await expect.poll(() => lastAnnouncement(page)).toBe("Moving Summary was cancelled. Nothing moved.");
	expect(await outlineOrder(page)).toEqual(before);

	await handle.focus();
	await page.keyboard.press("Space");
	await page.keyboard.press("ArrowDown");
	await expect.poll(() => lastAnnouncement(page)).toMatch(/^Summary is over position 2 of \d+/);
	await page.keyboard.press("Space");
	await expect.poll(() => lastAnnouncement(page)).toMatch(/^Summary was dropped on position 2 of \d+/);
	expect(await lastAnnouncement(page)).not.toMatch(/[0-9a-f]{8}-|draggable|droppable/);
	const after = await outlineOrder(page);
	expect(after).not.toEqual(before);
	expect(after.indexOf("summary")).toBe(before.indexOf("summary") + 1);

	await page.locator("body").press("ControlOrMeta+z");
	await expect.poll(() => outlineOrder(page)).toEqual(before);
});

test("a short drag near the bottom of the outline moves a section a few places, not pages away", async ({
	authPage: page,
}, testInfo) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await createSampleResumeFromDashboard(page, testInfo);
	await expect(page.getByRole("region", { name: "Resume page" })).toBeVisible();
	const before = await outlineOrder(page);
	const id = before[Math.floor(before.length / 2)] as string;
	const row = page.locator(`[data-section-id="${id}"]`);
	const panel = page.locator('[data-slot="tabs-content"]').filter({ has: row });
	const panelBox = await panel.boundingBox();
	if (!panelBox) throw new Error("No panel");
	const bottom = panelBox.y + panelBox.height;

	// Put the row's handle 160px above the panel's bottom edge: inside dnd-kit's default 20% edge zone, which ran
	// the list to its end, and outside the outer 8% that scrolls now.
	await row.evaluate((element, offset) => {
		const scroller = element.closest('[data-slot="tabs-content"]') as HTMLElement;
		const rowTop = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
		scroller.scrollTop += rowTop - (scroller.clientHeight - offset);
	}, 160 + 22);
	const scrollBefore = await panel.evaluate((element) => element.scrollTop);
	const handle = row.getByRole("button", { name: /^Reorder / });
	const start = await handle.boundingBox();
	if (!start) throw new Error("No handle");
	expect(bottom - (start.y + start.height / 2)).toBeGreaterThan(150);

	await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
	await page.mouse.down();
	for (let step = 1; step <= 20; step++) {
		await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + (90 * step) / 20);
		await page.waitForTimeout(50);
	}
	await page.mouse.up();

	const scrolled = (await panel.evaluate((element) => element.scrollTop)) - scrollBefore;
	expect(scrolled).toBeLessThan(40);
	const after = await outlineOrder(page);
	expect(Math.abs(after.indexOf(id) - before.indexOf(id))).toBeLessThanOrEqual(3);
});

test("the builder shows its own frame while a resume loads", async ({ authPage: page }, testInfo) => {
	const name = createResumeName(testInfo);
	const response = await page.request.post("/api/openapi/resumes", { data: { name, tags: [], withSampleData: true } });
	expect(response.ok()).toBe(true);
	await page.goto("/dashboard");

	let release = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	await page.route("**/api/rpc/**", async (route) => {
		if (calls(route.request(), "resume/getById")) await held;
		await route.continue();
	});
	await page.getByRole("link", { name, exact: true }).first().click();

	await expect(page.getByRole("link", { name: "Back to documents" })).toBeVisible();
	await expect(page.getByRole("img", { name: /Loading resume page 1/ })).toBeVisible();
	release();
	await expect(page.getByRole("button", { name: `Document menu: ${name}` })).toBeVisible();
});

test.describe("homepage", () => {
	test("warms only nearby scenes and keeps scrolling when checkVisibility is unavailable", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.addInitScript(() => {
			Object.defineProperty(Element.prototype, "checkVisibility", { value: undefined, configurable: true });
		});
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto("/");
		await page.waitForLoadState("networkidle");
		await page.evaluate(() => window.scrollTo({ top: 600, behavior: "instant" }));
		await expect(page.locator("#write")).toHaveAttribute("data-warm", "");
		await expect(page.locator("#prepare")).not.toHaveAttribute("data-warm", "");
		await page
			.locator("#design")
			.evaluate((section) =>
				window.scrollTo({ top: section.getBoundingClientRect().top + window.scrollY, behavior: "instant" }),
			);
		await expect(page.locator("#design")).toHaveAttribute("data-warm", "");
		expect(await page.locator("[data-warm]").count()).toBeLessThanOrEqual(3);
		await expect(page.locator('[data-scene="0"]')).not.toHaveAttribute("data-warm", "");
		expect(errors).toEqual([]);
	});
	for (const viewport of [
		{ width: 1440, height: 900 },
		{ width: 390, height: 844 },
	])
		test(`collapses every pinned scene to one screen under reduced motion at ${viewport.width}px`, async ({ page }) => {
			await page.setViewportSize(viewport);
			await page.emulateMedia({ reducedMotion: "reduce" });
			await page.goto("/");
			const heights = await page
				.locator("[data-pin]")
				.evaluateAll((scenes) => scenes.map((scene) => scene.getBoundingClientRect().height));
			expect(heights).toHaveLength(7);
			for (const height of heights) expect(height).toBe(viewport.height);
		});

	test("cuts to a far scene instead of scrolling through the story, and scrolls to the next one", async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto("/");
		// The router restores the top of the page once it has loaded.
		await page.waitForLoadState("networkidle");
		const story = page.getByRole("navigation", { name: "Story" });
		const target = (scene: string) =>
			page.locator(`#${scene}`).evaluate((section) => {
				const top = section.getBoundingClientRect().top + window.scrollY;
				return Math.round(top + 0.04 * (section.offsetHeight - window.innerHeight));
			});

		const prepare = await target("prepare");
		await story.getByRole("button", { name: "Prepare", exact: true }).click();
		// No smooth scroll in between: the page is there within the fade, not 1.5s later.
		await expect.poll(() => page.evaluate(() => Math.round(window.scrollY)), { timeout: 600 }).toBe(prepare);

		const remember = await target("remember");
		const positions: number[] = [];
		await story.getByRole("button", { name: "Remember", exact: true }).click();
		await expect
			.poll(
				async () => {
					const y = await page.evaluate(() => Math.round(window.scrollY));
					positions.push(y);
					return Math.abs(y - remember) <= 1;
				},
				{ timeout: 3000, intervals: [16] },
			)
			.toBe(true);
		// The next scene still scrolls there.
		expect(positions.some((y) => y > prepare && y < remember - 1)).toBe(true);
	});
});
