import type { Page } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startAiStub } from "../fixtures/ai-stub";
import { createSampleResumeFromDashboard, openSidebarSection } from "../fixtures/resume";
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

test("pending local edit remains actionable with provider Off", async ({ authPage: page }, info) => {
	test.setTimeout(90000);
	const first = await saveProvider(page, "Review original");
	await createSampleResumeFromDashboard(page, info);
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	await page.getByLabel("Message the assistant").fill("Tighten my fictional resume");
	await page.getByLabel("Message the assistant").press("Enter");
	await consent(page);
	const edits = page.getByRole("list", { name: "Proposed edits" });
	await expect(edits).toBeVisible({ timeout: 20000 });
	await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeHidden();
	await expect(
		await page.request.patch(`/api/openapi/ai-providers/${first.id}`, { data: { enabled: false } }),
	).toBeOK();
	await page.reload();
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	await expect(edits).toBeVisible();
	await page.screenshot({ path: info.outputPath("pending-off.png") });
	await expect(page.getByLabel("Message the assistant")).toBeDisabled();
	const count = stub.requests.length;
	await expect(edits.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
	await edits.getByRole("button", { name: "Accept", exact: true }).click();
	await expect(edits.getByText("Applied", { exact: true })).toBeVisible();
	expect(stub.requests.length).toBe(count);
	await page
		.getByRole("region", { name: "Assistant", exact: true })
		.screenshot({ path: info.outputPath("pending-off-accepted.png"), animations: "disabled" });
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(edits.getByRole("button", { name: "Accept", exact: true })).toBeEnabled();
	expect(stub.requests.length).toBe(count);
});

test("no-AI confirmation binds absence through actual server dispatch", async ({ authPage: page }, info) => {
	test.setTimeout(90000);
	await page.goto("/dashboard");
	await expect(page.getByRole("button", { name: /Search or run/ })).toBeVisible();
	const privateMarker = "RX98_REVIEW_PRIVATE_POSTING_DO_NOT_TRANSMIT";

	const assets = resolve("apps/web/dist/assets");
	let bundle = "";
	for (const name of await readdir(assets)) {
		if (
			name.startsWith("client-") &&
			name.endsWith(".js") &&
			(await readFile(join(assets, name), "utf8")).includes("[oRPC client]")
		)
			bundle = `/assets/${name}`;
	}
	expect(bundle).not.toBe("");
	await page.evaluate(
		({ bundle, privateMarker }) => {
			(window as Window & { rx98Pending?: Promise<unknown> }).rx98Pending = import(bundle)
				.then((m) => {
					type Client = { applications?: { ai?: { parsePosting?: (input: { input: string }) => Promise<unknown> } } };
					const client = (Object.values(m) as Client[]).find(
						(value) => value && typeof value.applications?.ai?.parsePosting === "function",
					);
					if (!client?.applications?.ai?.parsePosting) throw new Error("Production RPC client missing");
					return client.applications.ai.parsePosting({ input: privateMarker });
				})
				.catch((error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }));
		},
		{ bundle, privateMarker },
	);
	const dialog = page.getByRole("alertdialog");
	await expect(dialog).toContainText("No AI provider is used for this operation.");
	await saveProvider(page, "Added while no-AI consent open");
	const count = stub.requests.length;
	const sentHeaders: string[] = [];
	page.on("request", (request) => {
		if (request.url().includes("parsePosting")) sentHeaders.push(request.headers()["x-ai-destination"] ?? "ABSENT");
	});
	await dialog.getByRole("button", { name: "Allow this operation", exact: true }).click();
	await expect(dialog).toBeHidden();
	await page.evaluate(() => (window as Window & { rx98Pending?: Promise<unknown> }).rx98Pending);
	const leaks = stub.requests.slice(count).filter((r) => JSON.stringify(r).includes(privateMarker));
	await info.attach("no-ai-approval-dispatch.json", {
		body: JSON.stringify({ sentHeaders, providerRequests: leaks.length }),
		contentType: "application/json",
	});
	expect(leaks).toHaveLength(0);
	const manual = await page.request.post("/api/openapi/applications/ai/parse-posting", {
		headers: { "x-ai-destination": "none" },
		data: { input: privateMarker },
	});
	await expect(manual).toBeOK();
	expect(await manual.json()).toMatchObject({ filledBy: "none" });
	expect(stub.requests.slice(count)).toHaveLength(0);
	const forbidden = await page.request.post("/api/openapi/applications/ai/autofill", {
		headers: { "x-ai-destination": "none" },
		data: { jobDescription: privateMarker },
	});
	expect(forbidden.status()).toBe(409);
	expect(stub.requests.slice(count)).toHaveLength(0);
	const legacy = await page.request.post("/api/openapi/applications/ai/parse-posting", {
		data: { input: privateMarker },
	});
	await expect(legacy).toBeOK();
	expect(stub.requests.slice(count)).toHaveLength(1);
});

