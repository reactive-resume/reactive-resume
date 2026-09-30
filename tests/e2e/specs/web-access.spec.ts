import { expect, test } from "../fixtures/test";

test("selects, replaces and removes one optional web connection while the built-in reader stays active", async ({
	authPage: page,
}) => {
	await page.goto("/dashboard/settings/ai");
	const section = page
		.locator("section")
		.filter({ has: page.getByRole("heading", { name: "Web access", exact: true }) });
	await expect(section.getByText("Active", { exact: true })).toBeVisible();
	await expect(section.getByText("Not connected", { exact: true })).toBeVisible();
	await expect(section.getByLabel("API key", { exact: true })).toHaveCount(0);

	for (const [provider, label] of [
		["firecrawl", "Firecrawl"],
		["tavily", "Tavily"],
		["exa", "Exa"],
	] as const) {
		await section
			.getByRole("button", { name: provider === "firecrawl" ? "Connect a service" : "Change connection", exact: true })
			.click();
		await section.getByLabel("Provider", { exact: true }).selectOption(provider);
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

	await section.getByRole("button", { name: "Remove connection", exact: true }).click();
	await expect(section.getByText("Not connected", { exact: true })).toBeVisible();
	await expect(section.getByRole("button", { name: "Connect a service", exact: true })).toBeVisible();
	await expect(section.getByText("Active", { exact: true })).toBeVisible();
});
