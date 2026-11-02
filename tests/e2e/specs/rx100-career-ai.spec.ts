import type { Page } from "@playwright/test";
import { startAiStub } from "../fixtures/ai-stub";
import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

// A loopback provider, so the server must allow an unsafe base URL.
test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs FLAG_ALLOW_UNSAFE_AI_BASE_URL=true");

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
});

const consent = async (page: Page) => {
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toContainText("127.0.0.1");
	await dialog.getByRole("button", { name: "Allow this operation", exact: true }).click();
};

async function connectStub(page: Page) {
	const created = await page.request.post("/api/openapi/ai-providers", {
		data: { label: "Stub", provider: "openai", model: "stub", baseURL: stub.baseURL, apiKey: "stub-key" },
	});
	expect(created.ok()).toBe(true);
	const provider = await created.json();
	const tested = await page.request.post(`/api/openapi/ai-providers/${provider.id}/test`, {
		data: { id: provider.id },
	});
	expect(tested.ok(), await tested.text()).toBe(true);
	const madeDefault = await page.request.post(`/api/openapi/ai-providers/${provider.id}/default`, {
		data: { id: provider.id },
	});
	expect(madeDefault.ok(), await madeDefault.text()).toBe(true);
}

async function application(page: Page, resumeId?: string) {
	const created = await page.request.post("/api/openapi/applications", {
		data: {
			company: "Fictional Harbor",
			role: "Reliability Engineer",
			jobDescription: "Keep production services reliable. Describe on-call and alert work.",
			...(resumeId ? { resumeId } : {}),
		},
	});
	expect(created.ok()).toBe(true);
	return (await created.json()) as string;
}

test("returns to the application that owns the resume, not to documents", async ({ authPage: page }, testInfo) => {
	test.setTimeout(60_000);
	await createSampleResumeFromDashboard(page, testInfo);
	const resumeId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
	const id = await application(page, resumeId);

	await page.goto(`/builder/${resumeId}?applicationId=${id}`);
	const back = page.getByRole("link", { name: "Back to Fictional Harbor" });
	await expect(back).toBeVisible();
	await expect(back).toHaveAttribute("href", `/dashboard/applications?applicationId=${id}`);
	await back.click();
	await page.waitForURL(
		(url) => url.pathname === "/dashboard/applications" && url.searchParams.get("applicationId") === id,
	);
});

test("keeps a ready letter draft after reload without asking the provider again", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(90_000);
	await connectStub(page);
	await createSampleResumeFromDashboard(page, testInfo);
	const resumeId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
	const id = await application(page, resumeId);
	const created = await page.request.post("/api/openapi/cover-letters", {
		data: { name: "Fictional letter", resumeId, applicationId: id },
	});
	expect(created.ok()).toBe(true);
	const letter = await created.json();

	await page.goto(`/builder/letter/${letter.id}`);
	await page.getByRole("button", { name: "Draft from the posting" }).click();
	await consent(page);
	await expect(page.getByRole("button", { name: "Keep" })).toBeVisible({ timeout: 30_000 });
	const before = stub.requests.filter((request) =>
		request.messages.some((message) => String(message.content).includes("You write the body of a cover letter")),
	).length;
	const shown = await page.locator("[aria-live=polite]").first().textContent();

	await page.reload();
	await expect(page.getByRole("button", { name: "Keep" })).toBeVisible();
	await expect(page.locator("[aria-live=polite]").first()).toContainText(shown?.slice(0, 20) ?? "");
	const after = stub.requests.filter((request) =>
		request.messages.some((message) => String(message.content).includes("You write the body of a cover letter")),
	).length;
	// Seeing the draft again costs no second paid request.
	expect(after).toBe(before);
});

test("a real pointer click on Draft after typing commits the question and drafts once", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(90_000);
	await connectStub(page);
	await page.setViewportSize({ width: 1440, height: 1000 });
	const id = await application(page);
	await page.goto(`/dashboard/applications/${id}/apply`);
	await page.getByRole("button", { name: "Add a question from the form" }).click();
	await page
		.getByRole("textbox", { name: "Question from the form" })
		.fill("Describe a reliability improvement (150 words max).");
	const before = stub.requests.length;
	// One physical click, no blur first: the old layout moved the button between mousedown and mouseup.
	await page.getByRole("button", { name: "Draft", exact: true }).click();
	await consent(page);
	await expect(page.getByRole("button", { name: "Accept" })).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText("I led the checkout audit and fixed 48 issues.", { exact: true })).toBeVisible();
	await expect(page.getByText("9 of 150 words", { exact: true })).toBeVisible();
	const drafts = stub.requests
		.slice(before)
		.filter((request) =>
			request.messages.some((message) =>
				JSON.stringify(message.content).includes("Write the user's answer to the application form question"),
			),
		);
	expect(drafts).toHaveLength(1);
	expect(JSON.stringify(drafts[0]?.messages)).toContain("Describe a reliability improvement (150 words max).");
	await page.screenshot({ path: testInfo.outputPath("apply-answer-limit.png") });
});

