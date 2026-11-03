import type { Page } from "@playwright/test";
import { approveLocalStubOperations } from "../fixtures/ai-consent";
import { startAiStub } from "../fixtures/ai-stub";
import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub.close();
});
test.beforeEach(async ({ authPage }, info) => {
	if (!info.title.includes("A2-27")) await approveLocalStubOperations(authPage);
});

async function provider(page: Page, baseURL = stub.baseURL) {
	test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs local stub URL permission");
	const created = await page.request.post("/api/openapi/ai-providers", {
		data: {
			label: "Fictional Birch connection",
			provider: "openai-compatible",
			model: "stub",
			baseURL,
			apiKey: "stub-key",
		},
	});
	await expect(created).toBeOK();
	const { id } = await created.json();
	await expect(await page.request.post(`/api/openapi/ai-providers/${id}/test`)).toBeOK();
}
async function send(page: Page, text: string) {
	const region = page.getByRole("region", { name: "Assistant", exact: true });
	await expect(region.getByRole("button", { name: "Send", exact: true })).toBeVisible();
	await region.getByLabel("Message the assistant").fill(text);
	await region.getByRole("button", { name: "Send", exact: true }).click();
	await expect(region.getByText(text, { exact: true })).toBeVisible();
	await expect(region.getByRole("button", { name: "Stop", exact: true })).toBeHidden({ timeout: 20000 });
	const threadId = new URL(page.url()).searchParams.get("assistant");
	await expect
		.poll(
			async () => {
				const response = await page.request.post("/api/rpc/agent/threads/get", { data: { json: { id: threadId } } });
				expect(response.ok()).toBe(true);
				return (await response.json()).json.thread.activeRunId;
			},
			{ timeout: 20000 },
		)
		.toBeNull();
}
async function read(page: Page, id: string) {
	const response = await page.request.get(`/api/openapi/resumes/${id}`);
	await expect(response).toBeOK();
	return response.json();
}

test("A2-38 reviewed interview answer saves only explicit edited Knowledge and never dispatches hidden AI", async ({
	authPage: page,
}, info) => {
	await page.setViewportSize({ width: 1440, height: 1400 });
	await provider(page);
	await createSampleResumeFromDashboard(page, info);
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	await send(page, "Find weak bullets; ask me a question first");
	const original = "I led keyboard testing for our four-step checkout and repaired all six issues found.";
	await page.getByLabel("Answer in your own words", { exact: true }).fill(original);
	await page.getByLabel("Answer in your own words", { exact: true }).press("Enter");
	await expect(page.getByRole("list", { name: "Proposed edits" })).toBeVisible({ timeout: 20000 });
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
	const region = page.getByRole("region", { name: "Assistant", exact: true });
	const facts = async () => {
		const r = await page.request.get("/api/openapi/career/facts");
		await expect(r).toBeOK();
		return r.json();
	};
	expect(await facts()).toHaveLength(0);
	await region.getByRole("button", { name: "Remember", exact: true }).click();
	const box = region.getByLabel("Remember as a fact in Knowledge");
	await expect(box).toHaveValue(original);
	await box.fill("I led keyboard testing and repaired six checkout issues.");
	await region.getByRole("button", { name: "Cancel", exact: true }).click();
	expect(await facts()).toHaveLength(0);
	await region.getByRole("button", { name: "Remember", exact: true }).click();
	await expect(box).toHaveValue("I led keyboard testing and repaired six checkout issues.");
	await region.screenshot({ path: info.outputPath("answer-knowledge-review.png") });
	let dispatches = 0;
	page.on("request", (r) => {
		if (r.url().includes("/agent/messages/stream")) dispatches++;
	});
	await region.getByRole("button", { name: "Remember", exact: true }).click();
	await expect(region.getByText("Added to Knowledge.", { exact: true })).toBeVisible();
	await expect.poll(async () => (await facts()).length).toBe(1);
	expect((await facts())[0]).toMatchObject({
		text: "I led keyboard testing and repaired six checkout issues.",
		source: { kind: "manual", quote: original },
	});
	expect(dispatches).toBe(0);
	await page.reload();
	expect((await facts())[0].text).toBe("I led keyboard testing and repaired six checkout issues.");
});

