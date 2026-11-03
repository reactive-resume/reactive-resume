import type { Page } from "@playwright/test";
import { Pool } from "pg";
import { approveLocalStubOperations } from "../fixtures/ai-consent";
import { startAiStub } from "../fixtures/ai-stub";
import { failRpcProcedure } from "../fixtures/rpc-failure";
import { expect, test } from "../fixtures/test";

let stub: Awaited<ReturnType<typeof startAiStub>>;
let database: Pool;
test.beforeAll(async () => {
	if (!process.env.DATABASE_URL) throw new Error("Disposable DATABASE_URL is required.");
	database = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub.close();
	await database.end();
});

async function setup(page: Page, hours = 2, status = "interview") {
	const round = {
		id: "fictional-next-round",
		type: "interview",
		at: new Date(Date.now() + hours * 3_600_000).toISOString(),
		kind: "technical",
		durationMinutes: 45,
		location: "Fictional video call",
		notes: "Review the fictional reliability project.",
		audience: "practitioner",
		participants: [],
		timezone: "UTC",
	};
	const response = await page.request.post("/api/openapi/applications", {
		data: {
			company: "Fictional Cedar",
			role: "Engineer",
			status,
			followUpAt: new Date(Date.now() + 30 * 60_000).toISOString(),
			followUpNote: "Fictional earlier reminder",
		},
	});
	await expect(response).toBeOK();
	const id = (await response.json()) as string;
	await expect(await page.request.post(`/api/openapi/applications/${id}/interviews`, { data: round })).toBeOK();
	const read = await page.request.get(`/api/openapi/applications/${id}`);
	await expect(read).toBeOK();
	const detail = (await read.json()) as { activity: Array<typeof round> };
	const saved = detail.activity.find((entry) => entry.type === "interview" && entry.at === round.at);
	if (!saved) throw new Error("Fixture did not persist the interview through its protected endpoint.");
	expect(saved).toMatchObject({ at: round.at, notes: round.notes, kind: "technical" });
	return { id, round: saved };
}

async function connect(page: Page) {
	test.skip(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL !== "true", "Needs the isolated local AI stub flag.");
	const response = await page.request.post("/api/openapi/ai-providers", {
		data: {
			label: "Fictional local connection",
			provider: "openai-compatible",
			model: "stub",
			baseURL: stub.baseURL,
			apiKey: "stub-key",
		},
	});
	await expect(response).toBeOK();
	await expect(await page.request.post(`/api/openapi/ai-providers/${(await response.json()).id}/test`)).toBeOK();
}

