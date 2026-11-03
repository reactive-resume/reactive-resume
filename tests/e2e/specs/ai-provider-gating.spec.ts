import type { Page } from "@playwright/test";
import { startAiStub } from "../fixtures/ai-stub";
import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs local stub URL permission");
let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
});
const consent = async (page: Page, name = "Allow this operation") => {
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toContainText("127.0.0.1");
	await dialog.getByRole("button", { name, exact: true }).click();
};
async function saveProvider(page: Page, label: string) {
	const response = await page.request.post("/api/openapi/ai-providers", {
		data: { label, provider: "openai-compatible", model: "stub", baseURL: stub.baseURL, apiKey: "stub-key" },
	});
	await expect(response).toBeOK();
	const provider = (await response.json()) as { id: string };
	await expect(await page.request.post(`/api/openapi/ai-providers/${provider.id}/test`)).toBeOK();
	return provider;
}

async function connectProvider(page: Page) {
	await page.getByRole("button", { name: /^Add AI provider/ }).click();
	const dialog = page.getByRole("dialog", { name: "Add provider", exact: true });
	await dialog.getByRole("combobox", { name: "Provider", exact: true }).click();
	await page.getByRole("option", { name: "OpenAI-compatible", exact: true }).click();
	await dialog.getByLabel("Base URL").fill(stub.baseURL);
	await dialog.getByLabel("Model", { exact: true }).fill("stub");
	await dialog.getByLabel("API key", { exact: true }).fill("stub-key");
	await dialog.getByRole("button", { name: "Save and test", exact: true }).click();
	await consent(page);
	await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("provider retries update one row, Test preserves Off, and no public catalog is requested", async ({
	authPage: page,
}, info) => {
	test.setTimeout(90000);
	const thirdParty: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("models.dev")) thirdParty.push(request.url());
	});
	await page.goto("/dashboard/settings/ai");
	const billing = page.getByText("Your provider may charge your account for requests made with your API key.", {
		exact: true,
	});
	await expect(billing).toBeVisible();
	await page.getByRole("button", { name: /^Add AI provider/ }).click();
	await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
	await expect(page.getByRole("heading", { name: "AI is ready", exact: true })).toBeHidden();
	await page.getByRole("button", { name: /^Add AI provider/ }).click();
	const dialog = page.getByRole("dialog", { name: "Add provider", exact: true });
	await dialog.getByRole("combobox", { name: "Provider", exact: true }).click();
	await page.getByRole("option", { name: "OpenAI-compatible", exact: true }).click();
	await dialog.getByLabel("Base URL").fill(stub.baseURL);
	await dialog.getByLabel("Model", { exact: true }).fill("stub");
	await dialog.getByLabel("API key", { exact: true }).fill("invalid-stub-key");
	for (let n = 0; n < 2; n++) {
		await dialog.getByRole("button", { name: "Save and test", exact: true }).click();
		await consent(page);
		await expect(dialog.getByText("The key was rejected. Check the key and test again.")).toBeVisible();
		await expect(page.getByRole("heading", { name: "AI is ready", exact: true })).toBeHidden();
	}
	const listed = await page.request.get("/api/openapi/ai-providers");
	expect(await listed.json()).toHaveLength(1);
	await dialog.getByLabel("API key", { exact: true }).fill("stub-key");
	await dialog.getByRole("button", { name: "Save and test", exact: true }).click();
	await consent(page);
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await expect(page.getByRole("heading", { name: "AI is ready", exact: true })).toBeVisible();
	const ready = page.getByRole("region", { name: "AI is ready", exact: true });
	for (const name of ["Improve selected line", "Review writing", "Check fit", "New cover letter", "Ask the coach"])
		await expect(ready.getByRole("button", { name, exact: true })).toBeVisible();
	await expect(billing).toBeVisible();
	const providerSection = page
		.locator("section")
		.filter({ has: page.getByRole("heading", { name: "AI providers", exact: true }) });
	await providerSection.screenshot({ path: info.outputPath("provider-connected.png") });
	await page.getByRole("button", { name: "Edit", exact: true }).click();
	await page.getByRole("switch", { name: "Use this provider" }).click();
	await expect(page.getByRole("switch", { name: "Use this provider" })).not.toBeChecked();
	await page.getByRole("button", { name: "Close", exact: true }).click();
	const retest = page.waitForResponse((response) => response.url().endsWith("/api/rpc/aiProviders/test"));
	await page.getByRole("button", { name: "Test", exact: true }).first().click();
	await consent(page);
	expect((await retest).ok()).toBe(true);
	await expect(providerSection.getByRole("button", { name: "Test", exact: true })).toBeVisible();
	await expect(providerSection.getByRole("status")).toHaveText(/^Connected · \d+ ms$/);
	const after = await page.request.get("/api/openapi/ai-providers");
	await expect
		.poll(async () => (await (await page.request.get("/api/openapi/ai-providers")).json())[0].enabled)
		.toBe(false);
	expect((await after.json())[0].isDefault).toBe(true);
	await expect(page.getByText("Off", { exact: true })).toBeVisible();
	expect(thirdParty).toEqual([]);
	await page.getByRole("heading", { name: "AI providers", exact: true }).scrollIntoViewIfNeeded();
	await providerSection.screenshot({ path: info.outputPath("provider-off.png") });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.emulateMedia({ colorScheme: "light" });
	await providerSection.screenshot({ path: info.outputPath("provider-off-390-light.png") });
	await page.emulateMedia({ colorScheme: "dark" });
	await providerSection.screenshot({ path: info.outputPath("provider-off-390-dark.png") });
	await connectProvider(page);
	await expect(ready).toBeHidden();
});

