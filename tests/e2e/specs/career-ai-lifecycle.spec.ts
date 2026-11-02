import type { Page } from "@playwright/test";
import { approveLocalStubOperations } from "../fixtures/ai-consent";
import { startAiStub } from "../fixtures/ai-stub";
import { createSampleResumeFromDashboard } from "../fixtures/resume";
import { expect, test } from "../fixtures/test";

// The coach's reply lifecycle, memory and the workspace's committed actions, against a scripted provider.

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
});
test.beforeEach(async ({ authPage }) => {
	await approveLocalStubOperations(authPage);
	test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs FLAG_ALLOW_UNSAFE_AI_BASE_URL=true");
	test.setTimeout(120_000);
});

async function connect(page: Page, label = "Demo connection", model = "stub") {
	const provider = await page.request.post("/api/openapi/ai-providers", {
		data: { label, provider: "openai-compatible", model, baseURL: stub.baseURL, apiKey: "stub-key" },
	});
	await expect(provider).toBeOK();
	const { id } = (await provider.json()) as { id: string };
	await expect(await page.request.post(`/api/openapi/ai-providers/${id}/test`)).toBeOK();
	return id;
}

async function createApplication(page: Page, company = "Harbor Freight Labs") {
	const response = await page.request.post("/api/openapi/applications", {
		data: { company, role: "Operations lead", status: "interview" },
	});
	await expect(response).toBeOK();
	return (await response.json()) as string;
}

const coachComposer = (page: Page) => page.getByPlaceholder("Ask about your next career step…");
const viewport = (page: Page) => page.locator('[data-slot="message-scroller-viewport"]');
const scrollTop = (page: Page) => viewport(page).evaluate((element) => element.scrollTop);

async function send(page: Page, text: string) {
	await coachComposer(page).fill(text);
	await expect(page.getByRole("button", { name: "Send", exact: true })).toBeEnabled();
	await coachComposer(page).press("Enter");
}

test("a stopped or failed reply keeps the reading position and its state after reopening", async ({
	authPage: page,
}, testInfo) => {
	const context = page.context();
	await page.setViewportSize({ width: 1280, height: 720 });
	await connect(page);
	await page.goto("/dashboard/career/coach");
	await send(page, "Answer slowly please, part one.");
	await expect(page.getByText(/word59/)).toBeVisible({ timeout: 30_000 });
	// Reopened, the transcript's turns are history: the scroller has settled none of them.
	await page.reload();
	await expect(page.getByText(/word59/)).toBeVisible();
	await send(page, "Answer slowly please, part two.");
	// The second answer is streaming once its own words appear below the first answer's.
	await expect(page.getByText(/word20/)).toHaveCount(2, { timeout: 30_000 });
	const before = await scrollTop(page);
	expect(before).toBeGreaterThan(200);
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(page.getByText("Stopped before the answer finished.")).toBeVisible();
	await page.waitForTimeout(600);
	expect(await scrollTop(page)).toBeGreaterThanOrEqual(before - 40);
	await page.screenshot({ path: testInfo.outputPath("stopped.png") });

	await page.reload();
	await expect(page.getByText("Stopped before the answer finished.")).toBeVisible();
	await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();

	// Offline: the app's own words, and no connection switch that couldn't help.
	await context.setOffline(true);
	const reading = await scrollTop(page);
	await send(page, "Are you still there?");
	await expect(
		page.getByText("Couldn't reach Reactive Resume. Check your internet connection, then try again."),
	).toBeVisible();
	await expect(page.getByRole("button", { name: "Change connection" })).toHaveCount(0);
	expect(await scrollTop(page)).toBeGreaterThanOrEqual(reading - 40);
	await page.screenshot({ path: testInfo.outputPath("offline.png") });
	await context.setOffline(false);
	await page.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(
		page.locator('[data-slot="message-scroller-content"]').getByText("Are you still there?", { exact: true }),
	).toHaveCount(1);
});

