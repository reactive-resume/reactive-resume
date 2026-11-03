import { expect, test } from "../fixtures/test";

type ExitProof = { opacity: unknown; scale: unknown; duration: unknown };
declare global {
	interface Window {
		documentExits: ExitProof[];
		documentExitCanceled: boolean;
	}
}

test("phone New opens from the bottom, keeps its draft on resize and restores focus after every dismissal", async ({
	authPage: page,
}, info) => {
	const created = await page.request.post("/api/openapi/resumes", { data: { name: "Phone draft", tags: [] } });
	await expect(created).toBeOK();
	const id: string = await created.json();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/dashboard");
	const trigger = page.getByRole("button", { name: "New", exact: true });
	await trigger.click();
	const sheet = page.locator('[data-slot="sheet-content"][data-side="bottom"]');
	await expect(sheet).toBeVisible();
	await expect(sheet.getByRole("heading", { name: "New", exact: true })).toBeVisible();
	await page.screenshot({ path: info.outputPath("phone-new.png") });
	const choice = sheet.getByRole("combobox", { name: "Resume for a new letter", exact: true });
	await choice.selectOption(id);
	await page.setViewportSize({ width: 1280, height: 900 });
	await expect(choice).toHaveValue(id);
	await expect(sheet).toBeVisible();
	await page.setViewportSize({ width: 390, height: 844 });
	const bounds = await sheet.boundingBox();
	if (!bounds) throw new Error("New sheet has no bounds");
	expect(bounds.y + bounds.height).toBeCloseTo(844, 0);
	await page.keyboard.press("Tab");
	expect(await sheet.evaluate((element) => element.contains(document.activeElement))).toBe(true);
	await page.keyboard.press("Escape");
	await expect(sheet).toBeHidden();
	await expect(trigger).toBeFocused();
	await trigger.click();
	await expect(choice).toHaveValue("");
	await sheet.getByRole("button", { name: "Close", exact: true }).click();
	await expect(sheet).toBeHidden();
	await expect(trigger).toBeFocused();
	await trigger.click();
	await expect(sheet).toBeVisible();
	const swipe = await sheet.boundingBox();
	if (!swipe) throw new Error("New sheet has no swipe bounds");
	await page.mouse.move(swipe.x + swipe.width / 2, swipe.y + 8);
	await page.mouse.down();
	await page.mouse.move(swipe.x + swipe.width / 2, swipe.y + swipe.height * 0.8, { steps: 12 });
	await page.mouse.up();
	await expect(sheet).toBeHidden();
	await expect(trigger).toBeFocused();
});

test("reduced motion keeps a short dialog opacity fade with no scale transition", async ({ authPage: page }, info) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/dashboard");
	await page.getByRole("button", { name: "New", exact: true }).click();
	const dialog = page.locator('[data-slot="dialog-content"]');
	await expect(dialog).toBeVisible();
	const style = await dialog.evaluate((element) => {
		const value = getComputedStyle(element);
		return { property: value.transitionProperty, duration: value.transitionDuration, scale: value.scale };
	});
	await info.attach("reduced-motion-dialog", { body: JSON.stringify(style), contentType: "application/json" });
	expect(style.property).toBe("opacity");
	expect(Number.parseFloat(style.duration)).toBeGreaterThanOrEqual(0.08);
	expect(Number.parseFloat(style.duration)).toBeLessThanOrEqual(0.2);
	expect(["1", "none"]).toContain(style.scale);
	await page.emulateMedia({ reducedMotion: "no-preference" });
	await expect
		.poll(() => dialog.evaluate((element) => getComputedStyle(element).transitionProperty))
		.toContain("scale");
	await page.emulateMedia({ reducedMotion: "reduce" });
	await expect.poll(() => dialog.evaluate((element) => getComputedStyle(element).transitionProperty)).toBe("opacity");
});

