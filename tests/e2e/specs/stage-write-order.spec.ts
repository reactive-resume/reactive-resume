import type { Page, Route } from "@playwright/test";
import { Pool } from "pg";
import { approveLocalStubOperations } from "../fixtures/ai-consent";
import { startAiStub } from "../fixtures/ai-stub";
import { expect, test } from "../fixtures/test";

// Both server and browser run at 08:00 UTC; display dates must never stand for write order.

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const stored = async (id: string) =>
	(await pool.query("select status, lane_id, activity from application where id = $1", [id])).rows[0];
async function history(id: string, intended: unknown) {
	await test.info().attach("SQL history and intended result", {
		body: JSON.stringify({ clock: new Date().toISOString(), intended, stored: await stored(id) }, null, 2),
		contentType: "application/json",
	});
}

let stub: Awaited<ReturnType<typeof startAiStub>>;
test.beforeAll(async () => {
	stub = await startAiStub();
});
test.afterAll(async () => {
	await stub?.close();
	await pool.end();
});
test.beforeEach(async ({ authPage }) => {
	await approveLocalStubOperations(authPage);
	await authPage.clock.setFixedTime(new Date("2026-11-01T08:00:00Z"));
	await authPage.setViewportSize({ width: 1280, height: 900 });
});

const today = "2026-11-01";

async function api<T>(page: Page, method: "get" | "post" | "put", path: string, data?: unknown): Promise<T> {
	const response = await page.request[method](`/api/openapi${path}`, data === undefined ? {} : { data });
	await expect(response, `${method} ${path}`).toBeOK();
	const text = await response.text();
	return (text ? JSON.parse(text) : undefined) as T;
}
type Application = { status: string; laneId: string | null; activity: { type: string; stage?: string }[] };
const read = (page: Page, id: string) => api<Application>(page, "get", `/applications/${id}`);

async function hold(page: Page, path: string) {
	let release = (_outcome: "continue" | "fail") => {};
	const released = new Promise<"continue" | "fail">((resolve) => (release = resolve));
	let held = 0;
	await page.route(`**/api/rpc/${path}`, async (route: Route) => {
		held += 1;
		if ((await released) === "continue") await route.continue();
		else await route.abort("connectionreset");
	});
	return { release, held: () => held };
}

/** Holds every RPC request (single or batched) that carries `path`, until released. */
async function holdCarrying(page: Page, path: string) {
	let release = () => {};
	const released = new Promise<void>((resolve) => (release = resolve));
	let held = 0;
	await page.route("**/api/rpc/**", async (route: Route) => {
		const request = route.request();
		const carries = request.url().includes(path) || (request.postData() ?? "").includes(path);
		if (!carries) return route.fallback();
		held += 1;
		await released;
		await route.continue();
	});
	return { release, held: () => held };
}

async function bulkMove(page: Page, company: string, stage: string, navigate = true) {
	if (navigate) await page.getByRole("link", { name: "Applications", exact: true }).click();
	await page.getByRole("checkbox", { name: new RegExp(`at ${company}`) }).click();
	await page.getByRole("button", { name: "Move to…" }).click();
	await page.getByRole("menuitem", { name: stage }).click();
	await expect(page.getByText(`1 application moved to ${stage}`)).toBeVisible();
}
const changedToast = (page: Page) =>
	page.getByText("1 application changed in the meantime, so it keeps its newer stage");

