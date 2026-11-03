import { expect, test } from "../fixtures/test";

test("Arabic public checker keeps score geometry numeric while its label is localized", async ({ page }) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	// Enter through a live client route so the prerender's upload input cannot be replaced during file selection.
	await page.goto("/auth/login?locale=ar-SA");
	await expect(page.getByRole("textbox").first()).toBeVisible();
	await page.locator('a[href="/"], a[href="/?locale=ar-SA"]').first().click();
	await page.locator('a[href^="/ats-checker"]').first().click();
	await page.locator('input[type="file"]').setInputFiles("apps/web/public/templates/pdf/onyx.pdf");
	const ring = page.locator(".score-ring");
	await expect(ring).toBeVisible();
	await expect(ring).toHaveAttribute("aria-label", /[٠-٩]+/);
	await expect(ring).not.toHaveAttribute("aria-label", /[0-9]/);
	await expect
		.poll(() =>
			ring.evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue("--ring-value"))),
		)
		.toBeGreaterThan(0);
	const value = await ring.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--ring-value"));
	expect(value).toMatch(/^\d+(?:\.\d+)?%$/);
	expect(Number.parseFloat(value)).toBeGreaterThan(0);
	await expect
		.poll(() => ring.evaluate((element) => getComputedStyle(element).getPropertyValue("--ring-value")))
		.toBe(value);
});

test("Arabic Insights localizes pipeline figures and weekly dates", async ({ authPage: page }) => {
	for (const status of ["applied", "offer"] as const) {
		await expect(
			await page.request.post("/api/openapi/applications", {
				data: { role: `Fictional 2026 ${status}`, company: "Lumen Workshop", status },
			}),
		).toBeOK();
	}
	await page.goto("/dashboard/applications?view=insights&locale=ar-SA");
	const flow = page
		.locator("svg")
		.filter({ has: page.locator("text") })
		.last();
	await expect(flow).toBeVisible();
	await expect(flow).toContainText("٢");
	await expect(flow).toContainText("٥٠%");
	expect(await flow.textContent()).not.toMatch(/[0-9]/);
	await expect(page.getByText(/^[٠-٩\u200f]+\/[٠-٩\u200f]+$/)).toHaveCount(8);
});

test("Arabic interface formats counts and page names while preserving authored content", async ({
	authPage: page,
}, info) => {
	const name = "Fictional 2026 resume";
	const created = await page.request.post("/api/openapi/resumes", {
		data: { name, tags: [], withSampleData: true },
	});
	await expect(created).toBeOK();
	const id = await created.json();
	await expect(
		await page.request.patch(`/api/openapi/resumes/${id}`, {
			data: { operations: [{ op: "replace", path: "/metadata/page/locale", value: "en-US" }] },
		}),
	).toBeOK();
	await page.goto("/dashboard?locale=ar-SA");
	await expect(page.locator("html")).toHaveAttribute("lang", "ar-SA");
	await expect(page.locator('[data-slot="tabs-count"]').first()).toHaveText("١");
	await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
	await page.setViewportSize({ width: 717, height: 1024 });
	await page.goto(`/builder/${id}?locale=ar-SA`);
	const preview = page.locator('[data-resume-preview-template][aria-hidden="false"]');
	await expect(preview.locator("canvas").first()).toBeVisible();
	await expect(preview.locator("canvas").first()).toHaveAttribute("aria-label", /١/);
	await expect(preview.locator("canvas").first()).not.toHaveAttribute("aria-label", /[0-9]/);
	const check = page.getByRole("tablist").first().getByRole("tab").nth(2);
	await expect(check.locator('span[aria-hidden="true"]').last()).toHaveText(/[٠-٩]+/);
	await check.click();
	const show = page.getByRole("button", { name: "إظهار اللوحة", exact: true });
	if (await show.isVisible()) await show.click();
	await expect(page.getByRole("img", { name: /١٠٠/ }).first()).toBeVisible();
	await expect(page.getByText(/أعمدة ٢/)).toBeVisible();
	const stored = await page.request.get(`/api/openapi/resumes/${id}`);
	await expect(stored).toBeOK();
	const resume = await stored.json();
	expect(resume.name).toBe(name);
	expect(resume.data.metadata.page.locale).toBe("en-US");
	await page.screenshot({ animations: "disabled", path: info.outputPath("arabic-numerals.png") });
});

for (const locale of ["en-US", "ar-SA"]) {
	test(`Career final tab clears the phone fade in ${locale}`, async ({ authPage: page }) => {
		await page.setViewportSize({ width: 320, height: 568 });
		await page.goto(`/dashboard/career?locale=${locale}`);
		await expect(page.locator("html")).toHaveAttribute("lang", locale);
		const tabs = page.getByRole("tablist").first();
		const last = tabs.getByRole("tab").last();
		await expect(last).toBeAttached();
		await tabs.evaluate((element) => {
			const scroller = element.parentElement;
			if (!scroller) throw new Error("Missing tab scroller");
			scroller.scrollLeft =
				getComputedStyle(scroller).direction === "rtl" ? -scroller.scrollWidth : scroller.scrollWidth;
		});
		await expect
			.poll(() =>
				last.evaluate((element) => {
					const scroller = element.closest('[data-slot="tabs"]');
					if (!scroller) throw new Error("Missing tab scroller");
					const viewport = scroller.getBoundingClientRect();
					const tab = element.getBoundingClientRect();
					return getComputedStyle(scroller).direction === "rtl" ? tab.left - viewport.left : viewport.right - tab.right;
				}),
			)
			.toBeGreaterThanOrEqual(24);
	});
}