test("late older Writing completion cannot replace visible newer review", async ({ authPage: page }, info) => {
	test.setTimeout(90000);
	const { createServer } = await import("node:http");
	let release!: () => void;
	let started!: () => void;
	const firstSeen = new Promise<void>((r) => (started = r));
	const held = new Promise<void>((r) => (release = r));
	let calls = 0;
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (x) => (body += x));
		req.on("end", async () => {
			const data = JSON.parse(body);
			const reviewing = JSON.stringify(data).includes("experienced resume reviewer");
			const order = reviewing ? ++calls : 0;
			if (order === 1) {
				started();
				await held;
			}
			const content = reviewing
				? JSON.stringify({
						summary: order === 1 ? "REVIEW_OLD_SLOW_RESULT" : "REVIEW_NEW_FAST_RESULT",
						suggestions: [],
						strengths: [],
						jdAlignment: null,
					})
				: "1";
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					id: "review-controlled",
					object: "chat.completion",
					created: 0,
					model: "stub",
					choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
					usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
				}),
			);
		});
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const address = server.address() as { port: number };
	try {
		const created = await page.request.post("/api/openapi/ai-providers", {
			data: {
				label: "Controlled review",
				provider: "openai-compatible",
				model: "stub",
				baseURL: `http://127.0.0.1:${address.port}/v1`,
				apiKey: "fictional-key",
			},
		});
		expect(created.ok()).toBe(true);
		const provider = await created.json();
		await expect(await page.request.post(`/api/openapi/ai-providers/${provider.id}/test`)).toBeOK();
		await createSampleResumeFromDashboard(page, info);
		const resumeId = page.url().split("/builder/")[1]?.split("?")[0];
		await page.getByRole("tab", { name: /^Check/ }).click();
		await page.getByRole("tab", { name: "Writing", exact: true }).click();
		await page.getByRole("button", { name: "Review writing", exact: true }).click();
		await consent(page);
		await firstSeen;
		await page.getByRole("tab", { name: /^Issues/ }).click();
		await page.getByRole("tab", { name: "Writing", exact: true }).click();
		await page.getByRole("button", { name: "Review writing", exact: true }).click();
		await consent(page);
		await expect(page.getByText("REVIEW_NEW_FAST_RESULT", { exact: true })).toBeVisible();
		await expect
			.poll(
				async () =>
					(await (await page.request.get(`/api/openapi/ai/writing-review/${resumeId}`)).json()).review.summary,
			)
			.toBe("REVIEW_NEW_FAST_RESULT");
		const oldDone = page.waitForResponse((r) => r.url().includes("/api/rpc/ai/atsReview"));
		release();
		await oldDone;
		await expect(page.getByText("REVIEW_OLD_SLOW_RESULT", { exact: true })).toBeHidden();
		await expect(page.getByText("REVIEW_NEW_FAST_RESULT", { exact: true })).toBeVisible();
	} finally {
		release();
		await new Promise<void>((r) => server.close(() => r()));
	}
});

