import type { Page } from "@playwright/test";
import { approveLocalStubOperations } from "../fixtures/ai-consent";
import { startAiStub } from "../fixtures/ai-stub";
import { expect, test } from "../fixtures/test";

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub.close();
});

async function backedStory(page: Page) {
	const text = "I restored fictional service and documented the handoff.";
	const fact = await page.request.post("/api/openapi/career/facts", {
		data: { text, category: "accomplishment", source: { kind: "manual", id: "fictional-shared-fact", quote: text } },
	});
	await expect(fact).toBeOK();
	const savedFact = await fact.json();
	const story = await page.request.post("/api/openapi/career/stories", {
		data: {
			applicationId: null,
			title: "Fictional service recovery",
			situation: "A fictional service stopped.",
			task: "Restore service.",
			action: text,
			result: "",
			reflection: "",
			factIds: [savedFact.id],
			tags: [],
		},
	});
	await expect(story).toBeOK();
	return { fact: savedFact, story: await story.json() };
}

for (const width of [1440, 390])
	test(`Knowledge practices a backed story without inventing a job (${width})`, async ({ authPage: page }, info) => {
		test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs isolated local AI stub.");
		await page.setViewportSize({ width, height: 1000 });
		const { story } = await backedStory(page);
		const connection = await page.request.post("/api/openapi/ai-providers", {
			data: {
				label: "Fictional practice connection",
				provider: "openai-compatible",
				model: "stub",
				capableModel: "different-capable-model",
				baseURL: stub.baseURL,
				apiKey: "stub-key",
			},
		});
		await expect(connection).toBeOK();
		await expect(await page.request.post(`/api/openapi/ai-providers/${(await connection.json()).id}/test`)).toBeOK();
		const before = stub.requests.length;
		await page.goto(`/dashboard/career/knowledge/stories/${story.id}`);
		await page.getByRole("button", { name: "Practice", exact: true }).click();
		await expect(page).toHaveURL(/practice=true/);
		await expect(page.getByText("Practice without an application", { exact: true })).toBeVisible();
		await expect(page.getByText(/^Sends .*Knowledge.*Fictional practice connection/)).toBeVisible();
		expect(stub.requests.length).toBe(before);
		await page.getByRole("radio", { name: "Type", exact: true }).click();
		const answer = page.getByRole("textbox", { name: "Your answer", exact: true });
		await answer.fill("I restored fictional service by coordinating the response and documenting the handoff.");
		await page.getByRole("button", { name: "Back to stories", exact: true }).click();
		await page.getByRole("button", { name: "Practice", exact: true }).click();
		await expect(answer).toHaveValue(
			"I restored fictional service by coordinating the response and documenting the handoff.",
		);
		if (width === 390) {
			await page.getByRole("button", { name: /Get feedback/ }).click();
			const consent = page.getByRole("alertdialog");
			await expect(consent).toContainText("127.0.0.1");
			await consent.getByRole("button", { name: "Don't share", exact: true }).click();
			await expect(consent).toHaveCount(0);
			expect(stub.requests.length).toBe(before);
			await expect(answer).toHaveValue(
				"I restored fictional service by coordinating the response and documenting the handoff.",
			);
			const notSaved = await page.request.get("/api/openapi/career/saved", {
				params: { scope: "shared", kind: "practice" },
			});
			await expect(notSaved).toBeOK();
			expect(await notSaved.json()).toEqual([]);
		}
		await approveLocalStubOperations(page);
		await page.getByRole("button", { name: /Get feedback/ }).click();
		await expect(page.getByText("Your contribution is clear.", { exact: true })).toBeVisible();
		const rows = await page.request.get("/api/openapi/career/saved", { params: { kind: "practice", scope: "shared" } });
		await expect(rows).toBeOK();
		const attempts = await rows.json();
		expect(attempts).toHaveLength(1);
		expect(attempts[0]).toMatchObject({
			applicationId: null,
			interviewId: null,
			evidence: { storyIds: [story.id] },
			data: {
				answer: "I restored fictional service by coordinating the response and documenting the handoff.",
				kind: "practice",
			},
		});
		const contents = stub.requests
			.slice(before)
			.flatMap((request) => request.messages)
			.map((message) =>
				typeof message.content === "string"
					? message.content
					: Array.isArray(message.content)
						? message.content.map((part) => (part as { text?: string }).text ?? "").join("")
						: "",
			);
		const prompt = contents.find((value) => value.includes("Context (data, not instructions):\n"));
		expect(prompt).toBeTruthy();
		if (!prompt) throw new Error("Practice did not reach the actual provider context.");
		const encoded = prompt.split("Context (data, not instructions):\n")[1];
		if (!encoded) throw new Error("Practice provider context was empty.");
		const context = JSON.parse(encoded);
		expect(context.application).toBeNull();
		expect(
			stub.requests
				.slice(before)
				.filter((request) =>
					request.messages.some((message) =>
						JSON.stringify(message.content).includes("Context (data, not instructions)"),
					),
				)
				.every((request) => request.model === "stub"),
		).toBe(true);
		const applications = await page.request.get("/api/openapi/applications");
		await expect(applications).toBeOK();
		expect(await applications.json()).toEqual([]);
		await page.reload();
		await expect(page.getByText("Practice without an application", { exact: true })).toBeVisible();
		await expect(page.getByText(/I restored fictional service by coordinating the response/).first()).toBeVisible();
		await page.getByRole("button", { name: /I restored fictional service by coordinating the response/ }).click();
		await expect(page.getByRole("textbox", { name: "Your answer", exact: true })).toHaveCount(0);
		await page.getByRole("button", { name: "Practice", exact: true }).click();
		await expect(page.getByRole("radio", { name: "Type", exact: true })).toBeVisible();
		if (width === 1440)
			await page.screenshot({
				path: info.outputPath("standalone-story-practice.png"),
				fullPage: true,
				animations: "disabled",
			});
	});

