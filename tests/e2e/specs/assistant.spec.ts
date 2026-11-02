import type { Page } from "@playwright/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { approveLocalStubOperations } from "../fixtures/ai-consent";
import { startAiStub } from "../fixtures/ai-stub";
import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

// The stub is a local provider, so the server must allow a loopback base URL.
test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs FLAG_ALLOW_UNSAFE_AI_BASE_URL=true");

test.beforeEach(async ({ authPage }) => {
	await approveLocalStubOperations(authPage);
});

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
});

const resumeIdOf = (page: Page) => new URL(page.url()).pathname.split("/").at(-1) ?? "";

async function resumeJson(page: Page, resumeId: string) {
	const response = await page.request.get(`/api/openapi/resumes/${resumeId}`);
	return JSON.stringify(await response.json());
}

/** D1: connects the stub through the assistant's inline setup. */
async function connectStub(page: Page) {
	const assistant = page.getByRole("region", { name: "Assistant" });
	await assistant.getByRole("button", { name: "Other · OpenAI-compatible" }).click();
	await assistant.getByLabel("Base URL").fill(stub.baseURL);
	await assistant.getByLabel("API key").fill("stub-key");
	await assistant.getByLabel("Model").fill("stub");
	await assistant.getByRole("button", { name: "Connect" }).click();
	await expect(assistant.getByLabel("Message the assistant")).toBeVisible({ timeout: 20_000 });
}

async function send(page: Page, text: string) {
	// Send turns into Stop while a reply streams.
	await expect(page.getByRole("button", { name: "Send" }).last()).toBeVisible({ timeout: 20_000 });
	const composer = page.getByLabel("Message the assistant");
	await composer.fill(text);
	// Enter is ignored until the previous reply has fully settled; the text stays, so press again.
	await expect(async () => {
		if ((await composer.inputValue()) !== "") await composer.press("Enter");
		await expect(composer).toHaveValue("", { timeout: 1_000 });
	}).toPass({ timeout: 20_000 });
}

test("language copy keeps the source and waits for Send and review before saving translated text", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(90_000);
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Priya Raman";
	data.basics.headline = "Product designer";
	data.basics.website = { url: "https://example.test/portfolio", label: "Portfolio" };
	data.summary.content = "<p>Build accessible tools.</p>";
	data.metadata.notes = "PRIVATE_TRANSLATION_NOTE";
	const imported = await page.request.post("/api/openapi/resumes/import", { data: { data } });
	await expect(imported).toBeOK();
	const sourceId = (await imported.json()) as string;
	await page.goto(`/builder/${sourceId}`);
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	await connectStub(page);
	const source = JSON.parse(await resumeJson(page, sourceId));
	const calls = stub.requests.length;
	// Assistant discovery opens the same copy picker as the document menu; cancel creates/sends nothing.
	await page.getByRole("button", { name: "Translate into…", exact: true }).click();
	const dialog = page.getByRole("dialog", { name: "Translate into…" });
	await expect(dialog.getByLabel("Language")).toHaveValue("de-DE");
	await dialog.getByRole("button", { name: "Close", exact: true }).click();
	expect(stub.requests).toHaveLength(calls);
	await page.getByRole("button", { name: "Close the assistant" }).click();
	await page.getByRole("button", { name: /Document menu:/ }).click();
	await page.getByRole("menuitem", { name: "Translate into…" }).click();
	await dialog.screenshot({ path: testInfo.outputPath("language-copy.png") });
	await dialog.getByRole("button", { name: "Create language copy" }).click();
	await expect(page).not.toHaveURL(new RegExp(`/builder/${sourceId}$`));
	await expect(page.getByLabel("Message the assistant")).toHaveValue(/language copy into de-DE/);
	const copyId = resumeIdOf(page);
	expect(copyId).not.toBe(sourceId);
	const copy = JSON.parse(await resumeJson(page, copyId));
	expect(copy.data.metadata.page.locale).toBe("de-DE");
	expect(copy.data.basics.headline).toBe("Product designer");
	expect(copy.isPublic).toBe(false);
	expect(stub.requests).toHaveLength(calls);
	await page.getByRole("button", { name: "Send", exact: true }).last().click();
	const edits = page.getByRole("list", { name: "Proposed edits" });
	await expect(edits).toBeVisible({ timeout: 20_000 });
	await testInfo.attach("translation-provider-transport.json", {
		body: Buffer.from(JSON.stringify(stub.requests.slice(calls), null, 2)),
		contentType: "application/json",
	});
	await expect(edits).toContainText("Produktdesignerin");
	expect(JSON.parse(await resumeJson(page, copyId)).data.basics.headline).toBe("Product designer");
	expect(JSON.stringify(stub.requests.slice(calls))).not.toContain("PRIVATE_TRANSLATION_NOTE");
	await edits.getByRole("button", { name: "Accept", exact: true }).click();
	await expect(edits.getByText("Applied", { exact: true })).toBeVisible();
	await expect
		.poll(async () => JSON.parse(await resumeJson(page, copyId)).data.basics.headline)
		.toBe("Produktdesignerin");
	await page.reload();
	const saved = JSON.parse(await resumeJson(page, copyId));
	expect(saved.data.summary.content).toBe("<p>Barrierefreie Werkzeuge entwickeln.</p>");
	expect(saved.data.basics.website).toEqual(data.basics.website);
	expect(saved.data.metadata.notes).toBe("PRIVATE_TRANSLATION_NOTE");
	expect(JSON.parse(await resumeJson(page, sourceId))).toEqual(source);
	await expect(page.getByText("Review German translation · 1 of 1 applied", { exact: true })).toBeVisible();
});

