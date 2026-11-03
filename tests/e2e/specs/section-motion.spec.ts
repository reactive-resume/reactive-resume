import type { Locator } from "@playwright/test";
import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

async function timing(row: Locator) {
	return row.evaluate(async (element) => {
		await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
		const button = element.querySelector<HTMLButtonElement>(
			'button[aria-label="Open Education"], button[aria-label="Close Education"]',
		);
		const panel = element.querySelector<HTMLElement>('[data-slot="collapsible-content"]');
		if (!button) throw new Error("Education toggle is missing.");
		return {
			chevron: Number.parseFloat(getComputedStyle(button).transitionDuration),
			panel: panel ? Number.parseFloat(getComputedStyle(panel).transitionDuration) : null,
			heightAnimations:
				panel
					?.getAnimations()
					.flatMap((animation) =>
						animation instanceof CSSTransition && animation.transitionProperty === "height"
							? [Number(animation.effect?.getTiming().duration)]
							: [],
					) ?? [],
		};
	});
}

for (const reducedMotion of ["no-preference", "reduce"] as const)
	test(`section chevron follows panel timing with motion=${reducedMotion}`, async ({ authPage: page }, info) => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.emulateMedia({ reducedMotion });
		await createSampleResumeFromDashboard(page, info);
		const row = page.locator("#sidebar-education");
		const title = row.getByRole("button", { name: "Education", exact: true });
		const open = row.getByRole("button", { name: "Open Education", exact: true });
		await open.click();
		await expect(title).toHaveAttribute("aria-expanded", "true");
		const opening = await timing(row);
		await expect
			.poll(() =>
				row.locator('[data-slot="collapsible-content"]').evaluate((element) => element.getAnimations().length),
			)
			.toBe(0);
		const close = row.getByRole("button", { name: "Close Education", exact: true });
		await close.focus();
		await page.keyboard.press("Enter");
		await expect(title).toHaveAttribute("aria-expanded", "false");
		await expect(open).toBeFocused();
		const closing = await timing(row);
		await info.attach("section-timing", {
			body: JSON.stringify({ reducedMotion, opening, closing }),
			contentType: "application/json",
		});
		if (reducedMotion === "reduce") {
			expect(opening.chevron).toBeLessThanOrEqual(0.001);
			expect(closing.chevron).toBeLessThanOrEqual(0.001);
			await expect(row.locator('[data-slot="collapsible-content"]')).toBeHidden();
		} else {
			expect(opening.chevron).toBeCloseTo(0.2);
			expect(opening.panel).toBeCloseTo(0.2);
			expect(closing.chevron).toBeCloseTo(0.14);
			expect(closing.panel).toBeCloseTo(0.14);
			expect(closing.heightAnimations).toHaveLength(1);
			expect(closing.heightAnimations[0]).toBeCloseTo(140);
		}
	});
