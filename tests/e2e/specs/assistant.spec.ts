import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
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
	await assistant.getByRole("button", { name: "Set up AI", exact: true }).click();
	const setup = page.getByRole("dialog", { name: "Set up AI", exact: true });
	await setup.getByRole("combobox", { name: "Provider", exact: true }).click();
	await page.getByRole("option", { name: "OpenAI-compatible", exact: true }).click();
	await setup.getByLabel("Base URL (required)", { exact: true }).fill(stub.baseURL);
	await setup.getByLabel("API key", { exact: true }).fill("stub-key");
	await setup.getByLabel("Model", { exact: true }).fill("stub");
	await setup.getByRole("button", { name: "Save and test", exact: true }).click();
	await page
		.getByRole("dialog", { name: "AI is ready", exact: true })
		.getByRole("button", { name: "Done", exact: true })
		.click();
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

test("posting create and resume link reject foreign resources and mismatched account envelopes through HTTP", async ({
	authPage: page,
	playwright,
	baseURL,
}) => {
	const resumeResponse = await page.request.post("/api/openapi/resumes", {
		data: { name: "Owned fictional resume", tags: [] },
	});
	await expect(resumeResponse).toBeOK();
	const resumeId = await resumeResponse.json();
	const jobResponse = await page.request.post("/api/openapi/applications", {
		data: { company: "Owned fictional", role: "Engineer", resumeId },
	});
	await expect(jobResponse).toBeOK();
	const applicationId = await jobResponse.json();
	const other = await playwright.request.newContext({ baseURL });
	try {
		const suffix = randomUUID().slice(0, 8);
		const signup = await other.post("/api/auth/sign-up/email", {
			headers: { origin: new URL(baseURL ?? "http://localhost:3188").origin },
			data: {
				name: "Other Fictional",
				username: `rx190-${suffix}`,
				displayUsername: `rx190-${suffix}`,
				email: `rx190-${suffix}@example.test`,
				password: "RX190-Disposable-Fixture-Only",
			},
		});
		await expect(signup).toBeOK();
		const otherId = (await signup.json()).user.id;
		expect(
			(
				await other.post("/api/openapi/applications", {
					data: { company: "Foreign reference", role: "Engineer", resumeId },
				})
			).status(),
		).toBe(404);
		expect(
			(
				await other.post("/api/openapi/documents/application", {
					data: { type: "resume", id: resumeId, applicationId },
				})
			).status(),
		).toBe(404);
		const foreignResume = await other.post("/api/openapi/resumes", {
			data: { name: "Other fictional resume", tags: [] },
		});
		await expect(foreignResume).toBeOK();
		const foreignResumeId = await foreignResume.json();
		expect(
			(
				await other.post("/api/openapi/documents/application", {
					data: { type: "resume", id: foreignResumeId, applicationId },
				})
			).status(),
		).toBe(404);
		const mismatch = await page.request.post("/api/rpc/applications/create", {
			headers: { "x-account-id": otherId },
			data: { json: { company: "Wrong envelope", role: "Engineer", resumeId } },
		});
		expect(mismatch.ok()).toBe(false);
		expect(JSON.parse(await resumeJson(page, resumeId)).applicationId).toBeNull();
		expect(await (await page.request.get("/api/openapi/applications")).json()).toHaveLength(1);
		expect(await (await other.get("/api/openapi/applications")).json()).toEqual([]);
	} finally {
		await other.delete("/api/openapi/auth/account");
		await other.dispose();
	}
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
	// The in-browser preview renders once its fonts load: the same budget as the preview checks below.
	await expect(page.locator("figcaption")).toHaveCount(5, { timeout: 30_000 });
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
	await expect.poll(() => resumeIdOf(page), { timeout: 15_000 }).not.toBe(resumeId);
	const workingResumeId = resumeIdOf(page);
	await expect.poll(() => resumeJson(page, workingResumeId), { timeout: 15_000 }).toContain("(tightened by the stub)");
	expect(await resumeJson(page, resumeId)).not.toContain("(tightened by the stub)");
	await expect(page.locator("figcaption")).toHaveCount(predictedPages, { timeout: 30_000 });
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
