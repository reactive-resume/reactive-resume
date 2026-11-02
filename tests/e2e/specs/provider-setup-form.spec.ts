import { startAiStub } from "../fixtures/ai-stub";
import { expect, test } from "../fixtures/test";

test("model choices stay available with a default and preserve custom IDs", async ({ authPage: page }, info) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
	const catalogRequests: string[] = [];
	page.on("request", (request) => {
		if (new URL(request.url()).hostname === "models.dev") catalogRequests.push(request.url());
	});
	await page.goto("/dashboard/settings/ai");
	await page.getByRole("button", { name: /^Add AI provider/ }).click();
	const dialog = page.getByRole("dialog", { name: "Add provider" });
	const model = dialog.getByRole("combobox", { name: "Model", exact: true });
	await expect(model).toHaveValue("gpt-6-luna");
	await expect(dialog.getByText("Fast, lower-cost default for everyday work.", { exact: false })).toBeVisible();
	await dialog.getByRole("button", { name: "Choose model", exact: true }).click();
	await expect(page.getByRole("group", { name: "Recommended", exact: true })).toBeVisible();
	await expect(page.getByRole("option", { name: /GPT-4\.1/ })).toBeVisible();
	await page.screenshot({
		path: info.outputPath("model-choices.png"),
		animations: "disabled",
		fullPage: true,
	});
	await page.getByRole("option", { name: /GPT-6 Astra.*More capable/ }).click();
	await expect(model).toHaveValue("gpt-6-astra");
	await dialog.getByRole("button", { name: "Choose model", exact: true }).click();
	await expect(page.getByRole("option", { name: /GPT-6 Luna/ })).toBeVisible();
	await model.fill("terra");
	await expect(page.getByRole("option", { name: /GPT-6.1 Terra/ })).toBeVisible();
	await expect(page.getByRole("option", { name: /GPT-6 Luna/ })).toHaveCount(0);
	await model.press("ArrowDown");
	await model.press("Enter");
	await expect(model).toHaveValue("gpt-6.1-terra");
	await model.fill("fictional-private-model");
	await expect(dialog.getByRole("button", { name: "Save and test", exact: true })).toBeVisible();
	await model.blur();
	await expect(model).toHaveValue("fictional-private-model");
	expect(catalogRequests).toEqual([]);
});

test("changing provider clears the previous provider's draft key", async ({ authPage: page }) => {
	await page.goto("/dashboard/settings/ai");
	await page.getByRole("button", { name: /^Add AI provider/ }).click();
	const dialog = page.getByRole("dialog", { name: "Add provider" });
	await dialog.getByLabel("API key", { exact: true }).fill("fictional-openai-key");
	await dialog.getByRole("combobox", { name: "Provider", exact: true }).click();
	await page.getByRole("option", { name: "Anthropic Claude", exact: true }).click();
	await expect(dialog.getByLabel("API key", { exact: true })).toHaveValue("");
	await expect(dialog.getByRole("button", { name: "Save and test", exact: true })).toBeDisabled();
});

test("first-party provider setup keeps optional fields in Advanced and links to key setup", async ({
	authPage: page,
}, info) => {
	await page.goto("/dashboard/settings/ai");
	await page.getByRole("button", { name: /^Add AI provider/ }).click();
	const dialog = page.getByRole("dialog", { name: "Add provider" });
	await expect(dialog.getByLabel("Name", { exact: true })).toBeHidden();
	await expect(dialog.getByLabel("Base URL", { exact: true })).toBeHidden();
	await expect(dialog.getByRole("link", { name: "Get an API key" })).toHaveAttribute(
		"href",
		"https://platform.openai.com/api-keys",
	);
	await expect(dialog.getByText("Enter an API key for this provider.")).toBeVisible();
	await dialog.screenshot({ path: info.outputPath("add-provider-dialog.png") });
	await dialog.getByRole("button", { name: "Advanced", exact: true }).click();
	await dialog.getByLabel("Name", { exact: true }).fill("Fictional custom connection");
	await dialog.getByLabel("Base URL", { exact: true }).fill("gateway.example.test/v1");
	await dialog.getByLabel("Base URL", { exact: true }).blur();
	await dialog.getByRole("button", { name: "Advanced", exact: true }).click();
	await expect(dialog.getByLabel("Base URL", { exact: true })).toBeHidden();
	await expect(dialog.getByText("Enter an http:// or https:// base URL.")).toBeVisible();
	await expect(dialog.getByRole("button", { name: "Save and test", exact: true })).toBeDisabled();
	await dialog.getByRole("button", { name: "Advanced", exact: true }).click();
	await dialog.getByLabel("Base URL", { exact: true }).fill("https://gateway.example.test/v1");
	await dialog.getByRole("button", { name: "Advanced", exact: true }).click();
	await dialog.getByRole("button", { name: "Advanced", exact: true }).click();
	await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue("Fictional custom connection");
	await expect(dialog.getByLabel("Base URL", { exact: true })).toHaveValue("https://gateway.example.test/v1");
});