for (const width of [1440, 390]) {
	test(`Today immediately generates an owned briefing and opens three questions (${width})`, async ({
		authPage: page,
	}, info) => {
		await page.setViewportSize({ width, height: 1000 });
		const application = await setup(page);
		await connect(page);
		await approveLocalStubOperations(page);
		await page.goto("/dashboard/career");
		await expect(
			page
				.getByRole("region", { name: "Coming up", exact: true })
				.getByText("Fictional earlier reminder", { exact: true }),
		).toBeVisible();
		const section = page.getByRole("heading", { name: "Prepare for Fictional Cedar", exact: true }).locator("..");
		await expect(section.locator("time")).toHaveAttribute("datetime", application.round.at);
		await expect(section).toContainText("Fictional local connection");
		const generate = section.getByRole("button", { name: "Generate briefing now", exact: true });
		const before = stub.requests.length;
		const schedules = (
			await database.query(
				"select id,kind,interview_id,enabled from career_schedule where application_id=$1 order by id",
				[application.id],
			)
		).rows;
		await page.screenshot({ path: info.outputPath("today-prepare-now.png"), fullPage: true });
		await generate.click();
		await expect(section.getByRole("status").getByText("Briefing ready", { exact: true })).toBeVisible();
		expect(stub.requests.slice(before)).toHaveLength(1);
		const rows = (
			await database.query("select id,interview_id,data from career_artifact where application_id=$1", [application.id])
		).rows;
		expect(rows).toEqual([
			expect.objectContaining({
				interview_id: application.round.id,
				data: expect.objectContaining({ kind: "briefing", practiceQuestions: expect.any(Array) }),
			}),
		]);
		expect(rows[0]?.data.practiceQuestions).toHaveLength(5);
		expect(
			(
				await database.query(
					"select id,kind,interview_id,enabled from career_schedule where application_id=$1 order by id",
					[application.id],
				)
			).rows,
		).toEqual(schedules);
		const readback = await page.request.get("/api/openapi/career/saved", {
			params: { applicationId: application.id, kind: "briefing" },
		});
		await expect(readback).toBeOK();
		expect(await readback.json()).toEqual([
			expect.objectContaining({ id: rows[0]?.id, interviewId: application.round.id }),
		]);
		await page.reload();
		await section.getByRole("link", { name: "Practice 3 questions", exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`/applications/${application.id}/practise\\?`));
		expect(new URL(page.url()).searchParams.get("round")).toBe(application.round.id);
		expect(new URL(page.url()).searchParams.get("warmup")).toBe("true");
		await expect(page.getByText(/^Question 1 of 3 · Practice$/)).toBeVisible();
		await expect(page.getByText("Fictional round question one?", { exact: true })).toBeVisible();
		expect(stub.requests.slice(before)).toHaveLength(1);
	});

	test(`Coach opens named Practice without a provider and preserves its unsent draft (${width})`, async ({
		authPage: page,
	}, info) => {
		const application = await setup(page);
		await page.setViewportSize({ width, height: 1000 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto("/dashboard/career/coach");
		const handoff = page.getByRole("link", { name: "Practice in Fictional Cedar’s workspace", exact: true });
		const unconnected = stub.requests.length;
		await handoff.click();
		await expect(page.getByText(/^Question 1 of 3 · Practice$/)).toBeVisible();
		expect(stub.requests).toHaveLength(unconnected);
		await page.goBack();
		await connect(page);
		await page.reload();
		const composer = page.getByPlaceholder("Ask about your next career step…");
		await composer.fill("Fictional unsent interview question");
		const before = stub.requests.length;
		await page.getByRole("link", { name: "Practice in Fictional Cedar’s workspace", exact: true }).click();
		await expect(page.getByText(/^Question 1 of 3 · Practice$/)).toBeVisible();
		expect(new URL(page.url()).pathname).toBe(`/dashboard/applications/${application.id}/practise`);
		await page.goBack();
		await expect(composer).toHaveValue("Fictional unsent interview question");
		expect(stub.requests).toHaveLength(before);
		await approveLocalStubOperations(page);
		await composer.fill("Ask me a question first");
		await composer.press("Enter");
		await expect(page.getByRole("button", { name: "Yes, I have", exact: true })).toBeEnabled();
		await composer.fill("Fictional unsent continuation");
		const existing = stub.requests.length;
		await handoff.click();
		await expect(page.getByText(/^Question 1 of 3 · Practice$/)).toBeVisible();
		await page.goBack();
		await expect(composer).toHaveValue("Fictional unsent continuation");
		expect(stub.requests).toHaveLength(existing);
		await expect(handoff).toBeVisible();
		await page.screenshot({
			path: info.outputPath("coach-practice-handoff.png"),
			fullPage: true,
			animations: "disabled",
		});
	});
}

test("normal and three-question Practice keep independent drafts through reload", async ({ authPage: page }) => {
	const application = await setup(page);
	const normal = `/dashboard/applications/${application.id}/practise?round=${application.round.id}`;
	await page.goto(normal);
	const answer = page.getByRole("textbox", { name: "Your answer", exact: true });
	await answer.fill("Fictional normal practice draft");
	await page.reload();
	await expect(answer).toHaveValue("Fictional normal practice draft");
	await page.goto(`${normal}&warmup=true`);
	await expect(answer).toHaveValue("");
	await answer.fill("Fictional quick practice draft");
	await page.reload();
	await expect(answer).toHaveValue("Fictional quick practice draft");
	await page.goto(normal);
	await expect(answer).toHaveValue("Fictional normal practice draft");
});

test("Today requires a future active interview within24h; Coach can link a later round", async ({ authPage: page }) => {
	const application = await setup(page, 25);
	await page.goto("/dashboard/career");
	await expect(page.getByText("Coming up", { exact: true })).toBeVisible();
	await expect(page.getByRole("button", { name: "Generate briefing now", exact: true })).toHaveCount(0);
	await page.goto("/dashboard/career/coach");
	await expect(page.getByRole("link", { name: "Practice in Fictional Cedar’s workspace", exact: true })).toBeVisible();
	await expect(
		await page.request.put(`/api/openapi/applications/${application.id}`, { data: { status: "closed" } }),
	).toBeOK();
	await page.goto("/dashboard/career");
	await expect(page.getByRole("region", { name: "Schedules", exact: true })).toBeVisible();
	await expect(page.getByRole("link", { name: "Practice 3 questions", exact: true })).toHaveCount(0);
	await page.goto("/dashboard/career/coach");
	await expect(page.getByRole("link", { name: "Practice in Fictional Cedar’s workspace", exact: true })).toHaveCount(0);
});

test("unavailable full application context prevents generation until explicit retry", async ({ authPage: page }) => {
	await setup(page);
	await connect(page);
	let failed = true;
	await page.route("**/api/rpc/**", async (route) => {
		if (failed) await failRpcProcedure(route, "/api/rpc/applications/getById", "Fictional detail unavailable");
		else await route.continue();
	});
	await page.goto("/dashboard/career");
	const failure = page.getByRole("alert").filter({ hasText: "Couldn't load this. Your saved data hasn't changed." });
	await expect(failure).toBeVisible();
	await expect(page.getByRole("button", { name: "Generate briefing now", exact: true })).toHaveCount(0);
	const before = stub.requests.length;
	failed = false;
	await failure.getByRole("button", { name: "Try again", exact: true }).click();
	await expect(page.getByRole("button", { name: "Generate briefing now", exact: true })).toBeEnabled();
	expect(stub.requests).toHaveLength(before);
});

test("declining immediate briefing consent dispatches nothing and saves nothing", async ({ authPage: page }) => {
	const application = await setup(page);
	await connect(page);
	await page.goto("/dashboard/career");
	const before = stub.requests.length;
	const generate = page.getByRole("button", { name: "Generate briefing now", exact: true });
	await generate.click();
	const consent = page.getByRole("alertdialog");
	await expect(consent).toContainText("127.0.0.1");
	await consent.getByRole("button", { name: "Don't share", exact: true }).click();
	await expect(consent).toHaveCount(0);
	await expect(generate).toBeEnabled();
	expect(stub.requests).toHaveLength(before);
	expect(
		(await database.query("select id from career_artifact where application_id=$1", [application.id])).rowCount,
	).toBe(0);
});

test("an unavailable named quick-Practice round never falls back to another interview", async ({ authPage: page }) => {
	const application = await setup(page);
	await page.goto(`/dashboard/applications/${application.id}/practise?round=fictional-removed-round&warmup=true`);
	await expect(page.getByText("This interview is unavailable.", { exact: true })).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Your answer", exact: true })).toHaveCount(0);
});