test("a provider's refusal is told in the app's words with a way to change connection", async ({ authPage: page }) => {
	await connect(page);
	await page.goto("/dashboard/career/coach");
	await send(page, "Please hit the rate limit.");
	await expect(page.getByText(/The AI provider is limiting requests \(rate limit or quota\)/)).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.getByRole("button", { name: "Change connection" })).toBeVisible();
	await expect(page.getByRole("main")).not.toContainText("stub-key");
	await expect(page.getByRole("main")).not.toContainText("exceeded your current quota");
});

test("Apply is saved before a reload, and Undo reverses only what it set", async ({ authPage: page }, testInfo) => {
	await page.setViewportSize({ width: 1440, height: 1000 });
	await connect(page, "Demo connection", "offer-fixture");
	const id = await createApplication(page, "Brightpath");
	const application = async () =>
		(await (await page.request.get(`/api/openapi/applications/${id}`)).json()) as {
			followUpAt: string | null;
			followUpNote: string | null;
		};
	const offers = async () =>
		(await (await page.request.get("/api/openapi/career/saved?kind=offer")).json()) as Array<{
			id: string;
			data: Record<string, unknown>;
		}>;
	const read = async () => {
		await page.goto(`/dashboard/applications/${id}/messages`);
		await page
			.getByLabel("Paste a message from Brightpath")
			.fill(
				"We are pleased to offer you the role at EUR 90,000, with a 10% target bonus. Reply by 20 November 2030 at 17:00 UTC.",
			);
		await page.getByRole("button", { name: "Read it for me" }).click();
		await expect(page.getByText("They're making an offer")).toBeVisible({ timeout: 30_000 });
	};

	await read();
	// Truthful next step: a follow-up date on the application, not a reminder in Today.
	await expect(page.getByText("Sets the application's follow-up date.", { exact: false })).toBeVisible();
	await expect(page.getByText(/Adds a reminder to Today/)).toHaveCount(0);
	const review = page.locator("aside").filter({ hasText: "Proposed changes" });
	for (const field of [
		"Offer type",
		"Currency",
		"Pay period",
		"Base salary",
		"Bonus",
		"Bonus conditions",
		"Equity",
		"Where you work",
		"Office days a week",
		"Leave",
		"Learning budget",
		"Other benefits",
		"Respond by",
	]) {
		await expect(review.getByText(field, { exact: true })).toBeVisible();
	}
	await expect(review).toContainText("Target annual bonus of 10%, depending on company performance");
	await page.getByRole("main").screenshot({ path: testInfo.outputPath("messages.png") });
	const applied = page.waitForResponse((response) => response.url().includes("/career/applyReply") && response.ok());
	const started = Date.now();
	await page.getByRole("button", { name: "Apply 2 changes" }).click();
	await applied;
	await page.reload();
	expect(Date.now() - started).toBeLessThan(6000);
	expect(await application()).toMatchObject({
		followUpAt: "2030-11-18T09:00:00.000Z",
		followUpNote: "Reply with your decision",
	});
	expect(await offers()).toEqual([
		expect.objectContaining({
			data: expect.objectContaining({ base: 90000, origin: "message", respondBy: "2030-11-20T17:00:00Z" }),
		}),
	]);

	// The comparison shows the percentage as written, where the terms came from, and what the message didn't say.
	await page.goto("/dashboard/career/offers");
	await expect(page.getByText("Target annual bonus of 10%, depending on company performance")).toBeVisible();
	await expect(page.getByText("No amount stated · value uncertain")).toBeVisible();
	await expect(page.getByText("Read from a message")).toBeVisible();
	await expect(page.getByText("Not found in the message").first()).toBeVisible();
	await expect(page.getByText("Is there a bonus, and what does it depend on?")).toHaveCount(0);
	await expect(page.getByText("When do they need your answer?")).toHaveCount(0);
	await page.getByRole("main").screenshot({ path: testInfo.outputPath("offers.png") });

	// Read again and Undo: the follow-up and saved offer go; the earlier offer stays.
	await read();
	await page.getByRole("button", { name: "Apply 2 changes" }).click();
	await expect(page.getByText("Application updated")).toBeVisible();
	expect(await offers()).toHaveLength(2);
	const undone = page.waitForResponse((response) => response.url().includes("/career/undoReply") && response.ok());
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await undone;
	await expect.poll(async () => (await offers()).length).toBe(1);
	expect(await application()).toMatchObject({
		followUpAt: "2030-11-18T09:00:00.000Z",
		followUpNote: "Reply with your decision",
	});
});

