import type { APIRequestContext } from "@playwright/test";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { applicationTimelineEntrySchema } from "@reactive-resume/schema/applications/data";
import { getNextStep } from "@reactive-resume/schema/applications/next-step";
import { createAuthenticatedContext } from "../fixtures/auth";
import { createAccount } from "../fixtures/data";
import { deleteE2EUser } from "../fixtures/db";
import { failRpcProcedure } from "../fixtures/rpc-failure";
import { expect, test } from "../fixtures/test";

type Application = {
	replyVersion: string;
	id: string;
	status: ApplicationStatus;
	laneId: string | null;
	appliedAt: string;
	activity: unknown[];
	followUpAt: string | null;
	followUpNote: string | null;
	followUpDateOnly?: boolean;
	updatedAt: string;
};
const read = async (request: APIRequestContext, id: string): Promise<Application> => {
	const response = await request.get(`/api/openapi/applications/${id}`);
	await expect(response).toBeOK();
	return response.json();
};
const step = (row: Application) =>
	getNextStep({ ...row, activity: row.activity.map((entry) => applicationTimelineEntrySchema.parse(entry)) });
const version = (row: Application) => row.replyVersion;
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

for (const change of ["company", "role", "reply"] as const) {
	test(`reply snapshot refuses same-millisecond ${change} changes and replay without a follow-up`, async ({
		authPage: page,
	}) => {
		const id = await create(page.request);
		const before = await read(page.request, id);
		const sql = await database();
		try {
			if (change === "reply") {
				await expect(
					await page.request.post(`/api/openapi/applications/${id}/replies`, {
						data: { expectedVersion: version(before) },
					}),
				).toBeOK();
				await sql.query("update application set updated_at=$1 where id=$2", [before.updatedAt, id]);
			} else {
				await sql.query(`update application set ${change}=$1,updated_at=$2 where id=$3`, [
					`Changed ${change}`,
					before.updatedAt,
					id,
				]);
			}
			const current = await read(page.request, id);
			expect(
				(
					await page.request.post(`/api/openapi/applications/${id}/replies`, {
						data: { expectedVersion: version(before) },
					})
				).status(),
			).toBe(409);
			expect(await read(page.request, id)).toEqual(current);
		} finally {
			await sql.end();
		}
	});
}

