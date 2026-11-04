import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { startAiStub } from "../fixtures/ai-stub";
import { expect, test } from "../fixtures/test";
let database: Pool;
test.beforeAll(() => {
	database = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
});
test.afterAll(async () => {
	await database.end();
});
for (const width of [1440, 390])
	for (const explicit of [false, true])
		test(`Draft story keeps reviewed cited facts (${width}, explicit=${explicit})`, async ({
			authPage: page,
		}, info) => {
			await page.setViewportSize({ width, height: 1000 });
			const text = "I rebuilt the fictional Cedar design system with keyboard access.";
			const factResponse = await page.request.post("/api/openapi/career/facts", {
				data: { text, category: "experience", source: { kind: "manual", id: "rx254-proof", quote: text } },
			});
			await expect(factResponse).toBeOK();
			const fact = await factResponse.json();
			const other = await page.request.post("/api/openapi/career/facts", {
				data: {
					text: "I wrote unrelated fictional release notes.",
					category: "experience",
					source: { kind: "manual", id: "rx254-other", quote: "I wrote unrelated fictional release notes." },
				},
			});
			await expect(other).toBeOK();
			const appResponse = await page.request.post("/api/openapi/applications", {
				data: { company: "Fictional Cedar", role: "Designer", status: "interview" },
			});
			await expect(appResponse).toBeOK();
			const applicationId = await appResponse.json();
			const session = await (await page.request.get("/api/auth/get-session")).json();
			expect(session.user.id).toBeTruthy();
			const id = randomUUID();
			const title = "Draft the design-system story";
			const detail = `Use “${text}” as evidence.`;
			const data = {
				kind: "briefing",
				headline: "Fictional preparation",
				summary: "Review the project.",
				plan: [
					{
						minutes: 10,
						title,
						detail,
						action: "draft-story",
						storyId: null,
						...(explicit ? { factIds: [fact.id, "foreign"] } : {}),
					},
				],
				questions: [],
				focus: "Design systems",
				opening: "Fictional opening.",
				stories: [],
				honesty: "Keep unknown results blank.",
				storyIds: [],
				missingStory: title,
				practiceQuestions: [],
			};
			await database.query(
				"insert into career_artifact (id,user_id,application_id,title,data,evidence,input_version) values ($1,$2,$3,$4,$5,$6,$7)",
				[
					id,
					session.user.id,
					applicationId,
					"Fictional briefing",
					data,
					{ factIds: [fact.id], storyIds: [] },
					"rx254-fixture",
				],
			);
			await page.goto(`/dashboard/applications/${applicationId}/prepare?version=${id}`);
			await page.getByRole("link", { name: "Draft story", exact: true }).click();
			await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(title);
			await expect(page.getByText(`From your interview plan: ${detail}`, { exact: true })).toBeVisible();
			const checkbox = page.getByRole("checkbox", { name: text, exact: true });
			await expect(checkbox).toBeVisible();
			await expect(checkbox).toBeChecked();
			await expect(
				page.getByRole("checkbox", { name: "I wrote unrelated fictional release notes.", exact: true }),
			).not.toBeChecked();
			expect(await (await page.request.get("/api/openapi/career/stories")).json()).toEqual([]);
			await page
				.getByRole("textbox", { name: "Situation", exact: true })
				.fill("The fictional components were inconsistent.");
			await page.getByRole("textbox", { name: "Task", exact: true }).fill("Make their keyboard behavior consistent.");
			await page
				.getByRole("textbox", { name: "Action", exact: true })
				.fill("I rebuilt and tested the shared components.");
			if (width === 1440 && !explicit) {
				await page.setViewportSize({ width, height: 1800 });
				await page
					.locator("form")
					.filter({ has: page.getByRole("textbox", { name: "Title", exact: true }) })
					.screenshot({ path: info.outputPath("draft-story-cited-fact.png"), animations: "disabled" });
				await page.setViewportSize({ width, height: 1000 });
			}
			await checkbox.uncheck();
			await page.reload();
			await expect(checkbox).not.toBeChecked();
			await expect(page.getByRole("textbox", { name: "Action", exact: true })).toHaveValue(
				"I rebuilt and tested the shared components.",
			);
			await checkbox.check();
			await page.getByRole("button", { name: "Save story", exact: true }).click();
			await expect
				.poll(async () =>
					(await (await page.request.get("/api/openapi/career/stories")).json()).map(
						(r: { data: { title: string; factIds: string[] } }) => ({ title: r.data.title, factIds: r.data.factIds }),
					),
				)
				.toEqual([{ title, factIds: [fact.id] }]);
		});
test("pending Coach title uses the persisted word-boundary rule", async ({ authPage: page }) => {
	const stub = await startAiStub();
	let release: () => void = () => {};
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let entered = false;
	try {
		const r = await page.request.post("/api/openapi/ai-providers", {
			data: {
				label: "Fictional title connection",
				provider: "openai-compatible",
				model: "stub",
				baseURL: stub.baseURL,
				apiKey: "stub-key",
			},
		});
		await expect(r).toBeOK();
		await expect(await page.request.post(`/api/openapi/ai-providers/${(await r.json()).id}/test`)).toBeOK();
		await page.route("**/api/rpc/**", async (route) => {
			if (route.request().url().includes("/agent/messages/send")) {
				entered = true;
				await held;
			}
			await route.continue();
		});
		await page.goto("/dashboard/career/coach");
		const text = "Please help me summarize my accomplishments for the fictional Cedar interview next week";
		await page.getByPlaceholder("Ask about your next career step…").fill(text);
		await page.getByPlaceholder("Ask about your next career step…").press("Enter");
		await expect(page.getByRole("alertdialog")).toContainText("127.0.0.1");
		await page.getByRole("button", { name: "Allow this operation", exact: true }).click();
		await expect.poll(() => entered).toBe(true);
		const rail = page.locator('a[href*="/career/coach/"]').filter({ hasText: "Please help me summarize" });
		await expect(rail).toHaveCount(1);
		await expect(rail.locator("span").first()).toHaveText("Please help me summarize my accomplishments…");
		const threadId = new URL(page.url()).pathname.split("/").at(-1);
		release();
		await page.unrouteAll({ behavior: "wait" });
		await expect
			.poll(
				async () => (await database.query("select title from agent_threads where id=$1", [threadId])).rows[0]?.title,
			)
			.toBe("Please help me summarize my accomplishments…");
		await expect
			.poll(async () =>
				(
					await database.query("select ui_message from agent_messages where thread_id=$1 and role='user'", [threadId])
				).rows.some((r) => JSON.stringify(r.ui_message).includes(text)),
			)
			.toBe(true);
		await page.reload();
		await expect(page.getByText("Please help me summarize my accomplishments…", { exact: true }).first()).toBeVisible();
	} finally {
		release();
		await page.unrouteAll({ behavior: "wait" });
		await stub.close();
	}
});
