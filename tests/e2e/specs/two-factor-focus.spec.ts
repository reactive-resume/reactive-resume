import type { Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { expect, test } from "../fixtures/test";

test.use({ trace: "off", screenshot: "off", video: "off" });

function authenticatorCode(secret: string) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	const bits = [...secret.toUpperCase().replaceAll("=", "")]
		.map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
		.join("");
	const key = Buffer.from(
		Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
			Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2),
		),
	);
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
	const hash = createHmac("sha1", key).update(counter).digest();
	const offset = hash.readUInt8(hash.length - 1) & 15;
	return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
}

async function routeFocusSettled(page: Page) {
	await page.evaluate(
		() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
	);
}

test("two-step and backup verification receive typing after sign-in navigation", async ({
	authPage: page,
	account,
}, info) => {
	const headers = { origin: String(info.project.use.baseURL) };
	const enabled = await page.request.post("/api/auth/two-factor/enable", {
		headers,
		data: { password: account.password },
	});
	expect(enabled.status()).toBe(200);
	const setup = (await enabled.json()) as { totpURI: string; backupCodes: string[] };
	const backupCode = setup.backupCodes[0];
	if (!backupCode) throw new Error("Authenticator setup has no backup code.");
	const secret = new URL(setup.totpURI).searchParams.get("secret");
	if (!secret) throw new Error("Authenticator setup has no secret.");
	const verified = await page.request.post("/api/auth/two-factor/verify-totp", {
		headers,
		data: { code: authenticatorCode(secret) },
	});
	expect(verified.status()).toBe(200);
	try {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto("/dashboard/settings/account");
		await page.getByRole("button", { name: "Sign out", exact: true }).click();
		await expect(page).toHaveURL(/\/$/);
		await page.goto("/auth/login");
		await page.getByLabel("Email or username", { exact: true }).fill(account.email);
		await page.getByLabel("Password", { exact: true }).fill(account.password);
		await page.getByRole("button", { name: "Sign in", exact: true }).click();
		await expect(page).toHaveURL(/\/auth\/verify-2fa/);
		const digits = page.locator('[data-slot="otp-field-input"]');
		await expect(digits).toHaveCount(6);
		await routeFocusSettled(page);
		await expect(digits.first()).toBeFocused();
		const bounds = await digits.first().boundingBox();
		expect(bounds?.width).toBeGreaterThanOrEqual(44);
		expect(bounds?.height).toBeGreaterThanOrEqual(44);
		await page.screenshot({ path: info.outputPath("two-step-page.png"), animations: "disabled" });
		await page.keyboard.type("12");
		expect(await digits.evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value).join(""))).toBe(
			"12",
		);
		await page.getByRole("link", { name: "Lost access to your authenticator?", exact: true }).click();
		const backup = page.getByRole("textbox", { name: "Backup code", exact: true });
		await expect(backup).toBeVisible();
		await routeFocusSettled(page);
		await expect(backup).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(page.getByRole("checkbox")).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(backup).toBeFocused();
		await page.screenshot({ path: info.outputPath("backup-code-page.png"), animations: "disabled" });
		await page.keyboard.type(backupCode.toLowerCase().replaceAll("-", ""));
		await page.getByRole("button", { name: "Verify", exact: true }).click();
		await expect(page).toHaveURL(/\/dashboard/);
		expect((await page.request.get("/api/openapi/resumes")).status()).toBe(200);
	} finally {
		// Keep one-time codes out of Playwright's failure DOM context as well as traces and videos.
		if (!page.isClosed())
			await page.locator("input").evaluateAll((nodes) =>
				nodes.forEach((node) => {
					if (node instanceof HTMLInputElement) node.value = "";
				}),
			);
	}
});