for (const dated of [true, false])
	for (const origin of ["add", "mark-applied"] as const)
		for (const outside of ["lane-only", "ABA"] as const)
			test(`R1 outside ${outside} move while bulk waits (${origin}, ${dated ? "dated today" : "undated"}) wins`, async ({
				authPage: page,
			}) => {
				const pipeline = await api<{ revision: number }>(page, "get", "/applications/lanes");
				const lanes = await api<{ lanes: { id: string; label: string | null }[] }>(
					page,
					"post",
					"/applications/lanes",
					{
						expectedRevision: pipeline.revision,
						label: "Referral",
						category: "applied",
						color: "#123456",
					},
				);
				const referral = lanes.lanes.find((lane) => lane.label === "Referral");
				if (!referral) throw new Error("lane");
				const company = dated ? "Alder Co" : "Birch Co";
				const id = await api<string>(page, "post", "/applications", {
					company,
					role: "Probe lead",
					status: origin === "add" ? "applied" : "saved",
					...(dated ? { stageEnteredAt: today } : {}),
				});
				if (origin === "mark-applied")
					await api(page, "put", `/applications/${id}`, {
						status: "applied",
						...(dated ? { stageEnteredAt: today } : {}),
					});
				await page.goto("/dashboard/applications");
				await expect(page.getByText(company).first()).toBeVisible();
				const initialLaneId = (await read(page, id)).laneId;
				const bulk = await hold(page, "applications/bulkUpdate");
				await bulkMove(page, company, "Interview", false);
				// Another device drags it to another Applied lane before this move reaches the server.
				if (outside === "lane-only") await api(page, "put", `/applications/${id}`, { laneId: referral.id });
				else {
					await api(page, "put", `/applications/${id}`, { status: "screening" });
					await api(page, "put", `/applications/${id}`, { status: "applied" });
				}
				const outsideRow = await stored(id);
				expect(outsideRow.status).toBe("applied");
				expect(outsideRow.lane_id).toBe(outside === "lane-only" ? referral.id : initialLaneId);
				expect(outsideRow.activity.map((entry: { stage: string }) => entry.stage)).toEqual([
					...(origin === "mark-applied" ? ["saved"] : []),
					"applied",
					...(outside === "ABA" ? ["screening", "applied"] : ["applied"]),
				]);
				await expect.poll(() => bulk.held(), { timeout: 15_000 }).toBe(1);
				const answered = page.waitForResponse((response) => response.url().includes("/applications/bulkUpdate"));
				bulk.release("continue");
				expect((await answered).ok()).toBe(true);
				await history(id, outsideRow);
				expect(await stored(id)).toEqual(outsideRow);
				await expect(changedToast(page)).toBeVisible({ timeout: 15_000 });
				const final = await read(page, id);
				expect({ status: final.status, laneId: final.laneId }).toEqual({
					status: "applied",
					laneId: outsideRow.lane_id,
				});
			});

for (const dated of [true, false])
	test(`R2 bulk move after a message's change is answered, list reload still on its way (${dated ? "added Applied today" : "undated"}) is saved`, async ({
		authPage: page,
	}) => {
		expect(process.env.FLAG_ALLOW_UNSAFE_AI_BASE_URL).toBe("true");
		test.setTimeout(60_000);
		const provider = await api<{ id: string }>(page, "post", "/ai-providers", {
			label: "Stub",
			provider: "openai-compatible",
			model: "stub",
			baseURL: stub.baseURL,
			apiKey: "stub-key",
		});
		await api(page, "post", `/ai-providers/${provider.id}/test`);
		const company = dated ? "Cedar Co" : "Dogwood Co";
		const id = await api<string>(page, "post", "/applications", {
			company,
			role: "Ops probe",
			status: "applied",
			...(dated ? { stageEnteredAt: today } : {}),
		});
		await page.goto("/dashboard/applications");
		await page.getByText("Ops probe", { exact: true }).click();
		await page.getByRole("button", { name: "Open workspace" }).click();
		await page.getByRole("tab", { name: /Messages/ }).click();
		await page.getByLabel(`Paste a message from ${company}`).fill("We'd like to invite you to an interview next week.");
		await page.getByRole("button", { name: "Read it for me" }).click();
		const answered = page.waitForResponse((response) => response.url().includes("/career/applyReply"));
		await page.getByRole("button", { name: "Apply 1 change" }).click({ timeout: 30_000 });
		// The Undo window closes and the change is saved.
		expect((await answered).ok()).toBe(true);
		// Back on the list before its reload lands (slow network): the list still shows Applied.
		const list = await holdCarrying(page, "listSummary");
		await bulkMove(page, company, "Offer");
		// The list on screen is the cached one: its reload is held.
		await expect.poll(() => list.held(), { timeout: 15_000 }).toBeGreaterThan(0);
		await expect.poll(async () => (await read(page, id)).status, { timeout: 15_000 }).not.toBe("applied");
		try {
			await expect.poll(async () => (await read(page, id)).status, { timeout: 15_000 }).toBe("offer");
		} finally {
			await history(id, { status: "offer", history: ["applied", "interview", "offer"] });
		}
		expect((await stored(id)).activity.map((entry: { stage: string }) => entry.stage)).toEqual([
			"applied",
			"interview",
			"offer",
		]);
		await expect(changedToast(page)).toHaveCount(0);
		list.release();
	});