test("offer terms are edited where they're compared, and a stale tab can't overwrite them", async ({
	authPage: page,
}) => {
	const id = await createApplication(page, "Canopy Systems");
	await expect(
		await page.request.post("/api/openapi/career/offers", {
			data: { applicationId: id, currency: "USD", period: "year", base: 120000, variable: null },
		}),
	).toBeOK();
	const other = await page.context().newPage();
	for (const tab of [page, other]) {
		await tab.goto("/dashboard/career/offers");
		await expect(tab.getByText("Entered by you")).toBeVisible();
		await expect(tab.getByText("Left blank").first()).toBeVisible();
		await tab
			.getByRole("button", { name: /Canopy Systems/ })
			.first()
			.click();
		await tab.getByRole("menuitem", { name: "Edit terms" }).click();
		await expect(tab.getByRole("heading", { name: "Edit offer terms" })).toBeVisible();
		await expect(tab.getByLabel("Base salary", { exact: true })).toHaveValue("120000");
	}
	await page.getByLabel("Base salary", { exact: true }).fill("125000");
	await page.getByLabel("Equity", { exact: true }).fill("Later equity correction");
	await page.getByRole("button", { name: "Save offer", exact: true }).click();
	await expect(page.getByText("$125,000 a year", { exact: true })).toBeVisible();
	await other.getByLabel("Base salary", { exact: true }).fill("1");
	await other.getByRole("button", { name: "Save offer", exact: true }).click();
	await expect(
		other.getByText("This offer changed elsewhere. Review the latest terms before saving again."),
	).toBeVisible();
	// Refetch may update the comparison, but must not advance the open draft's expected snapshot.
	await expect(other.getByText("$125,000 a year", { exact: true })).toBeVisible();
	const secondSave = other.waitForResponse((response) => response.url().includes("/career/updateOffer"));
	await other.getByRole("button", { name: "Save offer", exact: true }).click();
	expect((await secondSave).status()).toBe(409);
	const [saved] = (await (await page.request.get("/api/openapi/career/saved?kind=offer")).json()) as Array<{
		data: Record<string, unknown>;
	}>;
	expect(saved?.data).toMatchObject({
		base: 125000,
		equity: "Later equity correction",
		origin: "manual",
		editedAt: expect.any(String),
	});
	await other.close();
});

test("the coach remembers a message on request, in Never mode, without asking the AI", async ({ authPage: page }) => {
	await connect(page);
	const profile = await (await page.request.get("/api/openapi/career/profile")).json();
	await expect(
		await page.request.put("/api/openapi/career/profile", { data: { ...profile, memoryMode: "off" } }),
	).toBeOK();
	await page.goto("/dashboard/career/coach");
	await expect(page.getByText("The coach doesn't remember anything you write.")).toBeVisible();
	const said = "I mentored three junior designers; two were promoted.";
	await send(page, said);
	await expect(page.getByText("You left the document out.")).toBeVisible({ timeout: 30_000 });
	const requests = stub.requests.length;
	await page.getByText(said).hover();
	await page.getByRole("button", { name: "Remember", exact: true }).click();
	await page.getByLabel("Remember as a fact in Knowledge").fill("Mentored three junior designers; two were promoted");
	await page.getByRole("button", { name: "Remember", exact: true }).click();
	await expect(page.getByText("Added to Knowledge.")).toBeVisible();
	const facts = (await (await page.request.get("/api/openapi/career/facts")).json()) as Array<{
		text: string;
		source: { kind: string; quote: string };
	}>;
	expect(facts).toEqual([
		expect.objectContaining({
			text: "Mentored three junior designers; two were promoted",
			source: expect.objectContaining({ kind: "user-message", quote: said }),
		}),
	]);
	expect(stub.requests.length).toBe(requests);
});