test("history keeps the original opening message beneath its task title without more AI calls", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(90_000);
	await createSampleResumeFromDashboard(page, testInfo);
	const resumeId = resumeIdOf(page);
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	await connectStub(page);
	const opening = "I'm applying for payments roles. Please tighten my summary.";
	await send(page, opening);
	await expect(page.getByRole("list", { name: "Proposed edits" })).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
	const calls = stub.requests.length;
	const response = await page.request.get("/api/openapi/agent/threads");
	await expect(response).toBeOK();
	const threads = (await response.json()) as Array<{ workingResumeId: string; title: string; firstMessage: string }>;
	expect(threads.find((thread) => thread.workingResumeId === resumeId)).toMatchObject({
		title: "Tighten the first passage",
		firstMessage: opening,
	});
	await page.getByRole("button", { name: "Past conversations", exact: true }).click();
	const row = page.getByRole("button", { name: /^Tighten the first passage/ });
	await expect(row).toContainText(opening);
	await expect(row).toContainText("0 of 1 edits accepted");
	await page
		.getByRole("region", { name: "Assistant" })
		.screenshot({ path: testInfo.outputPath("past-conversations.png") });
	await page.reload();
	await page.getByRole("button", { name: "Past conversations", exact: true }).click();
	await expect(row).toContainText(opening);
	expect(stub.requests).toHaveLength(calls);
});