for (const action of ["Improve selected line", "Review writing", "Check fit", "New cover letter", "Ask the coach"]) {
	test(`first connection opens the existing ${action} flow without generating`, async ({ authPage: page }, info) => {
		test.setTimeout(90000);
		let resumeId = "";
		if (action === "Improve selected line" || action === "Review writing") {
			await createSampleResumeFromDashboard(page, info);
			resumeId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
		}
		let applicationId = "";
		if (action === "Check fit") {
			const created = await page.request.post("/api/openapi/applications", {
				data: { company: "Fictional next steps", role: "Engineer", status: "saved" },
			});
			await expect(created).toBeOK();
			applicationId = await created.json();
		}
		await page.goto("/dashboard/settings/ai");
		await connectProvider(page);
		const requests = stub.requests.length;
		await page.getByRole("region", { name: "AI is ready", exact: true }).getByRole("button", { name: action }).click();
		if (resumeId) {
			await page.getByRole("dialog").getByRole("button", { name: /E2E/ }).click();
			await expect(page).toHaveURL(
				new RegExp(`/builder/${resumeId}\\?mode=${action === "Review writing" ? "check" : "write"}`),
			);
			if (action === "Review writing") {
				await expect(page.getByRole("tab", { name: "Writing", exact: true })).toHaveAttribute("aria-selected", "true");
				await expect(page.getByRole("button", { name: "Review writing", exact: true })).toBeVisible();
			} else await expect(page.getByRole("tab", { name: /^Write/ })).toHaveAttribute("aria-selected", "true");
		} else if (applicationId) {
			await page.getByRole("dialog").getByRole("button", { name: "Engineer · Fictional next steps" }).click();
			await expect(page).toHaveURL(new RegExp(`/dashboard/applications/${applicationId}/fit`));
		} else if (action === "New cover letter") {
			await expect(page.getByRole("dialog")).toContainText("New cover letter");
			await page
				.getByRole("dialog")
				.getByRole("button", { name: /^New cover letter/ })
				.click();
			await expect(page).toHaveURL(/\/builder\/letter\//);
		} else {
			await expect(page).toHaveURL(/\/dashboard\/career\/coach/);
			await expect(page.getByLabel("Message the coach")).toBeVisible();
		}
		expect(stub.requests.length).toBe(requests);
	});
}

test("first connection offers real creation flows for empty accounts and dismisses", async ({
	authPage: page,
}, info) => {
	await page.goto("/dashboard/settings/ai");
	await connectProvider(page);
	const ready = page.getByRole("region", { name: "AI is ready", exact: true });
	const requests = stub.requests.length;
	await ready.screenshot({ path: info.outputPath("first-connection-next-steps.png") });
	await page.setViewportSize({ width: 390, height: 844 });
	await ready.screenshot({ path: info.outputPath("first-connection-next-steps-390.png") });
	await ready.getByRole("button", { name: "Improve selected line", exact: true }).click();
	let dialog = page.getByRole("dialog");
	await expect(dialog).toContainText("No resumes yet");
	await dialog.getByRole("button", { name: "Import or create a resume", exact: true }).click();
	dialog = page.getByRole("dialog");
	await expect(dialog.getByRole("button", { name: /^Import a resume/ })).toBeVisible();
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	await ready.getByRole("button", { name: "Check fit", exact: true }).click();
	await expect(page.getByRole("dialog")).toContainText("No applications yet.");
	await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
	await ready.getByRole("button", { name: "Dismiss", exact: true }).click();
	await expect(ready).toBeHidden();
	expect(stub.requests.length).toBe(requests);
	await connectProvider(page);
	await expect(ready).toBeHidden();
});

test("Writing review survives reload and remains readable without a provider", async ({ authPage: page }, info) => {
	test.setTimeout(90000);
	const provider = await saveProvider(page, "Fictional review connection");
	await createSampleResumeFromDashboard(page, info);
	await page.getByRole("tab", { name: /^Check/ }).click();
	await page.getByRole("tab", { name: "Writing", exact: true }).click();
	await page.getByRole("button", { name: "Review writing", exact: true }).click();
	await consent(page);
	await expect(page.getByText("Fictional writing review retained after reload.")).toBeVisible();
	const count = stub.requests.length;
	await page.reload();
	await page.getByRole("tab", { name: "Writing", exact: true }).click();
	await expect(page.getByText("Fictional writing review retained after reload.")).toBeVisible();
	expect(stub.requests.length).toBe(count);
	await expect(
		await page.request.patch(`/api/openapi/ai-providers/${provider.id}`, { data: { enabled: false } }),
	).toBeOK();
	await page.reload();
	await page.getByRole("tab", { name: "Writing", exact: true }).click();
	await expect(page.getByText("Fictional writing review retained after reload.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Set up AI", exact: true })).toBeVisible();
	await page
		.getByRole("tabpanel", { name: /^Check/ })
		.screenshot({ path: info.outputPath("writing-review-saved.png") });
});