test("reply placeholders keep normal Copy independent; explicit log persists contact and clears only the reviewed follow-up", async ({
	authPage: page,
}, info) => {
	await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
	await page.setViewportSize({ width: 1280, height: 1000 });
	const id = await create(page.request, {
		followUpAt: "2030-03-15T09:00:00Z",
		followUpNote: "Reply with availability",
		followUpDateOnly: true,
	});
	const sql = await database();
	try {
		const text = "Thank you for the invitation. I am available [Datum und Uhrzeit 1] or [slot 2].";
		await sql.query(
			`insert into career_artifact (id,user_id,application_id,title,data,evidence,input_version)
			 select $1,user_id,id,'Availability reply',$2::jsonb,'{"factIds":[],"storyIds":[]}'::jsonb,'fictional-review'
			 from application where id=$3`,
			[
				randomUUID(),
				JSON.stringify({
					kind: "reply",
					title: "Reply to the invitation",
					message: "When are you available?",
					asks: ["Share your availability"],
					unconfirmed: [],
					reply: text,
					changes: [],
					offer: null,
					applied: null,
				}),
				id,
			],
		);
		const before = await read(page.request, id);
		await sql.query(
			`insert into career_schedule (id,user_id,application_id,kind,next_run_at,enabled)
			 select $1,user_id,id,'prepare','2030-03-16T09:00:00Z',true from application where id=$2`,
			[randomUUID(), id],
		);
		const schedules = (await sql.query("select * from career_schedule where application_id=$1", [id])).rows;
		expect(schedules).toHaveLength(2);
		await page.goto(`/dashboard/applications/${id}/messages`);
		const editor = page.getByRole("textbox", { name: "Suggested reply · edit before sending" });
		await expect(editor).toHaveValue(text);
		await expect(page.locator("mark")).toHaveText(["[Datum und Uhrzeit 1]", "[slot 2]"]);
		await page.getByRole("button", { name: "Copy reply", exact: true }).click();
		await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);
		expect((await read(page.request, id)).activity).toEqual(before.activity);
		await page.screenshot({ path: info.outputPath("messages-reply-review.png"), animations: "disabled" });
		await editor.fill("Thank you for the invitation. I am available Tuesday at 14:00 Berlin time.");
		await expect(page.locator("mark")).toHaveCount(0);
		await page.getByRole("button", { name: "Copy and log as replied", exact: true }).click();
		await expect.poll(async () => (await read(page.request, id)).followUpAt).toBeNull();
		const after = await read(page.request, id);
		expect(after).toMatchObject({
			followUpAt: null,
			followUpNote: null,
			followUpDateOnly: false,
			status: before.status,
			laneId: before.laneId,
			appliedAt: before.appliedAt,
		});
		expect(after.activity).toHaveLength(before.activity.length + 1);
		expect(after.activity).toContainEqual(
			expect.objectContaining({
				type: "note",
				text: "Replied",
				followedUp: { stageEntryId: applicationTimelineEntrySchema.parse(before.activity[0]).id, kind: "reply" },
			}),
		);
		expect(step(after).kind).toBe("waiting");
		expect((await sql.query("select * from career_schedule where application_id=$1", [id])).rows).toEqual(
			schedules.filter((schedule) => schedule.kind !== "follow-up"),
		);
		const stored = (await sql.query("select activity,follow_up_at,follow_up_note from application where id=$1", [id]))
			.rows[0];
		expect(stored.follow_up_at).toBeNull();
		expect(stored.activity).toHaveLength(after.activity.length);
		expect(stored.activity).toEqual(expect.arrayContaining(after.activity));
		await page.reload();
		await expect(editor).toHaveValue("Thank you for the invitation. I am available Tuesday at 14:00 Berlin time.");
		expect((await read(page.request, id)).activity).toEqual(after.activity);
	} finally {
		await sql.end();
	}
});

test("canonical contact kind survives renamed notes across HTTP, reload and timeline", async ({ authPage: page }) => {
	const id = await create(page.request);
	const before = await read(page.request, id);
	const result = await page.request.post(`/api/openapi/applications/${id}/replies`, {
		data: { expectedVersion: version(before) },
	});
	await expect(result).toBeOK();
	const logged = (await result.json()) as Application;
	expect(logged.replyVersion).toBe((await read(page.request, id)).replyVersion);
	const reply = logged.activity
		.map((entry) => applicationTimelineEntrySchema.parse(entry))
		.find((entry) => entry.type === "note" && entry.followedUp?.kind === "reply");
	if (!reply) throw new Error("Missing reply event");
	await expect(
		await page.request.put(`/api/openapi/applications/${id}/timeline/${reply.id}`, {
			data: { text: "Custom contact note" },
		}),
	).toBeOK();
	await expect(await page.request.post(`/api/openapi/applications/${id}/follow-ups`)).toBeOK();
	const follow = (await read(page.request, id)).activity
		.map((entry) => applicationTimelineEntrySchema.parse(entry))
		.find((entry) => entry.type === "note" && entry.followedUp && !entry.followedUp.kind);
	if (!follow) throw new Error("Missing follow-up event");
	await expect(
		await page.request.put(`/api/openapi/applications/${id}/timeline/${follow.id}`, { data: { text: "Replied" } }),
	).toBeOK();
	await page.goto(`/dashboard/applications/${id}`);
	await page.getByRole("link", { name: "Stage, details and timeline" }).click();
	await expect(page.getByText("Replied · Custom contact note", { exact: true })).toBeVisible();
	await expect(page.getByText("Followed up · Replied", { exact: true })).toBeVisible();
	await page.reload();
	await page.getByText("Fictional Harbor Labs", { exact: true }).click();
	await expect(page.getByText("Replied · Custom contact note", { exact: true })).toBeVisible();
	await expect(page.getByText("Followed up · Replied", { exact: true })).toBeVisible();
});

