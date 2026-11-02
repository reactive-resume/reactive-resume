import type { APIRequestContext } from "@playwright/test";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { Client } from "pg";
import { applicationTimelineEntrySchema } from "@reactive-resume/schema/applications/data";
import { getNextStep } from "@reactive-resume/schema/applications/next-step";
import { createAuthenticatedContext } from "../fixtures/auth";
import { createAccount } from "../fixtures/data";
import { deleteE2EUser } from "../fixtures/db";
import { failRpcProcedure } from "../fixtures/rpc-failure";
import { expect, test } from "../fixtures/test";

type Application = {
	id: string;
	status: ApplicationStatus;
	laneId: string | null;
	appliedAt: string;
	activity: unknown[];
	followUpAt: string | null;
	followUpNote: string | null;
};
const read = async (request: APIRequestContext, id: string): Promise<Application> => {
	const response = await request.get(`/api/openapi/applications/${id}`);
	await expect(response).toBeOK();
	return response.json();
};
const step = (row: Application) =>
	getNextStep({ ...row, activity: row.activity.map((entry) => applicationTimelineEntrySchema.parse(entry)) });
const create = async (request: APIRequestContext, data: Record<string, unknown> = {}) => {
	const response = await request.post("/api/openapi/applications", {
		data: {
			company: "Fictional Harbor Labs",
			role: "Product engineer",
			status: "applied",
			stageEnteredAt: new Date(Date.now() - 16 * 86_400_000).toISOString().slice(0, 10),
			...data,
		},
	});
	await expect(response).toBeOK();
	return response.json() as Promise<string>;
};
const database = async () => {
	const client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	return client;
};

test("Followed up persists contact, refreshes attention summaries and survives reload", async ({
	authPage: page,
}, info) => {
	await page.setViewportSize({ width: 1280, height: 1000 });
	const id = await create(page.request);
	const before = await read(page.request, id);
	expect(step(before).kind).toBe("no-reply");
	await page.goto("/dashboard/applications?needsYou=true");
	await page.getByText("Fictional Harbor Labs", { exact: true }).click();
	const action = page.getByRole("button", { name: "Followed up", exact: true });
	await action.click();
	await expect.poll(async () => step(await read(page.request, id)).kind).toBe("waiting");
	const after = await read(page.request, id);
	const contact = after.activity
		.map((entry) => applicationTimelineEntrySchema.parse(entry))
		.find((entry) => entry.type === "note" && entry.followedUp);
	if (!contact || contact.type !== "note") throw new Error("Missing structured contact");
	expect(contact.followedUp?.stageEntryId).toBe(applicationTimelineEntrySchema.parse(before.activity[0]).id);
	expect(Math.abs(contact.at.getTime() - Date.now())).toBeLessThan(30_000);
	expect(after).toMatchObject({ status: before.status, laneId: before.laneId, appliedAt: before.appliedAt });
	await page.reload();
	await expect(page.getByText("Fictional Harbor Labs", { exact: true })).toHaveCount(0);
	await page.getByRole("button", { name: "Clear filters", exact: true }).click();
	await page.getByText("Fictional Harbor Labs", { exact: true }).click();
	await expect(action).toBeVisible();
	await expect(page.getByRole("listitem").filter({ hasText: "Followed up" })).toBeVisible();
	await page
		.getByRole("dialog")
		.last()
		.screenshot({ path: info.outputPath("followed-up.png"), animations: "disabled" });
	const summaries = (await (await page.request.get("/api/openapi/applications/summary")).json()) as Application[];
	const summary = summaries.find((row) => row.id === id);
	if (!summary) throw new Error("Missing summary");
	expect(step(summary).kind).toBe("waiting");
	const sql = await database();
	try {
		const stored = (
			await sql.query("select status, lane_id, applied_at, activity from application where id = $1", [id])
		).rows[0];
		expect(stored.activity).toHaveLength(after.activity.length);
		expect(stored.activity).toEqual(expect.arrayContaining(after.activity));
		expect(stored.applied_at.toISOString()).toBe(before.appliedAt);
	} finally {
		await sql.end();
	}
	await page.getByRole("dialog").last().getByRole("button", { name: "Close", exact: true }).first().click();
	await page.getByRole("button", { name: "Needs you", exact: true }).click();
	await expect(page.getByText("Fictional Harbor Labs", { exact: true })).toHaveCount(0);
	await expect(
		await page.request.put(`/api/openapi/applications/${id}`, {
			data: { status: "screening", stageEnteredAt: before.appliedAt.slice(0, 10) },
		}),
	).toBeOK();
	const moved = await read(page.request, id);
	expect(step(moved).kind).toBe("no-reply");
	const screen = moved.activity
		.map((entry) => applicationTimelineEntrySchema.parse(entry))
		.find((entry) => entry.type === "stage" && entry.stage === "screening");
	if (!screen) throw new Error("Missing Screening visit");
	await expect(await page.request.post(`/api/openapi/applications/${id}/follow-ups`)).toBeOK();
	const contacted = await read(page.request, id);
	expect(step(contacted).kind).toBe("waiting");
	expect(contacted.activity).toContainEqual(expect.objectContaining({ followedUp: { stageEntryId: screen.id } }));
});