test("compatible setup rejects invalid URLs inline before sending and saves one valid connection", async ({
	authPage: page,
}) => {
	test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs local stub URL permission");
	const stub = await startAiStub();
	try {
		let creates = 0;
		page.on("request", (request) => {
			if (request.url().includes("/aiProviders/create")) creates++;
		});
		await page.goto("/dashboard/settings/ai");
		await page.getByRole("button", { name: /^Add AI provider/ }).click();
		const dialog = page.getByRole("dialog", { name: "Add provider" });
		await dialog.getByRole("combobox", { name: "Provider", exact: true }).click();
		await page.getByRole("option", { name: "OpenAI-compatible", exact: true }).click();
		await expect(dialog.getByRole("button", { name: "Choose model", exact: true })).toHaveCount(0);
		await expect(dialog.getByText("No built-in suggestions for this provider.")).toBeVisible();
		const url = dialog.getByLabel("Base URL (required)");
		await expect(url).toBeVisible();
		await dialog.getByLabel("API key", { exact: true }).fill("stub-key");
		await dialog.getByLabel("Model", { exact: true }).fill("stub");
		const save = dialog.getByRole("button", { name: "Save and test", exact: true });
		await expect(save).toBeDisabled();
		await url.fill("gateway.example.test/v1");
		await url.blur();
		await expect(url).toHaveAttribute("aria-invalid", "true");
		await expect(dialog.getByText("Enter an http:// or https:// base URL.").first()).toBeVisible();
		await expect(save).toBeDisabled();
		await dialog.getByLabel("Model", { exact: true }).press("Enter");
		expect(creates).toBe(0);
		await url.fill(stub.baseURL);
		await url.blur();
		await expect(save).toBeEnabled();
		await save.click();
		await page.getByRole("alertdialog").getByRole("button", { name: "Allow this operation", exact: true }).click();
		await expect(dialog).toBeHidden();
		expect(creates).toBe(1);
		const providers = await page.request.get("/api/openapi/ai-providers");
		expect(await providers.json()).toMatchObject([{ model: "stub", baseURL: stub.baseURL, testStatus: "success" }]);
	} finally {
		await stub.close();
	}
});

test("editing a custom first-party endpoint shows its address and requires a fresh key", async ({
	authPage: page,
}, info) => {
	test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs local stub URL permission");
	const first = await startAiStub();
	const second = await startAiStub();
	try {
		const created = await page.request.post("/api/openapi/ai-providers", {
			data: {
				provider: "openai",
				label: "Fictional custom OpenAI",
				model: "stub",
				apiKey: "fictional-first-key",
				baseURL: first.baseURL,
			},
		});
		await expect(created).toBeOK();
		const original = await created.json();
		let updates = 0;
		page.on("request", (request) => {
			if (request.url().includes("/aiProviders/update")) updates++;
		});
		await page.goto("/dashboard/settings/ai");
		await page.getByRole("button", { name: "Edit", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "Fictional custom OpenAI" });
		const url = dialog.getByLabel("Base URL", { exact: true });
		await expect(url).toBeVisible();
		await expect(url).toHaveValue(first.baseURL);
		await dialog.screenshot({ path: info.outputPath("edit-provider-dialog.png") });
		await url.fill(second.baseURL);
		await expect(dialog.getByText("The saved key isn't sent to a new base URL. Enter it again.")).toBeVisible();
		const save = dialog.getByRole("button", { name: "Save and test", exact: true });
		await expect(save).toBeDisabled();
		await dialog.getByLabel("Model", { exact: true }).press("Enter");
		expect(updates).toBe(0);
		expect(second.requests).toHaveLength(0);
		await dialog.getByLabel("API key", { exact: true }).fill("stub-key");
		await save.click();
		await page.getByRole("alertdialog").getByRole("button", { name: "Allow this operation", exact: true }).click();
		await expect(dialog).toBeHidden();
		expect(updates).toBe(1);
		expect(first.requests).toHaveLength(0);
		expect(second.requests.length).toBeGreaterThan(0);
		const providers = await page.request.get("/api/openapi/ai-providers");
		expect(await providers.json()).toMatchObject([
			{ id: original.id, model: "stub", baseURL: second.baseURL, testStatus: "success" },
		]);
	} finally {
		await Promise.all([first.close(), second.close()]);
	}
});