for (const interruption of ["filter", "navigation", "animation failure"] as const)
	test(`accepted Trash survives ${interruption}`, async ({ authPage: page }) => {
		const created = await page.request.post("/api/openapi/resumes", {
			data: { name: "Motion interrupted document", tags: [] },
		});
		await expect(created).toBeOK();
		const id: string = await created.json();
		await page.addInitScript((failure) => {
			const original = Element.prototype.animate;
			window.documentExits = [];
			window.documentExitCanceled = false;
			Element.prototype.animate = function (...args) {
				if (!this.matches("[data-document-key]")) return original.apply(this, args);
				window.documentExits.push({ opacity: 0, scale: undefined, duration: 10_000 });
				if (failure) throw new Error("Animation platform unavailable");
				const animation = original.apply(this, args);
				animation.effect?.updateTiming({ duration: 10_000 });
				animation.addEventListener("cancel", () => {
					window.documentExitCanceled = true;
				});
				return animation;
			};
		}, interruption === "animation failure");
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "Options for Motion interrupted document", exact: true }).click();
		await page.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
		await expect.poll(() => page.evaluate(() => window.documentExits.length)).toBe(1);
		if (interruption === "filter") {
			await page.getByRole("searchbox", { name: "Search documents", exact: true }).fill("no match");
		} else if (interruption === "navigation") {
			const started = Date.now();
			await page
				.getByRole("complementary", { name: "App navigation" })
				.getByRole("link", { name: "Applications", exact: true })
				.click();
			expect(Date.now() - started).toBeLessThan(3000);
		}
		if (interruption !== "animation failure")
			await expect.poll(() => page.evaluate(() => window.documentExitCanceled), { timeout: 3000 }).toBe(true);
		// Cancellation or platform failure releases presentation without losing the accepted server result.
		await expect(page.locator('[data-slot="toast"]').filter({ hasText: "moved to Trash" })).toBeVisible({
			timeout: 3000,
		});
		await page.goto("/dashboard/trash");
		await expect(
			page.getByRole("button", { name: "Options for Motion interrupted document", exact: true }),
		).toBeVisible();
		const read = await page.request.get("/api/openapi/documents?trashed=true");
		await expect(read).toBeOK();
		expect(await read.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id })]));
	});

for (const { view, reduced } of [
	{ view: "grid", reduced: false },
	{ view: "list", reduced: false },
	{ view: "list", reduced: true },
])
	test(`only confirmed ${view} trash/restore actions fade; filters stay instant (reduced=${reduced})`, async ({
		authPage: page,
	}, info) => {
		const created = await page.request.post("/api/openapi/resumes", {
			data: { name: "Motion retained document", tags: [] },
		});
		await expect(created).toBeOK();
		const id: string = await created.json();
		await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
		// Record the real browser animation's computed frames; the platform still executes every animation.
		await page.addInitScript(() => {
			const original = Element.prototype.animate;
			window.documentExits = [];
			Element.prototype.animate = function (...args) {
				const animation = original.apply(this, args);
				if (this.matches("article,tr") && this.textContent?.includes("Motion retained document")) {
					const frames = (animation.effect as KeyframeEffect).getKeyframes();
					const final = frames.at(-1);
					if (String(final?.opacity) === "0")
						window.documentExits.push({
							opacity: final?.opacity,
							scale: final?.scale,
							duration: animation.effect?.getTiming().duration,
						});
				}
				return animation;
			};
		});
		await page.goto(`/dashboard?view=${view}`);
		const search = page.getByRole("searchbox", { name: "Search documents", exact: true });
		await search.fill("no matching document");
		await expect(page.getByRole("link", { name: "Motion retained document", exact: true })).toHaveCount(0);
		expect(await page.evaluate(() => window.documentExits)).toEqual([]);
		await search.fill("");
		const options = page.getByRole("button", { name: "Options for Motion retained document", exact: true });
		await options.click();
		// A real concurrent lock refuses Trash: no successful receipt, no outgoing animation.
		const locked = await page.request.post("/api/rpc/documents/setLocked", {
			data: { json: { type: "resume", id, isLocked: true } },
		});
		await expect(locked).toBeOK();
		await page.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
		await expect(page.locator('[data-slot="toast"]')).toBeVisible();
		await expect(options).toBeVisible();
		expect(await page.evaluate(() => window.documentExits)).toEqual([]);
		const unlocked = await page.request.post("/api/rpc/documents/setLocked", {
			data: { json: { type: "resume", id, isLocked: false } },
		});
		await expect(unlocked).toBeOK();
		await page.reload();
		await options.click();
		await page.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
		await expect.poll(() => page.evaluate(() => window.documentExits.length)).toBe(1);
		const exit = await page.evaluate(() => window.documentExits[0]);
		expect(exit?.opacity).toBe("0");
		expect(Number(exit?.duration)).toBeCloseTo(reduced ? 120 : 140, 3);
		expect(exit?.scale).toBe(reduced ? undefined : "0.98");
		await expect(page.getByRole("heading", { name: "No documents", exact: true })).toBeVisible();
		if (view === "grid") await page.screenshot({ path: info.outputPath("quiet-library.png") });
		await expect(page.getByText("Let's start with what you have", { exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await expect(options).toBeVisible();
		expect(await page.evaluate(() => window.documentExits.length)).toBe(1);
		await options.click();
		await page.getByRole("menuitem", { name: "Move to Trash", exact: true }).click();
		await expect(page.getByRole("heading", { name: "No documents", exact: true })).toBeVisible();
		await page.goto("/dashboard/trash");
		await options.click();
		await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
		await expect.poll(() => page.evaluate(() => window.documentExits.length)).toBe(1);
		await expect(options).toHaveCount(0);
		const read = await page.request.get(`/api/openapi/resumes/${id}`);
		await expect(read).toBeOK();
	});