for (const action of ["reply", "submission"] as const)
	test(`R3 repeated ${action} cannot acknowledge an outside move before bulk`, async ({ authPage: page }) => {
		test.setTimeout(60_000);
		const company = "Hazel Co";
		const role = "Repeat lead";
		const id = await api<string>(page, "post", "/applications", {
			company,
			role,
			status: action === "reply" ? "applied" : "saved",
		});
		const pipeline = await api<{ revision: number }>(page, "get", "/applications/lanes");
		const lanes = await api<{ lanes: { id: string; label: string | null }[] }>(page, "post", "/applications/lanes", {
			expectedRevision: pipeline.revision,
			label: "Referral",
			category: "applied",
			color: "#123456",
		});
		const referral = lanes.lanes.find((lane) => lane.label === "Referral");
		if (!referral) throw new Error("Expected referral lane");
		if (action === "reply") {
			const provider = await api<{ id: string }>(page, "post", "/ai-providers", {
				label: "Stub",
				provider: "openai-compatible",
				model: "stub",
				baseURL: stub.baseURL,
				apiKey: "stub-key",
			});
			await api(page, "post", `/ai-providers/${provider.id}/test`);
		}
		await page.goto("/dashboard/applications");
		await page.getByText(role, { exact: true }).click();
		await page.getByRole("button", { name: "Open workspace" }).click();
		if (action === "reply") {
			await page.getByRole("tab", { name: /Messages/ }).click();
			await page
				.getByLabel(`Paste a message from ${company}`)
				.fill("We'd like to invite you to an interview next week.");
			await page.getByRole("button", { name: "Read it for me" }).click();
			await expect(page.getByRole("button", { name: "Apply 1 change" })).toBeVisible();
			const items = await api<{ id: string }[]>(page, "get", `/career/saved?applicationId=${id}&kind=reply`);
			const reply = items[0];
			if (!reply) throw new Error("Expected saved reply");
			await api(page, "post", `/career/saved/${reply.id}/apply`, { changes: [0] });
			await api(page, "put", `/applications/${id}`, { status: "offer" });
		} else {
			await api(page, "post", `/career/workspace/${id}/submit`, { answers: [], expectedAnswers: [] });
			await api(page, "put", `/applications/${id}`, { laneId: referral.id });
		}
		const outside = await stored(id);
		expect(outside.status).toBe(action === "reply" ? "offer" : "applied");
		if (action === "submission") expect(outside.lane_id).toBe(referral.id);
		expect(outside.activity.map((entry: { stage: string }) => entry.stage)).toEqual(
			action === "reply" ? ["applied", "interview", "offer"] : ["saved", "applied", "applied"],
		);
		const list = await holdCarrying(page, "listSummary");
		const answered = page.waitForResponse((response) =>
			response.url().includes(action === "reply" ? "/career/applyReply" : "/career/submitApplication"),
		);
		await page
			.getByRole("button", { name: action === "reply" ? "Apply 1 change" : "Mark as applied", exact: true })
			.click();
		expect((await answered).ok()).toBe(true);
		const bulk = page.waitForResponse((response) => response.url().includes("/applications/bulkUpdate"));
		await bulkMove(page, company, "Interview");
		expect((await bulk).ok()).toBe(true);
		await history(id, outside);
		expect(await stored(id)).toEqual(outside);
		await expect(changedToast(page)).toBeVisible();
		list.release();
	});