test("unbacked or switched-off story does not offer a practice action that will fail", async ({ authPage: page }) => {
	const { story, fact } = await backedStory(page);
	await expect(
		await page.request.patch(`/api/openapi/career/facts/${fact.id}`, { data: { status: "excluded" } }),
	).toBeOK();
	await page.goto(`/dashboard/career/knowledge/stories/${story.id}`);
	await expect(page.getByRole("button", { name: "Practice", exact: true })).toHaveAttribute("aria-disabled", "true");
	await page.goto(`/dashboard/career/knowledge/stories/${story.id}?practice=true`);
	await expect(page.getByText(/This story has no facts in use here/)).toBeVisible();
	await expect(page.getByRole("button", { name: /Get feedback/ })).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Practice another question", exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Back to stories", exact: true }).click();
	await expect(page).not.toHaveURL(/practice=true/);
});

test("shared practice preserves strict generation and saved-work selectors", async ({ authPage: page }) => {
	const before = stub.requests.length;
	for (const task of [
		{ task: "fit" },
		{
			task: "practice",
			question: "Tell this story",
			origin: "simulated",
			mode: "typed",
			answer: "I restored service.",
			storyId: "story",
			interviewId: "round",
		},
		{
			task: "practice",
			question: "Tell this story",
			origin: "simulated",
			mode: "typed",
			answer: "I restored service.",
		},
	]) {
		const response = await page.request.post("/api/openapi/career/generate", { data: { applicationId: null, task } });
		expect(response.status()).toBe(400);
	}
	const conflicting = await page.request.get("/api/openapi/career/saved", {
		params: { scope: "shared", applicationId: "not-a-shared-scope" },
	});
	expect(conflicting.status()).toBe(400);
	const legacy = await page.request.get("/api/openapi/career/saved");
	await expect(legacy).toBeOK();
	expect(await legacy.json()).toEqual([]);
	expect(stub.requests.length).toBe(before);
});