test("a long saved description scrolls inside its field instead of pushing Save job off the dialog", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(90_000);
	await connectStub(page);
	await page.goto("/dashboard/applications");
	await page.getByRole("button", { name: "Save job", exact: true }).first().click();
	const save = page.getByRole("dialog", { name: "Save a job", exact: true });
	await save
		.getByLabel("Job link or posting text")
		.fill(Array.from({ length: 600 }, (_, index) => `Responsibility ${index}: keep the service reliable.`).join("\n"));
	await save.getByRole("button", { name: "Read with AI" }).click();
	await consent(page);
	const description = save.getByRole("textbox", { name: "Saved description" });
	await expect(description).toBeVisible({ timeout: 30_000 });
	const measured = await description.evaluate((element) => ({
		scrollHeight: element.scrollHeight,
		clientHeight: element.clientHeight,
		maxHeight: getComputedStyle(element).maxHeight,
	}));
	expect(measured.maxHeight).not.toBe("none");
	expect(measured.scrollHeight).toBeGreaterThan(measured.clientHeight);
	await expect(save.getByRole("button", { name: "Save job" })).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("long-description.png"), animations: "disabled" });
});

test("a letter starts in the posting's language and its Language control keeps the design link", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(60_000);
	await createSampleResumeFromDashboard(page, testInfo);
	const resumeId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
	const id = await application(page, resumeId);
	await page.request.put(`/api/openapi/applications/${id}`, {
		data: {
			postingSource: {
				method: "builtin",
				format: "text",
				truncated: false,
				completeness: "unknown",
				language: "de-DE",
			},
		},
	});
	const created = await page.request.post("/api/openapi/cover-letters", {
		data: { name: "Deutsche Bewerbung", resumeId, applicationId: id },
	});
	expect(created.ok()).toBe(true);
	const letter = await created.json();
	expect(letter.style.metadata.page.locale).toBe("de-DE");
	expect(letter.designLinked).toBe(true);

	await page.goto(`/builder/letter/${letter.id}?mode=design`);
	await page.locator('section[aria-labelledby="letter-design-language"] button').first().click();
	await page.getByRole("option", { name: /fr-FR/ }).click();
	await expect(async () => {
		const after = await (await page.request.get(`/api/openapi/cover-letters/${letter.id}`)).json();
		expect(after.style.metadata.page.locale).toBe("fr-FR");
		expect(after.designLinked).toBe(true);
	}).toPass({ timeout: 10_000 });
});

test("a Saved application's message records its confirmed receipt and stage together", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(90_000);
	await connectStub(page);
	await page.setViewportSize({ width: 1440, height: 1000 });
	await createSampleResumeFromDashboard(page, testInfo);
	const resumeId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
	const id = await application(page, resumeId);
	await page.goto(`/dashboard/applications/${id}/messages`);
	await page
		.getByLabel("Paste a message from Fictional Harbor")
		.fill("Thank you for applying. We would like to invite you to interview.");
	await page.getByRole("button", { name: "Read it for me" }).click();
	await consent(page);
	await expect(page.getByText("Mark as applied and move to Interview", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Apply 1 change" }).click();
	const confirmation = page.getByRole("dialog", { name: "Mark as applied and move it?" });
	await expect(confirmation).toBeVisible();
	await expect(confirmation.getByRole("button", { name: "Mark as applied and move", exact: true })).toBeVisible();
	await page.screenshot({ path: testInfo.outputPath("messages-confirm-move.png"), animations: "disabled" });
	const read = async () => (await page.request.get(`/api/openapi/applications/${id}`)).json();
	expect((await read()).status).toBe("saved");
	await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
	expect((await read()).status).toBe("saved");
	await page.getByRole("button", { name: "Apply 1 change" }).click();
	await page.getByRole("button", { name: "Mark as applied and move", exact: true }).click();
	await expect(confirmation).not.toBeVisible();
	const saved = await read();
	expect(saved.status).toBe("interview");
	expect(saved.sentResumeVersionId).toBeTruthy();
	expect(
		saved.activity
			.filter((entry: { type: string }) => entry.type === "stage")
			.map((entry: { stage: string }) => entry.stage),
	).toEqual(["interview", "applied", "saved"]);
});
