import { expect, test } from "../fixtures/test";

for (const platform of ["Win32", "Linux x86_64", "MacIntel"]) {
	for (const kind of ["resume", "letter"]) {
		test(`${platform} ${kind} assistant preserves browser Downloads and retains eligible toggle`, async ({
			authPage: page,
		}) => {
			await page.addInitScript(
				(platform) => Object.defineProperty(navigator, "platform", { configurable: true, get: () => platform }),
				platform,
			);
			const created = await page.request.post(
				kind === "resume" ? "/api/openapi/resumes" : "/api/openapi/cover-letters",
				{
					data:
						kind === "resume" ? { name: "Fictional shortcut audit", tags: [] } : { name: "Fictional shortcut audit" },
				},
			);
			await expect(created).toBeOK();
			const document = await created.json();
			await page.goto(kind === "resume" ? `/builder/${document}` : `/builder/letter/${document.id}`);
			const toggle = page.locator("[data-assistant-toggle]");
			await expect(toggle).toHaveAttribute("aria-pressed", "false");
			await toggle.focus();
			const key = platform === "MacIntel" ? "Meta+j" : "Control+j";
			if (platform === "MacIntel") await page.keyboard.press(key);
			else {
				// Inspect default handling without opening Chromium’s external Downloads UI.
				const prevented = await toggle.evaluate((element) => {
					const event = new KeyboardEvent("keydown", {
						key: "j",
						code: "KeyJ",
						ctrlKey: true,
						bubbles: true,
						cancelable: true,
					});
					element.dispatchEvent(event);
					element.dispatchEvent(
						new KeyboardEvent("keyup", { key: "j", code: "KeyJ", ctrlKey: true, bubbles: true, cancelable: true }),
					);
					return event.defaultPrevented;
				});
				expect(prevented).toBe(false);
			}
			if (platform !== "MacIntel") {
				await expect(toggle).toHaveAttribute("aria-pressed", "false");

				await toggle.click();
			}
			await expect(toggle).toHaveAttribute("aria-pressed", "true");
			await toggle.focus();
			await page.keyboard.press(key);
			await expect(toggle).toHaveAttribute("aria-pressed", "false");
		});
	}
}
