import { writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { startAiStub } from "../fixtures/ai-stub";
import { expect, test } from "../fixtures/test";

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
});

test("target roles stay drafts until reviewed; manual setup needs no AI", async ({ authPage: page }, testInfo) => {
	test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Local scripted provider required");
	test.setTimeout(90_000);
	await page.setViewportSize({ width: 1440, height: 1150 });
	await page.goto("/dashboard/career/knowledge/preferences");
	await page.getByRole("button", { name: "Suggest target roles (optional AI)" }).click();
	await expect(
		page.getByText("Connect and test an AI provider in Settings, or keep entering roles manually."),
	).toBeVisible();
	await page.getByLabel("Target roles", { exact: true }).fill("Operations lead");
	await page.getByLabel("Target roles", { exact: true }).press("Enter");
	const profile = async () => {
		const response = await page.request.get("/api/openapi/career/profile");
		expect(response.ok()).toBe(true);
		return response.json();
	};
	await expect.poll(async () => (await profile()).targetRoles).toEqual(["Operations lead"]);
	const fact = await page.request.post("/api/openapi/career/facts", {
		data: {
			text: "I maintain reliable services.",
			category: "experience",
			source: { kind: "manual", id: "rx76-local", quote: "I maintain reliable services." },
		},
	});
	await expect(fact).toBeOK();
	const provider = await page.request.post("/api/openapi/ai-providers", {
		data: {
			label: "Fictional local provider",
			provider: "openai-compatible",
			model: "stub",
			baseURL: stub.baseURL,
			apiKey: "synthetic",
		},
	});
	await expect(provider).toBeOK();
	const providerId = (await provider.json()).id;
	await expect(await page.request.post(`/api/openapi/ai-providers/${providerId}/test`)).toBeOK();
	await page.reload();
	await page.getByRole("button", { name: "Suggest target roles (optional AI)" }).click();
	await page.getByLabel("AI connection receiving your context").selectOption(providerId);
	await expect(page.getByRole("button", { name: "Generate role suggestions" })).toBeDisabled();
	await page.getByRole("switch", { name: "Share enabled shared Knowledge" }).click();
	// Another client changes and retests the same connection after its configuration was displayed.
	await expect(
		await page.request.patch(`/api/openapi/ai-providers/${providerId}`, { data: { model: "stub-retested" } }),
	).toBeOK();
	await expect(await page.request.post(`/api/openapi/ai-providers/${providerId}/test`)).toBeOK();
	const beforeStaleApproval = stub.requests.length;
	await page.getByRole("button", { name: "Generate role suggestions" }).click();
	await expect(page.getByRole("alert")).toHaveText("Your AI settings changed. Nothing was sent; try again.");
	expect(stub.requests.length).toBe(beforeStaleApproval);
	await page.getByRole("button", { name: "Retry AI connections" }).click();
	await expect(
		page.getByLabel("AI connection receiving your context").getByRole("option", { name: /stub-retested/ }),
	).toBeAttached();
	await page.getByLabel("AI connection receiving your context").selectOption(providerId);
	await page.getByRole("button", { name: "Generate role suggestions" }).click();
	const roleConsent = page.getByRole("alertdialog", { name: "Share data with Fictional local provider?" });
	await expect(roleConsent).toContainText(`Fictional local provider · stub-retested · ${stub.baseURL}`);
	expect(stub.requests.length).toBe(beforeStaleApproval);
	await roleConsent.getByRole("button", { name: "Allow this operation", exact: true }).click();
	await expect(page.getByLabel("Review target roles, one per line")).toHaveValue("Reliability engineer");
	expect((await profile()).targetRoles).toEqual(["Operations lead"]);
	await expect(await page.request.get("/api/openapi/career/schedules")).toBeOK();
	const providerRequest = JSON.stringify(stub.requests);
	expect(providerRequest).toContain("I maintain reliable services.");
	expect(providerRequest).not.toContain("applicationProfile");
	const generations = stub.requests.filter((request) =>
		JSON.stringify(request.messages).includes("Suggest up to five plausible target job titles"),
	);
	const measurement = {
		baseline: { roleSuggestionOperations: 0, note: "Feature absent; manual preferences need no provider request" },
		current: {
			roleSuggestionOperations: generations.length,
			serializedRequestBytes: generations.map((request) => Buffer.byteLength(JSON.stringify(request))),
			paidProviderCalls: 0,
			connectionTestOperations: stub.requests.length - generations.length,
		},
		limitation:
			"Local scripted provider; reported fixture tokens are not real token/cost estimates. No live price or hiring-quality claim.",
	};
	expect(generations).toHaveLength(1);
	await writeFile(testInfo.outputPath("provider-measurement.json"), JSON.stringify(measurement, null, 2));

	await page.getByLabel("Review target roles, one per line").fill("Platform engineer");
	await page.getByRole("main").screenshot({ path: testInfo.outputPath("target-role-suggestions.png") });
	await page.getByRole("button", { name: "Use reviewed roles in preferences" }).click();
	await expect.poll(async () => (await profile()).targetRoles).toEqual(["Platform engineer"]);
	await page.getByRole("main").screenshot({ path: testInfo.outputPath("target-roles.png") });
	const application = await page.request.post("/api/openapi/applications", {
		data: { company: "Canopy Systems", role: "Platform engineer", status: "interview" },
	});
	await expect(application).toBeOK();
	const applicationId = await application.json();
	await expect(
		await page.request.post(`/api/openapi/applications/${applicationId}/interviews`, {
			data: { at: new Date(Date.now() + 3 * 86400000).toISOString(), kind: "technical", timezone: "UTC" },
		}),
	).toBeOK();
	await page.goto("/dashboard/career?schedule=new:prepare");
	await expect(page.getByLabel("Interview", { exact: true })).not.toHaveValue("");
	await page.getByText("Morning of", { exact: true }).click();
	await expect(page.getByRole("radio", { name: "Morning of", exact: true }).locator("span.absolute")).toHaveCSS(
		"transform",
		"none",
	);
	await page
		.getByRole("dialog", { name: "New schedule", exact: true })
		.screenshot({ path: testInfo.outputPath("prepare-schedule.jpg") });
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	await page.getByRole("button", { name: "Discard", exact: true }).click();
	await expect(await page.request.delete(`/api/openapi/applications/${applicationId}`)).toBeOK();
	await page.goto("/dashboard/career");
	await page.getByRole("button", { name: "Set up discovery" }).click();
	await expect(page.getByLabel("Look for", { exact: true })).toHaveValue("Platform engineer");
	await expect(page.getByText(/AI is optional. Review target roles in Knowledge/)).toBeVisible();
	await page
		.getByRole("dialog", { name: "New schedule", exact: true })
		.screenshot({ path: testInfo.outputPath("discovery-schedule.jpg") });
	await page.getByRole("button", { name: "Cancel", exact: true }).click();
	// No retrieval occurs: save a synthetic credential and a future schedule, then remove both.
	await expect(await page.request.delete(`/api/openapi/ai-providers/${providerId}`)).toBeOK();
	await expect(
		await page.request.put("/api/openapi/integrations/web-access", {
			data: { provider: "tavily", apiKey: "synthetic-never-sent" },
		}),
	).toBeOK();
	await page.reload();
	await page.getByRole("button", { name: "Set up discovery", exact: true }).click();
	await expect(page.getByLabel("Look for", { exact: true })).toHaveValue("Platform engineer");
	await expect(
		page.getByText(/Found posting links are read by Reactive Resume and, when needed, tavily/),
	).toBeVisible();
	const beforeManualSchedule = stub.requests.length;
	await page.getByRole("button", { name: "Save schedule", exact: true }).click();
	const webConsent = page.getByRole("alertdialog", { name: "Use web access?" });
	await expect(webConsent).toContainText("No AI provider is used for this operation.");
	await expect(webConsent).toContainText("Only the search query and search countries");
	await webConsent.getByRole("button", { name: "Allow scheduled sharing", exact: true }).click();
	await expect(page.getByRole("dialog", { name: "New schedule", exact: true })).toBeHidden();
	expect(stub.requests.length).toBe(beforeManualSchedule);
	const schedules = await page.request.get("/api/openapi/career/schedules");
	await expect(schedules).toBeOK();
	const savedSchedules = await schedules.json();
	expect(savedSchedules).toEqual([
		expect.objectContaining({ query: "Platform engineer", aiProviderId: null, intervalDays: 1, enabled: true }),
	]);
	for (const schedule of savedSchedules)
		await expect(await page.request.delete(`/api/openapi/career/schedules/${schedule.id}`)).toBeOK();
	await expect(await page.request.delete("/api/openapi/integrations/web-access")).toBeOK();
});

