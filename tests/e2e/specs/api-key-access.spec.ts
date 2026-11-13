import { expect, test } from "../fixtures/test";

test("new API keys default to read-only and grant full access only when selected", async ({ authPage: page }) => {
	await page.goto("/dashboard/settings/developer");
	// The New key row's name carries its hint ("Starts read-only. …").
	const open = () => page.getByRole("button", { name: /^New key\b/ }).click();
	const dialog = page.getByRole("dialog", { name: "New API key" });
	const readOnly = dialog.getByRole("radio", { name: "Read only", exact: true });

	await open();
	await expect(readOnly).toBeChecked();
	await dialog.getByText("Read, write and delete", { exact: true }).click();
	await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
	await expect(dialog).toBeHidden();

	for (const selected of ["read", "full"] as const) {
		await open();
		await expect(readOnly).toBeChecked();
		if (selected === "full") await dialog.getByText("Read, write and delete", { exact: true }).click();
		await dialog.getByLabel("What's it for?").fill(`Fictional ${selected} client`);
		const issued = page.waitForResponse((response) => response.url().endsWith("/api/rpc/auth/createApiKey"));
		await dialog.getByRole("button", { name: "Create key", exact: true }).click();
		const response = await issued;
		expect(response.ok()).toBe(true);
		const { json } = await response.json();
		expect(typeof json.key).toBe("string");
		const headers = { "x-api-key": json.key, cookie: "" };
		const read = await page.request.get("/api/openapi/applications", { headers });
		expect(read.status()).toBe(200);
		const write = await page.request.post("/api/openapi/applications", {
			headers,
			data: { company: "Fictional Access Co", role: `${selected} access check` },
		});
		expect(write.status()).toBe(selected === "read" ? 403 : 200);
		await dialog.getByRole("button", { name: "Done", exact: true }).click();
		await expect(dialog).toBeHidden();
	}

	await open();
	await expect(readOnly).toBeChecked();
});