test("proposes edits that change nothing until accepted, asks before assuming, and stops", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(90_000);
	await createSampleResumeFromDashboard(page, testInfo);
	const resumeId = resumeIdOf(page);
	const template = await page.request.patch(`/api/openapi/resumes/${resumeId}`, {
		data: { operations: [{ op: "replace", path: "/metadata/template", value: "onyx" }] },
	});
	expect(template.ok()).toBe(true);
	await page.reload();
	await expect(page.locator("figcaption")).toHaveCount(5);
	await expect(page.locator("figcaption").first()).toContainText(/Page 1 runs over by about \d+ lines/);

	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	await connectStub(page);

	const before = stub.requests.length;
	await page.getByRole("button", { name: /Tighten to one page/ }).click();
	const edits = page.getByRole("list", { name: "Proposed edits" });
	await expect(edits).toBeVisible({ timeout: 20_000 });
	await expect(page.getByText(/Page fit: \d+ → \d+ printed pages\./)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByText(/Estimated overflow change: [+-]?\d+ lines\./)).toBeVisible();
	const fitText = await page.getByText(/Page fit: \d+ → \d+ printed pages\./).textContent();
	const predictedPages = Number(fitText?.match(/→ (\d+) printed/)?.[1]);
	expect(predictedPages).toBeGreaterThan(0);
	await edits
		.locator("..")
		.locator("header")
		.screenshot({ path: testInfo.outputPath("proposal-page-fit.png") });
	await expect
		.poll(() =>
			JSON.stringify(
				stub.requests.slice(before).flatMap((request) => request.messages.filter((m) => m.role === "user")),
			),
		)
		.toMatch(/Tighten to one page\. Page 1 runs over by about \d+ lines\./);
	await expect(page.getByText("1 proposed", { exact: true })).toBeVisible();
	// The page caption appears once the in-browser preview has fetched its fonts and rendered.
	const activePreview = page.locator('[data-resume-preview-template][aria-hidden="false"]');
	await expect(activePreview.getByText(/proposed edit on this page/)).toBeVisible({ timeout: 30_000 });
	expect(await resumeJson(page, resumeId)).not.toContain("(tightened by the stub)");

	await edits.getByRole("button", { name: "Accept" }).click();
	await expect(edits.getByText("Applied")).toBeVisible();
	await expect.poll(() => resumeJson(page, resumeId), { timeout: 15_000 }).toContain("(tightened by the stub)");
	await expect(page.locator("figcaption")).toHaveCount(predictedPages);
	await expect(page.getByText("1 proposed", { exact: true })).toBeHidden();
	await expect(page.getByText(/Page 1 still runs over by about \d+ lines\./)).toBeVisible();

	// A clarifying question: the answer continues the reply.
	await send(page, "Ask me a question first");
	await page.getByRole("button", { name: "Yes, I have" }).click();
	await expect(page.getByText("You answered: Yes, I have")).toBeVisible();
	await expect(page.getByRole("list", { name: "Proposed edits" })).toHaveCount(2, { timeout: 20_000 });
	await expect(page.getByText("I tightened one passage. Accept it if it reads right.")).toHaveCount(2);

	// Stopping mid-reply keeps what arrived and proposes nothing.
	await send(page, "Reply slowly please");
	await expect(page.getByText("word3", { exact: false })).toBeVisible({ timeout: 20_000 });
	await page.getByRole("button", { name: "Stop" }).click();
	await expect(page.getByText("Stopped. No edits were proposed.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
});

test("Accept all preserves overlapping additions and reports the rewrite it cannot place", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(90_000);
	await createSampleResumeFromDashboard(page, testInfo);
	const resumeId = resumeIdOf(page);
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	await connectStub(page);
	await send(page, "Propose overlapping edits");
	const edits = page.getByRole("list", { name: "Proposed edits" });
	await expect(edits).toBeVisible({ timeout: 20_000 });
	await expect(page.getByText(/Page fit: \d+ → \d+ printed pages\./)).toBeVisible({ timeout: 30_000 });
	expect(await resumeJson(page, resumeId)).not.toContain("Introduced accessibility reviews.");
	await page.getByRole("button", { name: "Accept all", exact: true }).click();
	await expect(edits.getByText("Applied", { exact: true })).toHaveCount(3);
	await expect(edits.getByText("Out of date: the text has changed since.", { exact: true })).toHaveCount(1);
	await expect(page.getByText("3 of 4 applied", { exact: true })).toBeVisible();
	await expect
		.poll(() => resumeJson(page, resumeId), { timeout: 15_000 })
		.toContain("Introduced accessibility reviews.");
	const saved = await resumeJson(page, resumeId);
	for (const text of [
		"Rewritten audit passage.",
		"Mentored two junior designers.",
		"Introduced accessibility reviews.",
	])
		expect(saved.split(text)).toHaveLength(2);
	expect(saved).not.toContain("A conflicting rewrite.");
	await page.reload();
	// The open conversation is in the URL, so a reload brings the assistant back on it.
	await expect(page.getByRole("region", { name: "Assistant" })).toBeVisible();
	await expect(page.getByText("3 of 4 applied", { exact: true })).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole("list", { name: "Proposed edits" }).getByText("Applied", { exact: true })).toHaveCount(3);
});

test("reviews and atomically saves a structural set with offscreen Undo and reacceptance", async ({
	authPage: page,
}, testInfo) => {
	test.setTimeout(90_000);
	await createSampleResumeFromDashboard(page, testInfo);
	const resumeId = resumeIdOf(page);
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	await connectStub(page);
	await send(page, "Create a structural certification");
	const edits = page.getByRole("list", { name: "Proposed edits" });
	await expect(edits).toContainText("CPACC", { timeout: 20_000 });
	await expect(edits).toContainText("IAAP");
	expect(await resumeJson(page, resumeId)).not.toContain("CPACC");
	await edits.getByRole("button", { name: "Accept", exact: true }).click();
	await expect(page.getByText("1 of 1 applied", { exact: true })).toBeVisible();
	await expect.poll(() => resumeJson(page, resumeId), { timeout: 15_000 }).toContain("CPACC");
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	await page.locator('[data-slot="toast"]').getByRole("button", { name: "Undo", exact: true }).click();
	await expect.poll(() => resumeJson(page, resumeId), { timeout: 15_000 }).not.toContain("CPACC");
	await page.reload();
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	await expect(edits.getByRole("button", { name: "Accept", exact: true })).toBeVisible({ timeout: 20_000 });
	await edits.getByRole("button", { name: "Accept", exact: true }).click();
	await expect.poll(() => resumeJson(page, resumeId), { timeout: 15_000 }).toContain("CPACC");
	expect((await resumeJson(page, resumeId)).split("CPACC")).toHaveLength(2);
});