for (const scope of ["career", "application"] as const)
	test(`a proposed story is reviewed part by part, edited in place and saved in its scope (${scope})`, async ({
		authPage: page,
	}, testInfo) => {
		await page.setViewportSize({ width: 1280, height: 1100 });
		await connect(page);
		const fact = "I wrote a setup checklist and reviewed it with support.";
		await expect(
			await page.request.post("/api/openapi/career/facts", {
				data: { text: fact, category: "experience", source: { kind: "manual", id: "story-fact", quote: fact } },
			}),
		).toBeOK();
		let applicationId: string | null = null;
		if (scope === "application") {
			applicationId = await createApplication(page);
			await page.goto(`/dashboard/applications/${applicationId}`);
			await page.getByRole("button", { name: "Ask the coach", exact: true }).click();
			const composer = page.getByPlaceholder("Ask about this application…");
			await composer.fill("Review a story about my onboarding work.");
			await composer.press("Enter");
		} else {
			await page.goto("/dashboard/career/coach");
			await send(page, "Review a story about my onboarding work.");
		}
		const card = page.getByText("Save this story to Knowledge?", { exact: true }).locator("..");
		await expect(card).toBeVisible({ timeout: 30_000 });
		for (const label of ["Situation", "Task", "Action", "Result", "Reflection", "Backed by"])
			await expect(card.getByText(label, { exact: true })).toBeVisible();
		await expect(card.getByText("Left blank. Add it later only if you can support it.")).toBeVisible();
		await expect(card.locator("p").filter({ hasText: fact })).toBeVisible();
		if (scope === "career") await card.screenshot({ path: testInfo.outputPath("story-approval.png") });
		const requests = stub.requests.length;

		// Edit first opens the story editor in place; Cancel keeps the edits for the next Edit first.
		await card.getByRole("button", { name: "Edit first" }).click();
		const title = page.getByLabel("Title");
		await expect(title).toHaveValue("Improving customer onboarding");
		const task = page.getByPlaceholder("What were you responsible for?");
		await expect(task).toHaveValue("Make onboarding easier to follow.");
		await task.fill("Make onboarding easier to follow for new admins.");
		await page.getByRole("button", { name: "Cancel", exact: true }).click();
		await expect(page.getByText("Save this story to Knowledge?", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Edit first" }).click();
		await expect(page.getByPlaceholder("What were you responsible for?")).toHaveValue(
			"Make onboarding easier to follow for new admins.",
		);
		expect(stub.requests.length).toBe(requests);
		await page.getByRole("button", { name: "Save story", exact: true }).click();
		const stories = async () =>
			(await (
				await page.request.get(`/api/openapi/career/stories${applicationId ? `?applicationId=${applicationId}` : ""}`)
			).json()) as Array<{ applicationId: string | null; data: Record<string, unknown> }>;
		await expect.poll(stories).toEqual([
			expect.objectContaining({
				applicationId,
				data: expect.objectContaining({ task: "Make onboarding easier to follow for new admins.", result: "" }),
			}),
		]);
		// The proposal as it stood is declined, so the coach never saves a second copy.
		await expect(page.getByText("Save this story to Knowledge?", { exact: true })).toHaveCount(0);
	});

test("conversations keep their connection, and the account default doesn't drift", async ({ authPage: page }) => {
	const first = await connect(page, "First connection");
	const second = await connect(page, "Second connection");
	await page.goto("/dashboard/career/coach");
	await page.getByRole("button", { name: /Connection: First connection/ }).click();
	await page.getByRole("menuitem", { name: /Second connection/ }).click();
	await send(page, "Hello from the second connection.");
	await expect(page.getByText("You left the document out.")).toBeVisible({ timeout: 30_000 });
	const providers = async () =>
		(await (await page.request.get("/api/openapi/ai-providers")).json()) as Array<{ id: string; isDefault: boolean }>;
	expect((await providers()).find((item) => item.isDefault)?.id).toBe(first);
	await expect(await page.request.patch(`/api/openapi/ai-providers/${second}`, { data: { enabled: false } })).toBeOK();
	await page.reload();
	await expect(page.getByText(/Second connection is off or was removed/)).toBeVisible();
	await expect(coachComposer(page)).toBeDisabled();
	await page.getByRole("button", { name: "Use First connection" }).click();
	await expect(coachComposer(page)).toBeEnabled();
});

test("Web research without a search service is a way to set one up", async ({ authPage: page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await connect(page);
	await page.goto("/dashboard/career/coach");
	await expect(page.getByRole("link", { name: "Web research · Set up" })).toHaveAttribute(
		"href",
		"/dashboard/settings/ai",
	);
	await expect(page.getByText("Search terms go to your web search service.")).toHaveCount(0);
});

test("the provider switch shows each saved result and toggles twice without reopening", async ({ authPage: page }) => {
	const id = await connect(page);
	await page.goto("/dashboard/settings/ai");
	await page.getByRole("button", { name: "Edit", exact: true }).first().click();
	const use = page.getByRole("switch", { name: "Use this provider" });
	await expect(use).toBeChecked();
	const enabled = async () =>
		(
			(await (await page.request.get("/api/openapi/ai-providers")).json()) as Array<{ id: string; enabled: boolean }>
		).find((item) => item.id === id)?.enabled;
	await use.click();
	await expect(use).not.toBeChecked();
	await expect.poll(enabled).toBe(false);
	await use.click();
	await expect(use).toBeChecked();
	await expect.poll(enabled).toBe(true);
});

test("after a Knowledge change the conversation says which messages aren't sent, and doesn't send them", async ({
	authPage: page,
}) => {
	await connect(page);
	await page.goto("/dashboard/career/coach");
	await send(page, "My code word is PELICAN-42.");
	await expect(page.getByText("You left the document out.")).toBeVisible({ timeout: 30_000 });
	const fact = "I led the Q3 onboarding rewrite.";
	const saved = await page.request.post("/api/openapi/career/facts", {
		data: { text: fact, category: "accomplishment", source: { kind: "manual", id: "cutoff-fact", quote: fact } },
	});
	await expect(saved).toBeOK();
	await expect(await page.request.delete(`/api/openapi/career/facts/${(await saved.json()).id}`)).toBeOK();
	await page.reload();
	await expect(page.getByText(/Messages above aren't sent to the AI anymore/)).toBeVisible();
	await expect(page.getByText(/Messages from before Knowledge changed aren't sent\./)).toBeVisible();
	const before = stub.requests.length;
	await send(page, "What was the code word?");
	await expect(page.getByText("You left the document out.")).toHaveCount(2, { timeout: 30_000 });
	const sent = stub.requests.slice(before).map((request) => JSON.stringify(request.messages));
	expect(sent.length).toBeGreaterThan(0);
	for (const body of sent) expect(body).not.toContain("PELICAN-42");
});

test("an accepted tightening is saved at once and Undo restores the user's own answer", async ({ authPage: page }) => {
	await connect(page);
	const id = await createApplication(page, "Northwind");
	const answer = "I led the checkout audit and fixed 48 issues. I co-organise the Berlin meetup.";
	await expect(
		await page.request.patch(`/api/openapi/career/workspace/${id}`, {
			data: {
				answers: [{ id: "why", question: "Why this role?", answer, factIds: [] }],
				expected: { answers: [] },
			},
		}),
	).toBeOK();
	const saved = async () =>
		(
			(await (await page.request.get(`/api/openapi/career/workspace/${id}`)).json()) as {
				answers: { answer: string }[];
			}
		).answers[0]?.answer;
	await page.goto(`/dashboard/applications/${id}/apply`);
	await page.getByRole("button", { name: "Tighten" }).click();
	await expect(page.getByText(/changes or removes 1 of your sentences/)).toBeVisible({ timeout: 30_000 });
	await page.getByRole("button", { name: "Accept" }).click();
	await expect.poll(saved).toBe("I led the checkout audit and fixed 48 issues.");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect.poll(saved).toBe(answer);
});

test("Try again after a reply stopped before saying anything replaces it, without repeating the question", async ({
	authPage: page,
}) => {
	await connect(page);
	await page.goto("/dashboard/career/coach");
	await send(page, "Please pause first.");
	await page.waitForTimeout(1000);
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await expect(page.getByText("Stopped before answering.")).toBeVisible();
	await page.reload();
	await expect(page.getByText("Stopped before answering.")).toBeVisible();
	await page.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(page.getByText(/late11/)).toBeVisible({ timeout: 30_000 });
	await page.reload();
	await expect(page.getByText(/late11/)).toBeVisible();
	const id = page.url().split("/").pop();
	const { messages } = (await (await page.request.get(`/api/openapi/agent/threads/${id}`)).json()) as {
		messages: Array<{ role: string; parts: unknown[] }>;
	};
	expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
	await expect(
		page.locator('[data-slot="message-scroller-content"]').getByText("Please pause first.", { exact: true }),
	).toHaveCount(1);
});

for (const field of ["answer", "factIds"] as const)
	test(`Tighten Undo conflicts with a later ${field} correction at the HTTP save boundary`, async ({
		authPage: page,
	}, testInfo) => {
		await connect(page);
		const id = await createApplication(page, "Undo boundary fiction");
		const original = {
			id: "why",
			question: "Why this role?",
			answer: "I led the checkout audit and fixed 48 issues. I co-organise the Berlin meetup.",
			factIds: [],
		};
		const read = async () =>
			(await (await page.request.get(`/api/openapi/career/workspace/${id}`)).json()).answers as Array<typeof original>;
		await expect(
			await page.request.patch(`/api/openapi/career/workspace/${id}`, {
				data: { answers: [original], expected: { answers: [] } },
			}),
		).toBeOK();
		await page.goto(`/dashboard/applications/${id}/apply`);
		await page.getByRole("button", { name: "Tighten" }).click();
		await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeVisible({ timeout: 30_000 });
		await page.getByRole("button", { name: "Accept", exact: true }).click();
		const undo = page.getByRole("button", { name: "Undo", exact: true });
		await expect(undo).toBeVisible();
		await undo.hover();
		const accepted = await read();
		const proof = await page.request.post("/api/openapi/career/facts", {
			data: {
				applicationId: id,
				text: "Later verified correction.",
				category: "accomplishment",
				source: { kind: "manual", id: "manual", quote: "Later verified correction." },
			},
		});
		await expect(proof).toBeOK();
		const fact = (await proof.json()) as { id: string };
		const later = accepted.map((answer) => ({
			...answer,
			...(field === "answer" ? { answer: "Later authoritative correction. Keep it." } : { factIds: [fact.id] }),
		}));
		await page.route("**/api/rpc/career/saveWorkspace", async (route) => {
			const body = route.request().postDataJSON();
			const payload = body.json ?? body;
			expect(payload.expected.answers).toEqual(accepted);
			// Another writer commits after the inverse was constructed, before the real protected SQL write.
			await expect(
				await page.request.patch(`/api/openapi/career/workspace/${id}`, {
					data: { answers: later, expected: { answers: accepted } },
				}),
			).toBeOK();
			await testInfo.attach("inverse-request", { body: JSON.stringify(payload), contentType: "application/json" });
			await route.continue();
		});
		const response = page.waitForResponse((value) => value.url().includes("/career/saveWorkspace"));
		await undo.click();
		expect((await response).status()).toBe(409);
		expect(await read()).toEqual(later);
		await page.waitForTimeout(2100);
		expect(await read()).toEqual(later);
		await page.unroute("**/api/rpc/career/saveWorkspace");
	});

for (const scheme of ["light", "dark"] as const)
	test(`on a 390×844 phone the coach fits the screen above the tab bar (${scheme})`, async ({
		authPage: page,
	}, testInfo) => {
		await page.emulateMedia({ colorScheme: scheme });
		await page.setViewportSize({ width: 390, height: 844 });
		await connect(page);
		await page.goto("/dashboard/career/coach");
		await send(page, "Answer slowly please, on a phone.");
		await expect(page.getByText(/word59/)).toBeVisible({ timeout: 30_000 });
		const geometry = await page.evaluate(() => {
			const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
			const nav = [...document.querySelectorAll("nav")].find((element) => element.getBoundingClientRect().top > 700);
			const chips = document
				.querySelector('[aria-label="Message the coach"]')
				?.closest(".grid")
				?.querySelector(".flex-1");
			return {
				innerHeight: window.innerHeight,
				documentHeight: document.scrollingElement?.scrollHeight ?? 0,
				navTop: nav?.getBoundingClientRect().top ?? 0,
				viewport: box('[data-slot="message-scroller-viewport"]'),
				composer: box("textarea"),
				privacy: [...document.querySelectorAll("p")]
					.find((element) => element.textContent?.startsWith("When you press send"))
					?.getBoundingClientRect(),
				chipsHeight: chips?.getBoundingClientRect().height ?? 0,
				chipsScroll: chips ? chips.scrollWidth > chips.clientWidth : false,
			};
		});
		testInfo.attach("geometry", { body: JSON.stringify(geometry, null, 2), contentType: "application/json" });
		// One scroll area: the page itself doesn't scroll; the transcript gets most of the screen.
		expect(geometry.documentHeight).toBeLessThanOrEqual(geometry.innerHeight + 1);
		expect(geometry.viewport?.height ?? 0).toBeGreaterThan(400);
		// The composer and privacy line sit above the tab bar; the chips are one row.
		expect(geometry.composer?.bottom ?? Infinity).toBeLessThanOrEqual(geometry.navTop);
		expect(geometry.privacy?.bottom ?? Infinity).toBeLessThanOrEqual(geometry.navTop);
		expect(geometry.chipsHeight).toBeLessThanOrEqual(32);
		await page.screenshot({ path: testInfo.outputPath(`phone-coach-${scheme}.png`) });
	});

test("the builder assistant keeps the reading position when a reply in a reopened conversation stops", async ({
	authPage: page,
}, testInfo) => {
	await page.setViewportSize({ width: 1280, height: 720 });
	await connect(page);
	await createSampleResumeFromDashboard(page, testInfo);
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	const composer = page.getByLabel("Message the assistant");
	const ask = async (text: string) => {
		await expect(page.getByRole("button", { name: "Send" }).last()).toBeVisible({ timeout: 20_000 });
		await composer.fill(text);
		await composer.press("Enter");
	};
	await ask("Answer slowly please, part one.");
	await expect(page.getByText(/word59/)).toBeVisible({ timeout: 30_000 });
	await page.reload();
	// The open conversation is in the URL, so a reload brings the assistant back on it.
	await expect(page.getByRole("region", { name: "Assistant" })).toBeVisible();
	await expect(page.getByText(/word59/)).toBeVisible({ timeout: 20_000 });
	await ask("Answer slowly please, part two.");
	await expect(page.getByText(/word20/)).toHaveCount(2, { timeout: 30_000 });
	const before = await scrollTop(page);
	expect(before).toBeGreaterThan(200);
	await page.getByRole("button", { name: "Stop", exact: true }).click();
	await page.waitForTimeout(800);
	expect(await scrollTop(page)).toBeGreaterThanOrEqual(before - 40);
});

test("the builder assistant says when its connection is gone and waits for a choice", async ({
	authPage: page,
}, testInfo) => {
	const first = await connect(page, "First connection");
	const second = await connect(page, "Second connection");
	await createSampleResumeFromDashboard(page, testInfo);
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	const composer = page.getByLabel("Message the assistant");
	await composer.fill("Answer slowly please.");
	await composer.press("Enter");
	await expect(page.getByText(/word59/)).toBeVisible({ timeout: 30_000 });
	await expect(await page.request.patch(`/api/openapi/ai-providers/${first}`, { data: { enabled: false } })).toBeOK();
	await page.reload();
	// The open conversation is in the URL, so a reload brings the assistant back on it.
	await expect(page.getByRole("region", { name: "Assistant" })).toBeVisible();
	await expect(page.getByText(/First connection is off or was removed/)).toBeVisible({ timeout: 20_000 });
	await expect(composer).toBeDisabled();
	const providers = (await (await page.request.get("/api/openapi/ai-providers")).json()) as Array<{
		id: string;
		isDefault: boolean;
	}>;
	// Nothing was rebound behind the user's back, and the account default is still the first connection.
	expect(providers.find((item) => item.isDefault)?.id).toBe(first);
	const beforeSwitch = stub.requests.length;
	await page.getByRole("button", { name: "Use Second connection" }).click();
	await expect(page.getByRole("alertdialog")).toContainText("Earlier messages and attachments");
	expect(stub.requests.length).toBe(beforeSwitch);
	await page.getByRole("button", { name: "Use this destination", exact: true }).click();
	await expect(composer).toBeEnabled();
	await expect
		.poll(async () => {
			const threads = (await (await page.request.get("/api/openapi/agent/threads")).json()) as Array<{
				aiProviderId: string | null;
			}>;
			return threads[0]?.aiProviderId;
		})
		.toBe(second);
});

test("the builder assistant searches Knowledge only when asked, and says what it read", async ({
	authPage: page,
}, testInfo) => {
	await connect(page);
	const fact = "I spoke on design tokens at Config Europe 2025.";
	await expect(
		await page.request.post("/api/openapi/career/facts", {
			data: { text: fact, category: "accomplishment", source: { kind: "manual", id: "talk-fact", quote: fact } },
		}),
	).toBeOK();
	await createSampleResumeFromDashboard(page, testInfo);
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	const composer = page.getByLabel("Message the assistant");
	const tools = (from: number) =>
		stub.requests.slice(from).flatMap((request) => (request.tools ?? []).map((tool) => tool.function.name));
	let from = stub.requests.length;
	await composer.fill("Add my talk from Knowledge.");
	await composer.press("Enter");
	await expect(page.getByText(/tightened one passage|Tighten the first passage|proposed/).first()).toBeVisible({
		timeout: 30_000,
	});
	expect(tools(from)).not.toContain("read_knowledge");
	await page.getByRole("button", { name: "New conversation" }).click();
	await page.getByRole("button", { name: "Knowledge", exact: true }).click();
	await expect(page.getByText(/It can also search your shared Knowledge/)).toBeVisible();
	from = stub.requests.length;
	await composer.fill("Add my talk from Knowledge.");
	await composer.press("Enter");
	await expect(page.getByText("I found your conference talk in Knowledge. Add it under Speaking?")).toBeVisible({
		timeout: 30_000,
	});
	expect(tools(from)).toContain("read_knowledge");
	// The tool result the provider received is the user's own shared fact.
	expect(JSON.stringify(stub.requests.slice(from))).toContain(fact);
	await page.getByRole("button", { name: "1 fact", exact: true }).click();
	await expect(page.getByRole("dialog").getByText(fact)).toBeVisible();
});

test("Add to resume opens the resume's assistant with the answer unsent and out of the URL", async ({
	authPage: page,
}, testInfo) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await connect(page);
	await createSampleResumeFromDashboard(page, testInfo);
	await page.goto("/dashboard/career/coach");
	await send(page, "Which of my applications should I follow up on this week?");
	await expect(page.getByText(/Draft the Brightpath note now and send it on Friday\./)).toBeVisible({
		timeout: 30_000,
	});
	await expect(page.getByRole("button", { name: "Add to resume" })).toBeVisible();
	await page.getByRole("main").screenshot({ path: testInfo.outputPath("coach.png") });
	const requests = stub.requests.length;
	await page.getByRole("button", { name: "Add to resume" }).click();
	await page.getByRole("menuitem").first().click();
	await page.waitForURL(/\/builder\//);
	const composer = page.getByLabel("Message the assistant");
	await expect(composer).toHaveValue(/Add this to my resume where it fits[\s\S]*Follow up with Brightpath first/);
	expect(page.url()).not.toMatch(/ask=|Brightpath/);
	expect(stub.requests.length).toBe(requests);
	// Handed over once: a reload doesn't bring it back.
	await page.reload();
	await page.getByRole("button", { name: "Assistant", exact: true }).click();
	await expect(page.getByLabel("Message the assistant")).not.toHaveValue(/Brightpath/);
});