test("Fit rejects unusable stories before offering evidence repair", async ({ authPage: page }, info) => {
	test.setTimeout(90000);
	await saveProvider(page, "Fit review provider");
	const application = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Co", role: "Engineer", status: "saved", jobDescription: "Maintain synthetic systems." },
	});
	await expect(application).toBeOK();
	const applicationId = await application.json();
	await expect(
		await page.request.post("/api/openapi/career/stories", {
			data: {
				applicationId: null,
				title: "Unbacked draft story",
				situation: "Synthetic situation",
				task: "Synthetic task",
				action: "Synthetic action",
				factIds: [],
			},
		}),
	).toBeOK();
	await page.goto(`/dashboard/applications/${applicationId}/workspace?tab=fit`);
	await expect(page.getByRole("tab", { name: "Fit", exact: true })).toBeVisible();
	await page.getByRole("tab", { name: "Fit", exact: true }).click();
	await expect(page.getByText("Fit needs evidence.", { exact: false })).toBeVisible();
	await expect(page.getByRole("button", { name: "Check fit", exact: true })).toBeDisabled();
	await page.screenshot({ path: info.outputPath("fit-unusable-story.png"), animations: "disabled" });
});

test("application coach history survives provider-list failure", async ({ authPage: page }, info) => {
	test.setTimeout(45000);
	await saveProvider(page, "History review provider");
	const response = await page.request.post("/api/openapi/applications", {
		data: { company: "Fictional Co", role: "Engineer", status: "saved" },
	});
	await expect(response).toBeOK();
	const id = await response.json();
	await page.goto(`/dashboard/applications/${id}/workspace?tab=fit`);
	await page.getByRole("button", { name: "Ask the coach", exact: true }).click();
	const composer = page.getByPlaceholder("Ask about this application…");
	await composer.fill("Remember this fictional history");
	await composer.press("Enter");
	await consent(page);
	await expect(page.getByText("You left the document out.", { exact: true })).toBeVisible();
	await expect
		.poll(async () => {
			const response = await page.request.post("/api/rpc/agent/threads/list", {
				data: { json: {} },
			});
			expect(response.ok()).toBe(true);
			const { json: allThreads } = await response.json();
			const threads = allThreads.filter((thread: { applicationId: string | null }) => thread.applicationId === id);
			if (threads.length !== 1 || threads[0].activeRunId) return false;
			const history = await page.request.post("/api/rpc/agent/threads/get", { data: { json: { id: threads[0].id } } });
			expect(history.ok()).toBe(true);
			const { json: thread } = await history.json();
			const messages = JSON.stringify(thread.messages);
			return (
				!thread.thread.activeRunId &&
				messages.includes("Remember this fictional history") &&
				messages.includes("You left the document out.")
			);
		})
		.toBe(true);
	const count = stub.requests.length;
	let blocked = 0;
	await page.route("**/api/rpc/**", async (route) => {
		const req = route.request();
		const batched = new URL(req.url()).pathname.endsWith("/__batch__");
		const entries: { url: string }[] = batched ? JSON.parse(req.postData() ?? "[]") : [{ url: req.url() }];
		const providers = entries.flatMap((entry, index) =>
			new URL(entry.url).pathname === "/api/rpc/aiProviders/list" ? [index] : [],
		);
		if (!providers.length) return route.continue();
		blocked++;
		const response = await route.fetch();
		const error = {
			json: { defined: false, code: "INTERNAL_SERVER_ERROR", status: 500, message: "Provider lookup unavailable" },
		};
		// A physical batch can also carry thread discovery: preserve every sibling's real response.
		const body = batched
			? (await response.text())
					.split("\n")
					.map((line) => {
						if (!line.startsWith("data: ")) return line;
						const event = JSON.parse(line.slice(6));
						return providers.includes(event.index)
							? `data: ${JSON.stringify({ ...event, status: 500, body: error })}`
							: line;
					})
					.join("\n")
			: JSON.stringify(error);
		await route.fulfill({
			response,
			status: batched ? 207 : 500,
			body,
			headers: { ...response.headers(), "content-length": String(Buffer.byteLength(body)) },
		});
	});
	await page.reload();
	await expect.poll(() => blocked).toBeGreaterThan(0);
	await expect(page.getByText("You left the document out.", { exact: true })).toBeVisible({ timeout: 12000 });
	await expect(composer).toBeDisabled();
	await page.screenshot({ path: info.outputPath("coach-history-provider-error.png") });
	expect(stub.requests.length).toBe(count);
	await page.getByRole("button", { name: "Try again", exact: true }).first().click({ timeout: 10000 });
	await page.unroute("**/api/rpc/**");
	await expect(composer).toBeEnabled();
	expect(stub.requests.length).toBe(count);
});