for (const kind of ["Start blank", "Try with a sample resume"])
	test(`J3-08 selected creation language persists from ${kind}`, async ({ authPage: page }, info) => {
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "New", exact: true });
		await dialog.getByRole("combobox", { name: "Resume language", exact: true }).click();
		await page.getByRole("option", { name: /Deutsch/ }).click();
		await expect(dialog.getByRole("combobox", { name: "Resume language", exact: true })).toContainText("Deutsch");
		if (kind === "Start blank") {
			await expect
				.poll(() =>
					dialog.evaluate(
						(element) =>
							element
								.getAnimations({ subtree: true })
								.filter(
									(animation) =>
										animation.effect?.getComputedTiming().iterations !== Infinity &&
										(animation.pending || animation.playState === "running"),
								).length,
					),
				)
				.toBe(0);
			await dialog.evaluate((element) => element.scrollTo({ top: 0 }));
			await dialog.screenshot({ path: info.outputPath("new-resume-language.png") });
		}
		await dialog.getByRole("button", { name: new RegExp("^" + kind) }).click();
		await page.waitForURL(/\/builder\//);
		const id = new URL(page.url()).pathname.split("/").at(-1) ?? "";
		expect((await read(page, id)).data.metadata.page.locale).toBe("de-DE");
		await page.reload();
		await expect(page.getByRole("combobox", { name: "Resume language", exact: true })).toContainText("Deutsch");
	});

for (const override of [false, true])
	test(`J3-08 structured import preserves language or explicit override=${override}`, async ({ authPage: page }) => {
		const created = await page.request.post("/api/openapi/resumes", {
			data: { name: "Fictional source", tags: [], withSampleData: true, locale: "de-DE" },
		});
		await expect(created).toBeOK();
		const sourceId = await created.json();
		const source = await read(page, sourceId);
		await page.goto("/dashboard");
		await page.getByRole("button", { name: "New", exact: true }).click();
		const dialog = page.getByRole("dialog", { name: "New", exact: true });
		if (override) {
			await dialog.getByRole("combobox", { name: "Resume language", exact: true }).click();
			await page.getByRole("option", { name: /Español/ }).click();
		}
		await dialog.locator('input[type="file"]').setInputFiles({
			name: "Fictional.json",
			mimeType: "application/json",
			buffer: Buffer.from(JSON.stringify(source.data)),
		});
		await expect(
			page
				.getByRole("dialog", { name: "Imported", exact: true })
				.getByRole("heading", { name: "Imported", exact: true }),
		).toBeVisible();
		const response = await page.request.get("/api/openapi/resumes");
		await expect(response).toBeOK();
		const items = await response.json();
		const imported = items.find((r: { id: string }) => r.id !== sourceId);
		expect(imported).toBeTruthy();
		const current = await read(page, imported.id);
		expect(current.data.metadata.page.locale).toBe(override ? "es-ES" : "de-DE");
		expect(current.data.basics).toEqual(source.data.basics);
		expect((await read(page, sourceId)).data).toEqual(source.data);
	});

for (const action of ["remove", "send", "failure", "changed", "reopen"])
	test(`A2-27 explicit long-paste attachment ${action}`, async ({ authPage: page }, info) => {
		await provider(page);
		await createSampleResumeFromDashboard(page, info);
		await page.getByRole("button", { name: "Assistant", exact: true }).click();
		const region = page.getByRole("region", { name: "Assistant", exact: true });
		const box = region.getByLabel("Message the assistant");
		const original = "Fictional résumé مرحبا 😀\n".repeat(240);
		await box.fill(original);
		let sends = 0;
		page.on("request", (r) => {
			if (r.url().includes("/agent/messages/stream")) sends++;
		});
		if (action === "failure")
			await page.route("**/api/rpc/agent/attachments/create", (route) =>
				route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({ code: "INTERNAL_SERVER_ERROR", message: "fictional offline" }),
				}),
			);
		let release: () => void = () => {};
		const barrier = new Promise<void>((r) => (release = r));
		if (action === "changed")
			await page.route("**/api/rpc/agent/attachments/create", async (route) => {
				await barrier;
				await route.continue();
			});
		const response = page.waitForResponse((r) => r.url().includes("/agent/attachments/create"));
		await region.getByRole("button", { name: "Attach a file instead", exact: true }).click();
		await expect(page.getByRole("alertdialog")).toContainText("127.0.0.1");
		await page.getByRole("button", { name: "Allow this operation", exact: true }).click();
		if (action === "changed") {
			await box.fill("Fresh unsent draft");
			release();
		}
		const uploaded = await response;
		if (action === "failure") {
			await expect(box).toHaveValue(original);
			expect(sends).toBe(0);
			return;
		}
		expect(uploaded.ok()).toBe(true);
		const payload = uploaded.request().postDataJSON().json;
		expect(Buffer.from(payload.data, "base64").toString("utf8")).toBe(original);
		expect(payload).toMatchObject({ filename: "message.txt", mediaType: "text/plain" });
		await expect(box).toHaveValue(action === "changed" ? "Fresh unsent draft" : "Read the attachment");
		await expect(region.getByText("message.txt", { exact: true })).toBeVisible();
		expect(sends).toBe(0);
		const threadId = payload.threadId;
		const get = async () => {
			const r = await page.request.post("/api/rpc/agent/threads/get", { data: { json: { id: threadId } } });
			expect(r.ok()).toBe(true);
			return (await r.json()).json;
		};
		expect((await get()).attachments).toHaveLength(1);
		if (action === "reopen") {
			const reopened = new URL(page.url());
			reopened.searchParams.set("assistant", threadId);
			await page.goto(reopened.toString());
			await expect(region.getByText("message.txt", { exact: true })).toBeVisible();
			expect(sends).toBe(0);
			await region.getByRole("button", { name: "Remove message.txt", exact: true }).click();
			await expect(region.getByText("message.txt", { exact: true })).toHaveCount(0);
			expect((await get()).attachments).toHaveLength(0);
		}
		if (action === "remove") {
			await region.getByRole("button", { name: "Remove message.txt", exact: true }).click();
			await expect(region.getByText("message.txt", { exact: true })).toHaveCount(0);
			expect((await get()).attachments).toHaveLength(0);
		}
		if (action === "send") {
			await region.getByRole("button", { name: "Send", exact: true }).click();
			await expect(page.getByRole("alertdialog")).toContainText("127.0.0.1");
			await page.getByRole("button", { name: "Allow this operation", exact: true }).click();
			await expect(region.getByRole("button", { name: "Stop", exact: true })).toBeHidden({ timeout: 20000 });
			await expect
				.poll(async () =>
					(await get()).messages.some(
						(m: { role: string; parts: { type: string; filename?: string }[] }) =>
							m.role === "user" && m.parts.some((x) => x.type === "file" && x.filename === "message.txt"),
					),
				)
				.toBe(true);
		}
	});