test("legacy contact writes preserve concurrent history, authored reminders and summary privacy", async ({
	authPage: page,
}) => {
	const id = await create(page.request, {
		followUpAt: "2030-03-15T09:00:00Z",
		followUpNote: "Ask about timing",
		followUpDateOnly: false,
	});
	const sql = await database();
	const blocker = await database();
	try {
		// Older records can have a sending date without any canonical stage history.
		await sql.query("update application set activity = '[]'::jsonb where id = $1", [id]);
		const before = await read(page.request, id);
		const schedules = (await sql.query("select * from career_schedule where application_id = $1", [id])).rows;
		expect(schedules).toHaveLength(1);
		await blocker.query("begin");
		await blocker.query("select id from application where id = $1 for update", [id]);
		const { pid } = (await blocker.query("select pg_backend_pid() as pid")).rows[0];
		const writes = Promise.all([
			page.request.post(`/api/openapi/applications/${id}/follow-ups`),
			page.request.post(`/api/openapi/applications/${id}/notes`, { data: { text: "Private concurrent note" } }),
		]);
		await expect
			.poll(async () =>
				Number(
					(await sql.query("select count(*) from pg_stat_activity where $1 = any(pg_blocking_pids(pid))", [pid]))
						.rows[0].count,
				),
			)
			.toBeGreaterThan(0);
		await blocker.query("commit");
		for (const response of await writes) await expect(response).toBeOK();
		const after = await read(page.request, id);
		expect(after.activity).toHaveLength(before.activity.length + 2);
		expect(after).toMatchObject({
			status: before.status,
			laneId: before.laneId,
			appliedAt: before.appliedAt,
			followUpAt: before.followUpAt,
			followUpNote: before.followUpNote,
		});
		expect(step(after)).toMatchObject({ kind: "follow-up", note: "Ask about timing" });
		expect((await sql.query("select * from career_schedule where application_id = $1", [id])).rows).toEqual(schedules);
		const contact = after.activity
			.map((entry) => applicationTimelineEntrySchema.parse(entry))
			.find((entry) => entry.type === "note" && entry.followedUp);
		if (!contact) throw new Error("Missing contact");
		expect(contact).toMatchObject({ followedUp: { stageEntryId: null } });
		await expect(
			await page.request.put(`/api/openapi/applications/${id}/timeline/${contact.id}`, {
				data: { text: "Private correction" },
			}),
		).toBeOK();
		const summaries = (await (await page.request.get("/api/openapi/applications/summary")).json()) as Application[];
		const summary = summaries.find((row) => row.id === id);
		expect(JSON.stringify(summary)).not.toContain("Private");
		expect(summary?.activity).toContainEqual(
			expect.objectContaining({
				id: contact.id,
				text: "Followed up",
				followedUp: contact.type === "note" ? contact.followedUp : undefined,
			}),
		);
		await expect(await page.request.delete(`/api/openapi/applications/${id}/timeline/${contact.id}`)).toBeOK();
		expect(await read(page.request, id)).toMatchObject({ appliedAt: before.appliedAt, followUpAt: before.followUpAt });
	} finally {
		await blocker.query("rollback");
		await blocker.end();
		await sql.end();
	}
});

test("Followed up rejects other accounts, saved/closed jobs and recovers authoritative state after a lost reply", async ({
	authPage: page,
	browser,
	playwright,
	baseURL,
}, info) => {
	const id = await create(page.request);
	const before = await read(page.request, id);
	const other = createAccount(info);
	if (!baseURL) throw new Error("Browser test base URL required");
	const request = await playwright.request.newContext({ baseURL });
	const context = await createAuthenticatedContext(browser, request, other, baseURL);
	try {
		expect((await context.request.post(`/api/openapi/applications/${id}/follow-ups`)).status()).toBe(404);
	} finally {
		await context.close();
		await request.dispose();
		await deleteE2EUser(other);
	}
	const anonymous = await playwright.request.newContext({ baseURL });
	try {
		expect((await anonymous.post(`/api/openapi/applications/${id}/follow-ups`)).status()).toBe(401);
	} finally {
		await anonymous.dispose();
	}
	for (const status of ["saved", "closed"]) {
		const otherId = await create(page.request, { status, role: `${status} job` });
		expect((await page.request.post(`/api/openapi/applications/${otherId}/follow-ups`)).status()).toBe(400);
	}
	expect(await read(page.request, id)).toEqual(before);
	await page.route("**/api/rpc/**", async (route) => {
		await failRpcProcedure(route, "/api/rpc/applications/logFollowUp", "Follow-up unavailable");
	});
	await page.goto("/dashboard/applications");
	await page.getByText("Product engineer", { exact: true }).first().click();
	const action = page.getByRole("button", { name: "Followed up", exact: true });
	await action.click();
	await expect(
		page.getByText("Couldn't log the follow-up. Check the timeline before trying again.", { exact: true }),
	).toBeVisible();
	await expect.poll(async () => step(await read(page.request, id)).kind).toBe("waiting");
	await expect(page.getByRole("listitem").filter({ hasText: "Followed up" })).toBeVisible();
	await page.unroute("**/api/rpc/**");
	const after = await read(page.request, id);
	expect(after.activity).toHaveLength(before.activity.length + 1);
});