test("Improve shows original target and replacement can be undone", async ({ authPage: page }, info) => {
	test.setTimeout(60000);
	await saveProvider(page, "Improve review provider");
	await createSampleResumeFromDashboard(page, info);
	await openSidebarSection(page, "Summary");
	const summary = page.getByRole("textbox", { name: "Summary", exact: true });
	const original = "Owned synthetic delivery.";
	await summary.fill(original);
	await summary.press("End");
	await page.getByRole("button", { name: "Improve", exact: true }).click();
	await expect(page.getByText("Original", { exact: true })).toBeVisible();
	await expect(page.locator("blockquote").filter({ hasText: original })).toHaveText(original);
	await page.getByRole("button", { name: "Stronger verb", exact: true }).click();
	await consent(page);
	await expect(page.getByText("Led fictional delivery work.", { exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Replace", exact: true }).click();
	await expect(summary).toHaveText("Led fictional delivery work.");
	await summary.press("ControlOrMeta+z");
	await expect(summary).toHaveText(original);
});

test("canonical voice approval protects actual multipart REST and concrete models", async ({ authPage: page }) => {
	const { createServer } = await import("node:http");
	const requests: { url: string; body: string }[] = [];
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk;
		});
		req.on("end", () => {
			requests.push({ url: req.url ?? "", body });
			res.writeHead(200, { "content-type": "application/json" });
			if (req.url?.endsWith("/audio/transcriptions")) res.end(JSON.stringify({ text: "Fictional transcript" }));
			else
				res.end(
					JSON.stringify({
						id: "local",
						object: "chat.completion",
						created: 0,
						model: "stub",
						choices: [{ index: 0, message: { role: "assistant", content: "1" }, finish_reason: "stop" }],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					}),
				);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const address = server.address() as { port: number };
		const created = await page.request.post("/api/openapi/ai-providers", {
			data: {
				label: "Fictional voice",
				provider: "openai",
				model: "stub",
				baseURL: `http://127.0.0.1:${address.port}/v1`,
				apiKey: "fictional",
			},
		});
		await expect(created).toBeOK();
		const row = await created.json();
		const tested = await page.request.post(`/api/openapi/ai-providers/${row.id}/test`);
		await expect(tested).toBeOK();
		const provider = await tested.json();
		requests.length = 0;
		const approved = JSON.stringify([
			provider.id,
			provider.recipientVersion,
			{ kind: "transcription", model: "whisper-1" },
		]);
		const multipart = {
			providerId: provider.id,
			model: "whisper-1",
			audio: { name: "fictional.webm", mimeType: "audio/webm", buffer: Buffer.from("FICTIONAL_RECORDING_ONLY") },
		};
		const result = await page.request.post("/api/openapi/career/voice/transcribe", {
			headers: { "x-ai-destination": approved },
			multipart,
		});
		await expect(result).toBeOK();
		expect(await result.json()).toMatchObject({ text: "Fictional transcript" });
		expect(requests).toHaveLength(1);
		expect(requests[0]?.body).toContain("whisper-1");
		expect(requests[0]?.body).toContain("FICTIONAL_RECORDING_ONLY");
		requests.length = 0;
		const mismatched = await page.request.post("/api/openapi/career/voice/transcribe", {
			headers: {
				"x-ai-destination": JSON.stringify([
					provider.id,
					provider.recipientVersion,
					{ kind: "speech", model: "tts-1" },
				]),
			},
			multipart,
		});
		expect(mismatched.status()).toBe(409);
		expect(requests).toHaveLength(0);
		const none = await page.request.post("/api/openapi/career/voice/transcribe", {
			headers: { "x-ai-destination": "none" },
			multipart,
		});
		expect(none.status()).toBe(409);
		expect(requests).toHaveLength(0);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