test("A2-25 real posting gap is tickable without changing its evidence or the document", async ({
	authPage: page,
}, info) => {
	await page.setViewportSize({ width: 1440, height: 1400 });
	await provider(page);
	const source = await page.request.post("/api/openapi/resumes", {
		data: { name: "Fictional source", tags: [], withSampleData: true },
	});
	await expect(source).toBeOK();
	const sourceId = await source.json();
	const job = await page.request.post("/api/openapi/applications", {
		data: {
			company: "Fictional Birch",
			role: "Engineer",
			requirements: ["Accessibility audits"],
			jobDescription: "Engineer. Accessibility audits required.",
		},
	});
	await expect(job).toBeOK();
	const applicationId = await job.json();
	const copy = await page.request.post("/api/openapi/documents/copy-for-job", {
		data: { resumeId: sourceId, applicationId, name: "Fictional job copy" },
	});
	await expect(copy).toBeOK();
	const id = await copy.json();
	const before = await read(page, id);
	await page.goto(`/builder/${id}?applicationId=${applicationId}`);
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	await send(page, "Tighten one passage");
	const gap = page.getByRole("checkbox", { name: "Accessibility audits", exact: true });
	await expect(gap).toBeVisible();
	await gap.click();
	await expect(gap).toBeChecked();
	await expect(page.getByText("Not assessed", { exact: true })).toBeVisible();
	expect((await read(page, id)).data).toEqual(before.data);
	await gap.click();
	await expect(gap).not.toBeChecked();
	await page
		.getByRole("region", { name: "Assistant", exact: true })
		.screenshot({ path: info.outputPath("assistant-posting-gaps.png") });
});

test("locale-less JSON Resume import uses the chosen interface language", async ({ authPage: page }) => {
	await page.goto("/dashboard?locale=de-DE");
	await expect(page.locator("html")).toHaveAttribute("lang", "de-DE");
	await page.getByRole("button", { name: "Neu", exact: true }).click();
	const dialog = page.getByRole("dialog");
	await dialog.locator('input[type="file"]').setInputFiles({
		name: "Fictional-JSON-Resume.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify({ basics: { name: "Fictional language choice" } })),
	});
	await expect
		.poll(async () => {
			const rows = await (await page.request.get("/api/openapi/resumes")).json();
			return rows.find((row: { name: string }) => row.name.includes("Fictional"))?.id;
		})
		.toBeTruthy();
	const rows = await (await page.request.get("/api/openapi/resumes")).json();
	const saved = await read(page, rows.find((row: { name: string }) => row.name.includes("Fictional")).id);
	expect(saved.data.metadata.page.locale).toBe("de-DE");
	expect(saved.data.basics.name).toBe("Fictional language choice");
});
