import type { Page } from "@playwright/test";
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
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
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
