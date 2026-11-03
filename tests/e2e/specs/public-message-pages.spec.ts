import type { Locator } from "@playwright/test";
import { expect, test } from "../fixtures/test";

async function appearance(locator: Locator) {
	return locator.evaluate((element) => {
		const style = getComputedStyle(element);
		let background = element;
		while (getComputedStyle(background).backgroundColor === "rgba(0, 0, 0, 0)" && background.parentElement)
			background = background.parentElement;
		const luminance = (color: string) => {
			const channels = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((part) => {
				const value = Number(part) / 255;
				return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
			});
			return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
		};
		const base = luminance(getComputedStyle(background).backgroundColor);
		const contrast = (color: string, backdrop = base) => {
			const foreground = luminance(color);
			return (Math.max(backdrop, foreground) + 0.05) / (Math.min(backdrop, foreground) + 0.05);
		};
		return {
			background: style.backgroundColor,
			text: contrast(style.color),
			border: contrast(style.borderColor),
			focus: contrast(style.outlineColor, luminance(getComputedStyle(document.body).backgroundColor)),
			radius: style.borderRadius,
		};
	});
}

for (const width of [1440, 390])
	for (const theme of ["light", "dark"] as const)
		test(`public password and unavailable pages stay readable at ${width}px in ${theme}`, async ({
			browser,
			authPage: owner,
			account,
		}, info) => {
			await owner.setViewportSize({ width, height: 900 });
			await owner.emulateMedia({ colorScheme: theme });
			const created = await owner.request.post("/api/openapi/resumes", {
				data: { name: "PRIVATE fictional message fixture", tags: [], withSampleData: true },
			});
			await expect(created).toBeOK();
			const id = (await created.json()) as string;
			const api = `/api/openapi/resumes/${id}`;
			await expect(await owner.request.put(api, { data: { slug: "fictional-message-page", isPublic: true } })).toBeOK();
			await expect(
				await owner.request.put(`${api}/password`, { data: { password: "fictional-message-password" } }),
			).toBeOK();
			const origin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;
			const url = `${origin}/${account.username}/fictional-message-page`;
			const visitor = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: theme });
			const desk = theme === "dark" ? "rgb(16, 15, 12)" : "rgb(248, 247, 243)";
			try {
				expect((await visitor.goto(url))?.status()).toBe(401);
				await expect(visitor.locator("body")).toHaveCSS("background-color", desk);
				const password = visitor.getByLabel("Password", { exact: true });
				await expect(password).toBeFocused();
				expect((await appearance(visitor.locator("h1"))).text).toBeGreaterThanOrEqual(4.5);
				expect((await appearance(visitor.locator("main > p"))).text).toBeGreaterThanOrEqual(4.5);
				const input = await appearance(password);
				expect(input.border).toBeGreaterThanOrEqual(3);
				await expect(password).toHaveCSS("border-top-style", "solid");
				await expect(password).toHaveCSS("border-top-width", "1px");
				await expect(password).toHaveCSS("outline-style", "solid");
				await expect(password).toHaveCSS("outline-width", "2px");
				expect(input.focus).toBeGreaterThanOrEqual(3);
				expect(input.radius).toBe("4px");
				const unlock = visitor.getByRole("button", { name: "Unlock", exact: true });
				expect((await appearance(unlock)).text).toBeGreaterThanOrEqual(4.5);
				await password.fill("fictional-wrong-password");
				await unlock.click();
				await expect(visitor.locator("#error")).toBeVisible();
				await expect(password).toHaveAttribute("aria-invalid", "true");
				await expect(password).toHaveAttribute("aria-describedby", "error");
				expect((await appearance(visitor.locator("#error"))).text).toBeGreaterThanOrEqual(4.5);
				await password.focus();
				await visitor.keyboard.press("Tab");
				await expect(unlock).toBeFocused();
				expect((await appearance(unlock)).focus).toBeGreaterThanOrEqual(3);
				await expect(unlock).toHaveCSS("outline-style", "solid");
				await expect(unlock).toHaveCSS("outline-width", "2px");
				await visitor.screenshot({ path: info.outputPath("password-error.png") });
				await password.fill("fictional-message-password");
				await unlock.click();
				await expect(visitor.getByRole("link", { name: "Download PDF", exact: true })).toBeVisible();
				await expect(visitor.locator("body")).toHaveCSS("background-color", desk);
				await expect(visitor.locator(".rr-page").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
				await expect(await owner.request.put(api, { data: { isPublic: false } })).toBeOK();
				expect((await visitor.reload())?.status()).toBe(404);
				await expect(visitor.locator("body")).toHaveCSS("background-color", desk);
				const home = visitor.getByRole("link", { name: "Go to Reactive Resume", exact: true });
				await expect(home).toHaveAttribute("href", `${origin}/`);
				await home.focus();
				expect((await appearance(home)).focus).toBeGreaterThanOrEqual(3);
				await expect(home).toHaveCSS("outline-style", "solid");
				await expect(home).toHaveCSS("outline-width", "2px");
				expect((await appearance(home)).text).toBeGreaterThanOrEqual(4.5);
				const unavailable = await visitor.locator("main").innerText();
				expect(unavailable).not.toContain("PRIVATE fictional message fixture");
				expect(unavailable).not.toContain(account.username);
				await visitor.screenshot({ path: info.outputPath("unavailable.png") });
				expect((await visitor.goto(`${url}-unknown`))?.status()).toBe(404);
				expect(await visitor.locator("main").innerText()).toBe(unavailable);
				expect((await owner.goto(url))?.status()).toBe(404);
				await expect(owner.locator("body")).toHaveCSS("background-color", desk);
				await owner.getByRole("link", { name: "Open Share", exact: true }).click();
				await expect(owner).toHaveURL(new RegExp(`/builder/${id}\\?mode=share$`));
				await expect(owner.getByRole("switch", { name: "Require a password", exact: true })).toBeChecked();
				expect(await visitor.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
				await info.attach("message-page-style", {
					body: JSON.stringify({ width, theme, desk, input }),
					contentType: "application/json",
				});
			} finally {
				await visitor.close();
			}
		});