test("palette Ask picks a document and retains an unsent composer draft", async ({ authPage: page }, info) => {
	test.setTimeout(90000);
	await saveProvider(page, "Fictional palette connection");
	await createSampleResumeFromDashboard(page, info);
	await page.goto("/dashboard");
	const requestsBefore = stub.requests.length;
	await page.getByRole("button", { name: /Search or run/ }).click();
	await page.getByRole("combobox", { name: "Search commands" }).fill("Tighten my fictional summary");
	await page.getByRole("option", { name: "Ask the assistant “Tighten my fictional summary”" }).click();
	await page.getByRole("option").filter({ hasText: /E2E/ }).first().click();
	await expect(page.getByLabel("Message the assistant")).toHaveValue("Tighten my fictional summary");
	expect(stub.requests.length).toBe(requestsBefore);
	await page
		.getByRole("region", { name: "Assistant", exact: true })
		.screenshot({ path: info.outputPath("palette-unsent-draft.png") });
});

test("unavailable conversation keeps history and pending edits until an approved destination change", async ({
	authPage: page,
}, info) => {
	test.setTimeout(90000);
	const first = await saveProvider(page, "Fictional original connection");
	const second = await saveProvider(page, "Fictional alternate connection");
	await createSampleResumeFromDashboard(page, info);
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	await page.getByLabel("Message the assistant").fill("Tighten my fictional resume");
	await page.getByLabel("Message the assistant").press("Enter");
	await consent(page);
	const edits = page.getByRole("list", { name: "Proposed edits" });
	await expect(edits).toBeVisible({ timeout: 20000 });
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
	const list = await page.request.get("/api/openapi/agent/threads");
	const threads = (await list.json()) as { id: string; aiProviderId: string }[];
	const thread = threads[0];
	expect(thread?.aiProviderId).toBe(first.id);
	await expect(
		await page.request.patch(`/api/openapi/ai-providers/${first.id}`, { data: { enabled: false } }),
	).toBeOK();
	const count = stub.requests.length;
	await page.reload();
	// The open conversation is in the URL, so a reload brings the assistant back on it.
	await expect(page.getByRole("region", { name: "Assistant" })).toBeVisible();
	await expect(edits).toBeVisible();
	await expect(page.getByText("This conversation's AI connection is unavailable.", { exact: false })).toBeVisible();
	const unchanged = await page.request.get(`/api/openapi/agent/threads/${thread?.id}`);
	expect((await unchanged.json()).thread.aiProviderId).toBe(first.id);
	expect(stub.requests.length).toBe(count);
	await page.getByRole("button", { name: /Fictional original connection/ }).click();
	await page.getByRole("menuitem", { name: /Fictional alternate connection/ }).click();
	const confirmation = page.getByRole("alertdialog");
	await expect(confirmation).toContainText("Earlier messages and attachments");
	await confirmation.getByRole("button", { name: "Don't share", exact: true }).click();
	expect((await (await page.request.get(`/api/openapi/agent/threads/${thread?.id}`)).json()).thread.aiProviderId).toBe(
		first.id,
	);
	await page.getByRole("button", { name: /Fictional original connection/ }).click();
	await page.getByRole("menuitem", { name: /Fictional alternate connection/ }).click();
	await consent(page, "Use this destination");
	await expect
		.poll(
			async () =>
				(await (await page.request.get(`/api/openapi/agent/threads/${thread?.id}`)).json()).thread.aiProviderId,
		)
		.toBe(second.id);
	await expect(edits).toBeVisible();
	expect(stub.requests.length).toBe(count);
	await page
		.getByRole("region", { name: "Assistant", exact: true })
		.screenshot({ path: info.outputPath("conversation-explicit-destination.png") });
});