test("reply log refuses foreign, trashed and stale applications without erasing a newer follow-up", async ({
	authPage: page,
	browser,
	playwright,
	baseURL,
}, info) => {
	const id = await create(page.request, { followUpNote: "Original follow-up" });
	const before = await read(page.request, id);
	await expect(
		await page.request.put(`/api/openapi/applications/${id}`, { data: { followUpNote: "Newer follow-up" } }),
	).toBeOK();
	const sql = await database();
	try {
		// A timestamp collision must not allow a stale action to erase changed follow-up fields.
		await sql.query("update application set updated_at=$1 where id=$2", [before.updatedAt, id]);
	} finally {
		await sql.end();
	}
	const current = await read(page.request, id);
	const stale = await page.request.post(`/api/openapi/applications/${id}/replies`, {
		data: { expectedVersion: version(before) },
	});
	expect(stale.status()).toBe(409);
	expect(await read(page.request, id)).toEqual(current);
	const other = createAccount(info);
	if (!baseURL) throw new Error("Browser test base URL required");
	const request = await playwright.request.newContext({ baseURL });
	const anonymous = await playwright.request.newContext({ baseURL });
	const context = await createAuthenticatedContext(browser, request, other, baseURL);
	try {
		expect(
			(
				await context.request.post(`/api/openapi/applications/${id}/replies`, {
					data: { expectedVersion: version(current) },
				})
			).status(),
		).toBe(404);
		expect(
			(
				await anonymous.post(`/api/openapi/applications/${id}/replies`, {
					data: { expectedVersion: version(current) },
				})
			).status(),
		).toBe(401);
		for (const status of ["saved", "closed"]) {
			const inactive = await create(page.request, { status });
			expect(
				(
					await page.request.post(`/api/openapi/applications/${inactive}/replies`, {
						data: { expectedVersion: version(await read(page.request, inactive)) },
					})
				).status(),
			).toBe(400);
		}
		await expect(await page.request.post(`/api/openapi/applications/${id}/trash`)).toBeOK();
		expect(
			(
				await page.request.post(`/api/openapi/applications/${id}/replies`, {
					data: { expectedVersion: version(current) },
				})
			).status(),
		).toBe(404);
	} finally {
		await context.close();
		await request.dispose();
		await anonymous.dispose();
		await deleteE2EUser(other);
	}
});

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
	await expect(
		await page.request.put(`/api/openapi/applications/${id}`, {
			data: { status: "applied", stageEnteredAt: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10) },
		}),
	).toBeOK();
	await expect(await page.request.post(`/api/openapi/applications/${id}/follow-ups`)).toBeOK();
	const revisited = await read(page.request, id);
	const reentryContact = revisited.activity
		.map((entry) => applicationTimelineEntrySchema.parse(entry))
		.find(
			(entry) =>
				entry.type === "note" &&
				entry.followedUp &&
				entry.followedUp.stageEntryId !== screen.id &&
				entry.followedUp.stageEntryId !== contact.followedUp?.stageEntryId,
		);
	if (!reentryContact) throw new Error("Missing re-entry contact");
	await expect(
		await page.request.put(`/api/openapi/applications/${id}/timeline/${reentryContact.id}`, {
			data: { date: new Date(reentryContact.at.getTime() - 20 * 86_400_000).toISOString().slice(0, 10) },
		}),
	).toBeOK();
	const corrected = await read(page.request, id);
	expect(step(corrected)).toEqual({ kind: "no-reply", days: 20 });
	expect(corrected.appliedAt).toBe(revisited.appliedAt);
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
