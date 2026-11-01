import { Pool } from "pg";
import { expect, test } from "../fixtures/test";

test("selects, replaces and removes one optional web connection while the built-in reader stays active", async ({
	authPage: page,
	account,
}, testInfo) => {
	let probes = 0;
	page.on("request", (request) => {
		if (new URL(request.url()).pathname === "/api/rpc/webAccess/test") probes += 1;
	});
	await page.goto("/dashboard/settings/ai");
	const section = page
		.locator("section")
		.filter({ has: page.getByRole("heading", { name: "Web access", exact: true }) });
	await expect(section.getByText("Active", { exact: true })).toBeVisible();
	await expect(section.getByText("Optional", { exact: true })).toBeVisible();
	await expect(section.getByLabel("API key", { exact: true })).toHaveCount(0);

	for (const [provider, label] of [
		["firecrawl", "Firecrawl"],
		["tavily", "Tavily"],
		["exa", "Exa"],
	] as const) {
		await section
			.getByRole("button", { name: provider === "firecrawl" ? "Connect a service" : "Change connection", exact: true })
			.click();
		await section.getByRole("radio", { name: label, exact: true }).check();
		await section.getByLabel("API key", { exact: true }).fill(`fake-${provider}-e2e-key`);
		const saved = page.waitForResponse(
			(response) => new URL(response.url()).pathname === "/api/rpc/webAccess/save" && response.ok(),
		);
		await section.getByRole("button", { name: "Save connection", exact: true }).click();
		await saved;
		await expect(section.getByText(label, { exact: true })).toBeVisible();
		await page.reload();
		await expect(section.getByText(label, { exact: true })).toBeVisible();
		await expect(section.getByText("Active", { exact: true })).toBeVisible();
		await expect(section.getByLabel("API key", { exact: true })).toHaveCount(0);
	}

	const pool = new Pool({ connectionString: process.env.DATABASE_URL });
	try {
		const stored = async () =>
			(
				await pool.query(
					' select c.provider, md5(c.encrypted_api_key) as key_fingerprint, c.test_result, c.last_tested_at from web_access_credentials c join "user" u on u.id = c.user_id where u.email = $1',
					[account.email],
				)
			).rows;
		const before = await stored();
		expect(before).toHaveLength(1);
		await section.getByRole("button", { name: "Remove connection", exact: true }).click();
		const confirmation = page.getByRole("alertdialog", { name: "Remove the web connection?" });
		await expect(confirmation).toBeVisible();
		await expect(confirmation).toContainText("You'll need to enter the key again");
		expect(await stored()).toEqual(before);
		await page.screenshot({
			path: testInfo.outputPath("remove-web-connection-confirmation.png"),
			animations: "disabled",
		});
		await confirmation.getByRole("button", { name: "Keep connection", exact: true }).click();
		await expect(confirmation).not.toBeVisible();
		expect(await stored()).toEqual(before);
		await page.reload();
		await expect(section.getByText("Exa", { exact: true })).toBeVisible();
		await section.getByRole("button", { name: "Remove connection", exact: true }).click();
		await confirmation.getByRole("button", { name: "Remove connection", exact: true }).click();
		await expect.poll(stored).toEqual([]);
	} finally {
		await pool.end();
	}
	await expect(section.getByText("Optional", { exact: true })).toBeVisible();
	await expect(section.getByRole("button", { name: "Connect a service", exact: true })).toBeVisible();
	await expect(section.getByText("Active", { exact: true })).toBeVisible();
	expect(probes).toBe(0);
});