test("German provider failure gives a translated recovery at phone width", async ({ authPage: page }, info) => {
	const created = await page.request.post("/api/openapi/ai-providers", {
		data: {
			label: "Fictional rejected connection",
			provider: "openai-compatible",
			model: "stub",
			baseURL: stub.baseURL,
			apiKey: "invalid-stub-key",
		},
	});
	await expect(created).toBeOK();
	const provider = (await created.json()) as { id: string };
	await expect(await page.request.post(`/api/openapi/ai-providers/${provider.id}/test`)).toBeOK();
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto("/dashboard/settings/ai?locale=de-DE");
	await expect(page.getByText("Der Schlüssel wurde abgelehnt. Prüfe ihn und teste erneut.")).toBeVisible();
	await expect(page.getByText("Synthetic invalid API key")).toBeHidden();
	await page
		.locator("section")
		.filter({ has: page.getByRole("heading", { name: "KI-Anbieter", exact: true }) })
		.screenshot({ path: info.outputPath("provider-error-390-german.png") });
});

for (const configured of [false, true]) {
	test(`preparation schedule distinguishes unavailable lookup from ${configured ? "configured" : "unconfigured"} AI`, async ({
		authPage: page,
	}, info) => {
		if (configured) await saveProvider(page, "Fictional schedule connection");
		const response = await page.request.post("/api/openapi/applications", {
			data: { company: "Fictional schedule company", role: "Engineer", status: "interview" },
		});
		await expect(response).toBeOK();
		const id = await response.json();
		await expect(
			await page.request.post(`/api/openapi/applications/${id}/interviews`, {
				data: { at: new Date(Date.now() + 2 * 86400000).toISOString(), kind: "technical", timezone: "Europe/Berlin" },
			}),
		).toBeOK();
		const isLookup = (request: import("@playwright/test").Request) =>
			request.url().includes("aiProviders/list") || (request.postData() ?? "").includes("aiProviders");
		let held = 0;
		let releaseLookup!: () => void;
		const lookupHeld = new Promise<void>((resolve) => {
			releaseLookup = resolve;
		});
		await page.route("**/api/rpc/**", async (route) => {
			if (isLookup(route.request())) {
				held++;
				await lookupHeld;
			}
			await route.continue();
		});
		await page.goto(`/dashboard/career?schedule=new:prepare:${id}`);
		const sheet = page.locator('[data-slot="sheet-content"]');
		await expect(sheet).toBeVisible();
		await expect.poll(() => held).toBeGreaterThan(0);
		const setup = sheet.getByRole("button", { name: "Set up AI", exact: true });
		await expect(setup).toHaveCount(0);
		releaseLookup();
		await expect(sheet.getByText("Interview prep", { exact: true })).toBeVisible();
		await expect(setup).toHaveCount(configured ? 0 : 1);
		if (configured)
			await expect(sheet.getByRole("combobox", { name: "AI connection" })).toContainText(
				"Fictional schedule connection",
			);
		await page.unroute("**/api/rpc/**");
		let blocked = 0;
		await page.route("**/api/rpc/**", async (route) => {
			if (isLookup(route.request())) {
				blocked++;
				await route.abort("failed");
			} else await route.continue();
		});
		await page.clock.install({ time: Date.now() + 65000 });
		await page.evaluate(() => window.dispatchEvent(new Event("offline")));
		await page.evaluate(() => window.dispatchEvent(new Event("online")));
		await expect.poll(() => blocked).toBeGreaterThan(0);
		await expect(sheet.getByText(/saved connections haven't changed/)).toBeVisible();
		await expect(setup).toHaveCount(0);
		await sheet.screenshot({
			path: info.outputPath(`schedule-${configured ? "configured" : "empty"}-lookup-error.png`),
		});
		await page.unroute("**/api/rpc/**");
		await sheet.getByRole("button", { name: "Try again", exact: true }).click();
		await expect(sheet.getByText(/saved connections haven't changed/)).toHaveCount(0);
		await expect(setup).toHaveCount(configured ? 0 : 1);
		const providers = await page.request.get("/api/openapi/ai-providers");
		await expect(providers).toBeOK();
		expect(await providers.json()).toHaveLength(configured ? 1 : 0);
	});
}
