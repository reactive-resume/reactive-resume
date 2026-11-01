import type { Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { expect, test } from "../fixtures/test";

// No provider calls: synthetic accounts and local production server only.
test("explicit language and theme persist across fresh browser sessions", async ({
	authPage: page,
	browser,
	baseURL,
}, info) => {
	const renamed = await page.request.patch("/api/openapi/auth/profile", { data: { name: "Maya Chen" } });
	await expect(renamed).toBeOK();
	await page.goto("/dashboard/settings/preferences");
	await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeVisible();
	await page.screenshot({ animations: "disabled", path: info.outputPath("preferences-guide.png") });
	await page
		.locator("label")
		.filter({ has: page.getByRole("radio", { name: "Dark", exact: true }) })
		.click();
	await expect(page.getByRole("radio", { name: "Dark", exact: true })).toBeChecked();
	await page.getByRole("combobox", { name: "Interface language" }).click();
	await page.getByRole("option", { name: /German/ }).click();
	await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
	const cookies = (await page.context().cookies()).filter(({ name }) => name === "locale" || name === "theme");
	expect(cookies).toHaveLength(2);
	for (const cookie of cookies) {
		expect(cookie.expires).toBeGreaterThan(Date.now() / 1000 + 3600 * 24 * 360);
		expect(cookie.path).toBe("/");
		expect(cookie.sameSite).toBe("Lax");
	}
	await page.screenshot({ animations: "disabled", path: info.outputPath("preferences-de-dark.png") });

	await writeFile(info.outputPath("preferences-cookies.json"), JSON.stringify(cookies));
	const restoredContext = await browser.newContext({ baseURL });
	try {
		await restoredContext.addCookies(cookies);
		const restored = await restoredContext.newPage();
		await restored.goto("/auth/login");
		await expect(restored.locator("html")).toHaveAttribute("lang", "de-DE");
		await expect(restored.locator("html")).toHaveClass(/dark/);
	} finally {
		await restoredContext.close();
	}
});

test("route transitions set distinct titles and focus", async ({ authPage: page }) => {
	await page.goto("/dashboard");
	await expect(page).toHaveTitle("Documents | Reactive Resume");
	await page.getByRole("link", { name: "Applications", exact: true }).first().click();
	await expect(page).toHaveTitle("Applications | Reactive Resume");
	await expect(page.getByRole("heading", { name: "Applications", exact: true })).toBeFocused();
	await page.getByRole("link", { name: "Career", exact: true }).first().click();
	await expect(page).toHaveTitle("Today | Reactive Resume");
	await expect(page.getByRole("heading", { name: "Career", exact: true })).toBeFocused();
});

for (const { path, role, field } of [
	{ path: "/dashboard/applications?create=true", role: "dialog", field: "textarea" },
	{ path: "/dashboard/settings/account?deleteAccount=true", role: "alertdialog", field: "input" },
] as const) {
	test(`URL-open ${role} retains focus after route settles`, async ({ authPage: page }) => {
		await page.goto(path);
		const dialog = page.getByRole(role);
		await expect(dialog).toBeVisible();
		await page.evaluate(
			() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
		);
		await expect(dialog.locator(field).first()).toBeFocused();
	});
}

test("tablet drawer leaves canvas and zoom controls visible, closes on Escape, and isolates RTL addresses", async ({
	authPage: page,
}, info) => {
	await page.setViewportSize({ width: 820, height: 1180 });
	const renamed = await page.request.patch("/api/openapi/auth/profile", { data: { name: "Maya Chen" } });
	await expect(renamed).toBeOK();
	const created = await page.request.post("/api/openapi/resumes", {
		data: { name: "Synthetic tablet resume", tags: [], withSampleData: true },
	});
	await expect(created).toBeOK();
	const id = await created.json();
	await page.goto(`/builder/${id}`);
	await expect(page.locator("#main-content")).toBeFocused();
	await page.getByRole("button", { name: "Show panel", exact: true }).click();
	const panel = page.locator("#editor-panel");
	await expect(panel).toBeVisible();
	const panelBox = await panel.boundingBox();
	const canvasBox = await page.getByRole("region", { name: "Resume page", exact: true }).boundingBox();
	const zoomBox = await page.getByRole("button", { name: "Fit page to width", exact: true }).boundingBox();
	expect(panelBox).not.toBeNull();
	expect(canvasBox).not.toBeNull();
	expect(zoomBox).not.toBeNull();
	if (!panelBox || !canvasBox || !zoomBox) throw new Error("Missing tablet geometry");
	expect(canvasBox.x).toBeGreaterThanOrEqual(panelBox.x + panelBox.width);
	expect(zoomBox.x).toBeGreaterThanOrEqual(canvasBox.x);
	const drawnPage = page.locator('[data-resume-preview-template][aria-hidden="false"] canvas').first();
	await expect(drawnPage).toBeVisible();
	const pageFits = () =>
		drawnPage.evaluate((canvas) => {
			const viewport = canvas.closest("section")?.getBoundingClientRect();
			const paper = canvas.getBoundingClientRect();
			return !!viewport && paper.width > 0 && paper.left >= viewport.left && paper.right <= viewport.right + 1;
		});
	await expect.poll(pageFits).toBe(true);
	const name = page.getByRole("textbox", { name: "Full name", exact: true });
	await name.focus();
	await page.keyboard.press("Escape");
	await expect(page.getByRole("button", { name: "Show panel", exact: true })).toBeFocused();
	await expect(panel).toHaveAttribute("inert", "");
	await page.getByRole("button", { name: "Show panel", exact: true }).click();
	await expect.poll(pageFits).toBe(true);
	// Open through the page after explicit zoom; toolbar-only coverage missed this path.
	await page.getByRole("button", { name: "Hide panel", exact: true }).click();
	await page.getByRole("button", { name: "Zoom in", exact: true }).click();
	await expect(page.getByRole("button", { name: "Fit page to width", exact: true })).not.toHaveText("Fit");
	await page.locator('[data-slot="page-overlay"] [data-kind="header"]').first().click();
	await expect(panel).not.toHaveAttribute("inert");
	await expect(page.getByRole("button", { name: "Fit page to width", exact: true })).toHaveText("Fit");
	await expect.poll(pageFits).toBe(true);
	await page.screenshot({ animations: "disabled", path: info.outputPath("tablet-drawer.png") });
	await page.goto(`/builder/${id}?locale=ar-SA`);
	await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
	await page.locator("#editor-panel-toggle").click();
	const website = page.locator('[data-slot="input-group"]').filter({ hasText: "https://" }).first();
	await expect(website).toHaveAttribute("dir", "ltr");
	await expect(website).toHaveCSS("direction", "ltr");
	await expect(page.locator('input[type="email"]').first()).toHaveCSS("direction", "ltr");
	await expect(page.locator("bdi").filter({ hasText: "⌥↑↓" })).toHaveAttribute("dir", "ltr");
	await expect(page.locator('[data-resume-preview-template][aria-hidden="false"] canvas').first()).toBeVisible();
	await expect.poll(pageFits).toBe(true);
	await page.screenshot({ animations: "disabled", path: info.outputPath("tablet-rtl.png") });
});

test("control boundary contrast clears 3:1 in both themes", async ({ authPage: page }) => {
	const ratio = (control: Locator, track = false) =>
		control.evaluate((element, isTrack) => {
			const pixel = (color: string) => {
				const canvas = document.createElement("canvas");
				canvas.width = canvas.height = 1;
				const context = canvas.getContext("2d");
				if (!context) throw new Error("Canvas unavailable");
				context.fillStyle = color;
				context.fillRect(0, 0, 1, 1);
				return Array.from(context.getImageData(0, 0, 1, 1).data)
					.slice(0, 3)
					.map((value) => value / 255);
			};
			const luminance = (rgb: number[]) =>
				rgb
					.map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
					.reduce((sum, value, index) => sum + value * ([0.2126, 0.7152, 0.0722][index] ?? 0), 0);
			const style = getComputedStyle(element);
			let backdrop = isTrack ? element.parentElement : element;
			while (backdrop?.parentElement && getComputedStyle(backdrop).backgroundColor === "rgba(0, 0, 0, 0)")
				backdrop = backdrop.parentElement;
			const background = luminance(pixel(getComputedStyle(backdrop ?? element).backgroundColor));
			const contrast = (color: string) => {
				const boundary = luminance(pixel(color));
				return (Math.max(boundary, background) + 0.05) / (Math.min(boundary, background) + 0.05);
			};
			return {
				actual: contrast(isTrack ? style.backgroundColor : style.borderColor),
				old: contrast(getComputedStyle(document.documentElement).getPropertyValue("--line-2")),
			};
		}, track);
	const created = await page.request.post("/api/openapi/resumes", { data: { name: "Contrast fixture", tags: [] } });
	await expect(created).toBeOK();
	const id = await created.json();
	const job = await page.request.post("/api/openapi/applications", {
		data: { company: "Lumen Workshop", role: "Designer" },
	});
	await expect(job).toBeOK();
	const controls = [
		{ path: "/dashboard/settings/account", locate: () => page.getByRole("textbox", { name: "Name", exact: true }) },
		{ path: "/dashboard/applications", locate: () => page.locator('[data-slot="checkbox"]').first() },
		{
			path: "/dashboard/settings/preferences",
			locate: () => page.locator("label").filter({ has: page.getByRole("radio", { name: "Light", exact: true }) }),
		},
		{
			path: `/builder/${id}?mode=share`,
			locate: () =>
				page
					.getByRole("switch", { name: "Hide contact details", exact: true })
					.locator(':scope > span[aria-hidden="true"]'),
			track: true,
		},
	];
	for (const { path, locate, track } of controls) {
		await page.goto(path);
		await expect(locate()).toBeVisible();
		for (const dark of [false, true]) {
			await page.evaluate((enabled) => document.documentElement.classList.toggle("dark", enabled), dark);
			// Border and background transition independently; measure only after both finish.
			await locate().evaluate(async (element) => {
				await Promise.all(element.getAnimations().map((animation) => animation.finished));
			});
			const contrast = await ratio(locate(), track);
			expect(contrast.actual, `${path} dark=${dark}`).toBeGreaterThanOrEqual(3);
			expect(contrast.old, "old decorative boundary fails this same oracle").toBeLessThan(3);
		}
	}
});

test("populated German applications use contextual labels and distinct document selectors", async ({
	authPage: page,
}, info) => {
	await expect(await page.request.patch("/api/openapi/auth/profile", { data: { name: "Maya Chen" } })).toBeOK();
	const created = await page.request.post("/api/openapi/applications", {
		data: { company: "Lumen Workshop", role: "Accessibility Engineer", status: "saved" },
	});
	await expect(created).toBeOK();
	await page.goto("/dashboard/applications?locale=de-DE");
	await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
	await expect(page.getByText("Geschlossene Bewerbungen anzeigen", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Suchen oder einen Befehl ausführen…", exact: true })).toBeVisible();
	await expect(page.getByText("Keine Dokumente angehängt", { exact: true })).toBeVisible();
	await expect(page.getByText("Show geschlossen", { exact: true })).toHaveCount(0);
	await page.screenshot({ animations: "disabled", path: info.outputPath("german-applications.png") });
	await page.getByRole("button", { name: /Accessibility Engineer/ }).click();
	await page.getByRole("button", { name: "Als beworben markieren", exact: true }).click();
	await expect(page.locator("option").filter({ hasText: "Kein Lebenslauf ausgewählt" })).toHaveCount(1);
	await expect(page.locator("option").filter({ hasText: "Kein Anschreiben ausgewählt" })).toHaveCount(1);
});