test("discovery explains unknowns and bulk partial failures keep only failed roles selected", async ({
	authPage: page,
}, testInfo) => {
	const databaseUrl = process.env.DATABASE_URL;
	if (!databaseUrl) throw new Error("Disposable E2E DATABASE_URL is required");
	const profile = await page.request.get("/api/openapi/auth/profile");
	await expect(profile).toBeOK();
	const owner = (await profile.json()).id;
	const pool = new Pool({ connectionString: databaseUrl });
	await expect(
		await page.request.put("/api/openapi/career/profile", {
			data: { targetRoles: ["Platform engineer"], locations: ["Berlin"] },
		}),
	).toBeOK();
	try {
		await pool.query(
			`INSERT INTO career_opportunity (id,user_id,url,role,company,location,snippet,description,discovery_source) VALUES
		('rx76-first-' || $1,$1,'https://example.test/jobs/platform','Platform engineer','Canopy Systems','Berlin','Maintain reliable services.','Maintain reliable services for 10,000 users and remote APIs.',$2),
		('rx76-second-' || $1,$1,'https://example.test/jobs/reliability','Reliability engineer','Brightpath','','Build reliable products.','Build reliable products.',null)`,
			[owner, JSON.stringify({ query: "Platform engineer Berlin", checkedAt: "2026-10-30T08:00:00.000Z" })],
		);
		await page.setViewportSize({ width: 1440, height: 1150 });
		await page.goto("/dashboard/career");
		await expect(page.getByRole("heading", { name: "Platform engineer", exact: true })).toBeVisible();
		await expect(page.getByText(/^Source: example.test · Last seen in search:/)).toHaveCount(2);
		await expect(page.getByText("Workplace arrangement unknown", { exact: true })).toHaveCount(2);
		await expect(page.getByText("Salary not detected", { exact: true })).toHaveCount(2);
		await expect(
			page.getByText("Earlier discovery result. Search query and posting check time unknown."),
		).toBeVisible();
		await page.getByRole("button", { name: "Select all roles", exact: true }).click();
		await page.getByRole("main").screenshot({ path: testInfo.outputPath("today.png") });
		await page.setViewportSize({ width: 390, height: 844 });
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
		await page.getByRole("main").screenshot({ path: testInfo.outputPath("today-narrow.png") });
		// One role was dismissed in another client after this list loaded. Tracking that stale selection must fail alone.
		await expect(await page.request.delete(`/api/openapi/career/opportunities/rx76-second-${owner}`)).toBeOK();
		await page.getByRole("button", { name: "Track selected", exact: true }).click();
		await expect(page.getByText("1 updated; 1 failed. Failed roles remain selected. Refresh or retry.")).toBeVisible();
		const applications = await page.request.get("/api/openapi/applications");
		await expect(applications).toBeOK();
		expect(await applications.json()).toEqual(
			expect.arrayContaining([expect.objectContaining({ role: "Platform engineer", status: "saved" })]),
		);
		await page.reload();
		await expect(page.getByRole("heading", { name: "Platform engineer", exact: true })).toBeHidden();
		await expect(page.getByRole("heading", { name: "Reliability engineer", exact: true })).toBeHidden();
	} finally {
		await pool.end();
	}
});
