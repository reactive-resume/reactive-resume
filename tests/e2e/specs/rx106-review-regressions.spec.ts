import type { Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { expect, test } from "../fixtures/test";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
test.afterAll(async () => {
	await pool.end();
});
const at = "2030-01-03T00:00:00.000Z";
async function create(page: Page, company: string, data: Record<string, unknown> = {}) {
	const r = await page.request.post("/api/openapi/applications", {
		data: { company, role: "Review Engineer", status: "applied", ...data },
	});
	expect(r.ok(), await r.text()).toBe(true);
	return (await r.json()) as string;
}
async function get(page: Page, id: string) {
	const r = await page.request.get(`/api/openapi/applications/${id}`);
	expect(r.ok()).toBe(true);
	return await r.json();
}
async function schedules(page: Page) {
	return await (await page.request.get("/api/openapi/career/schedules")).json();
}
test("HTTP unchanged old-client echo preserves exact midnight", async ({ authPage: page }, info) => {
	const id = await create(page, "Review exact midnight");
	await pool.query('UPDATE "user" SET timezone=$1 WHERE id=(SELECT user_id FROM application WHERE id=$2)', [
		"Pacific/Honolulu",
		id,
	]);
	expect(
		(
			await page.request.patch(`/api/openapi/applications/${id}`, {
				data: { followUpAt: at, followUpDateOnly: false, followUpNote: "Original" },
			})
		).ok(),
	).toBe(true);
	expect((await get(page, id)).followUpDateOnly).toBe(false);
	const before = await schedules(page);
	expect(
		(
			await page.request.patch(`/api/openapi/applications/${id}`, {
				data: { followUpAt: at, followUpNote: "Old-client echo" },
			})
		).ok(),
	).toBe(true);
	const after = await get(page, id);
	const rows = await schedules(page);
	await info.attach("midnight-readback", {
		body: JSON.stringify({ before, after, rows }, null, 2),
		contentType: "application/json",
	});
	expect.soft(after.followUpDateOnly).toBe(false);
	expect.soft(rows[0].nextRunAt).toBe(at);
});
test("HTTP note-only edit preserves one notification and completed job", async ({ authPage: page }, info) => {
	const id = await create(page, "Review delivered note");
	const due = new Date(Date.now() - 60000).toISOString();
	expect(
		(
			await page.request.post("/api/openapi/career/schedules", {
				data: { kind: "follow-up", applicationId: id, nextRunAt: due, timezone: "UTC", query: "Original note" },
			})
		).ok(),
	).toBe(true);
	const tick = async () => {
		const r = await page.request.post("/api/career/run", {
			headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
		});
		expect(r.ok(), await r.text()).toBe(true);
	};
	const notices = async () => await (await page.request.get("/api/openapi/career/notifications")).json();
	await tick();
	expect(await notices()).toHaveLength(1);
	const beforeJobs = (
		await pool.query("SELECT * FROM career_job WHERE user_id=(SELECT user_id FROM application WHERE id=$1)", [id])
	).rows;
	await page.request.patch(`/api/openapi/applications/${id}`, { data: { followUpNote: "Original note" } });
	await tick();
	expect(await notices()).toHaveLength(1);
	await page.request.patch(`/api/openapi/applications/${id}`, { data: { followUpNote: "Corrected note" } });
	const [current] = await schedules(page);
	await page.goto(`/dashboard/career?schedule=${current.id}`);
	await page.getByLabel("Follow-up note", { exact: true }).fill("Today note edit");
	await page.getByRole("button", { name: "Save schedule", exact: true }).click();
	await expect.poll(async () => (await get(page, id)).followUpNote).toBe("Today note edit");
	expect((await get(page, id)).followUpAt).toBe(due);

	await tick();
	const afterNotices = await notices();
	const afterJobs = (
		await pool.query("SELECT * FROM career_job WHERE user_id=(SELECT user_id FROM application WHERE id=$1)", [id])
	).rows;
	await info.attach("redelivery-readback", {
		body: JSON.stringify({ beforeJobs, afterJobs, afterNotices }, null, 2),
		contentType: "application/json",
	});
	expect.soft(afterNotices).toHaveLength(1);
	expect.soft(afterJobs).toEqual(beforeJobs);
});
test("HTTP user-lock barrier serializes application and schedule writers; nonowner rolls back", async ({
	authPage: page,
	browser,
}, info) => {
	const id = await create(page, "Review barrier");
	const owner = (await pool.query("SELECT user_id FROM application WHERE id=$1", [id])).rows[0].user_id;
	const connection = await pool.connect();
	let released = false;
	try {
		await connection.query("BEGIN");
		await connection.query('SELECT id FROM "user" WHERE id=$1 FOR NO KEY UPDATE', [owner]);
		const first = page.request.patch(`/api/openapi/applications/${id}`, {
			data: { followUpAt: "2030-01-04T10:15:37.123Z", followUpDateOnly: false, followUpNote: "Application writer" },
		});
		const second = page.request.post("/api/openapi/career/schedules", {
			data: {
				kind: "follow-up",
				applicationId: id,
				nextRunAt: "2030-01-05T12:15:42.456Z",
				timezone: "Europe/Berlin",
				query: "Schedule writer",
			},
		});
		await expect
			.poll(
				async () =>
					Number(
						(
							await pool.query(
								"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%user%' ",
							)
						).rows[0].count,
					),
				{ timeout: 10000 },
			)
			.toBeGreaterThanOrEqual(2);
		await connection.query("COMMIT");
		released = true;
		expect((await first).ok()).toBe(true);
		expect((await second).ok()).toBe(true);
		const app = await get(page, id);
		const rows = await schedules(page);
		expect(rows).toHaveLength(1);
		expect(rows[0].nextRunAt).toBe(app.followUpAt);
		expect(rows[0].query).toBe(app.followUpNote);
		const foreign = await browser.newContext({ baseURL: process.env.APP_URL });
		try {
			const email = `rx106-foreign-${Date.now()}@example.test`;
			const signup = await foreign.request.post("/api/auth/sign-up/email", {
				headers: { origin: process.env.APP_URL ?? "" },
				data: {
					name: "Review Foreign",
					email,
					password: "Review-Password-106!",
					username: `rx106f${Date.now()}`,
					displayUsername: `rx106f${Date.now()}`,
				},
			});
			expect(signup.ok(), await signup.text()).toBe(true);
			const attempt = await foreign.request.post("/api/openapi/career/schedules", {
				data: {
					id: rows[0].id,
					kind: "follow-up",
					applicationId: id,
					nextRunAt: at,
					timezone: "UTC",
					query: "Foreign overwrite",
				},
			});
			expect(attempt.status()).toBe(404);
			expect(await get(page, id)).toEqual(app);
			await pool.query('DELETE FROM "user" WHERE email=$1', [email]);
		} finally {
			await foreign.close();
		}
		await info.attach("barrier-readback", {
			body: JSON.stringify({ app, rows }, null, 2),
			contentType: "application/json",
		});
	} finally {
		if (!released) await connection.query("ROLLBACK");
		connection.release();
	}
});

test("browser legacy date-only workspace uses account clock", async ({ authPage: page }, info) => {
	const id = await create(page, "Review clock");
	await pool.query('UPDATE "user" SET timezone=$1 WHERE id=(SELECT user_id FROM application WHERE id=$2)', [
		"Pacific/Honolulu",
		id,
	]);
	expect(
		(
			await page.request.patch(`/api/openapi/applications/${id}`, {
				data: { followUpAt: at, followUpDateOnly: true, followUpNote: "Review clock note" },
			})
		).ok(),
	).toBe(true);
	await page.goto(`/dashboard/applications/${id}/messages`);
	const section = page
		.locator("section")
		.filter({ has: page.getByText("Next step", { exact: true }) })
		.first();
	await expect(section).toContainText("Review clock note");
	const text = await section.innerText();
	const rows = await schedules(page);
	await info.attach("clock-readback", {
		body: JSON.stringify({ text, rows }, null, 2),
		contentType: "application/json",
	});
	await page.screenshot({ path: info.outputPath("workspace-clock.png") });
	expect(text).toContain("Jan 3");
});

test("browser cold Compare offers cannot discard contextual application", async ({ authPage: page }, info) => {
	const first = await create(page, "Review selected application", { status: "offer" });
	const a = await (
		await page.request.post("/api/openapi/career/offers", {
			data: { applicationId: first, version: "written", base: 100000, variable: null, currency: "EUR", period: "year" },
		})
	).json();
	expect(a.id).toBeTruthy();
	const second = await create(page, "Review other application", { status: "offer" });
	await page.request.post("/api/openapi/career/offers", {
		data: { applicationId: second, version: "written", base: 90000, variable: null, currency: "EUR", period: "year" },
	});
	const connection = await pool.connect();
	await connection.query("BEGIN");
	await connection.query("LOCK TABLE career_artifact IN ACCESS EXCLUSIVE MODE");
	try {
		await page.goto(`/dashboard/applications/${first}/messages`);
		await expect
			.poll(async () =>
				Number(
					(
						await pool.query(
							"SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%career_artifact%' ",
						)
					).rows[0].count,
				),
			)
			.toBeGreaterThan(0);
		await expect(page.getByRole("button", { name: "Compare offers" })).toBeDisabled();
		await expect(page.getByRole("link", { name: "Compare offers" })).toHaveCount(0);
		await info.attach("cold-context-gate", {
			body: JSON.stringify({ first, a, disabled: true }),
			contentType: "application/json",
		});
	} finally {
		await connection.query("ROLLBACK");
		connection.release();
	}
	await page.getByRole("link", { name: "Compare offers" }).click();
	await expect(page).toHaveURL(new RegExp(`a=${a.id}`));
});
test("date-only delivery index and ICS agree after account timezone changes", async ({ authPage: page }, info) => {
	const id = await create(page, "Review timezone change");
	await pool.query('UPDATE "user" SET timezone=$1 WHERE id=(SELECT user_id FROM application WHERE id=$2)', [
		"Asia/Tokyo",
		id,
	]);
	expect(
		(
			await page.request.patch(`/api/openapi/applications/${id}`, {
				data: { followUpAt: at, followUpDateOnly: true, followUpNote: "Timezone note" },
			})
		).ok(),
	).toBe(true);
	const [originalClock] = await schedules(page);
	await pool.query('UPDATE "user" SET timezone=$1 WHERE id=(SELECT user_id FROM application WHERE id=$2)', [
		"Pacific/Honolulu",
		id,
	]);
	await page.goto("/dashboard/applications");
	await page.getByText("Review timezone change", { exact: true }).click();
	const downloaded = page.waitForEvent("download");
	await page.getByRole("button", { name: "Add to calendar", exact: true }).click();
	const download = await downloaded;
	const stream = await download.createReadStream();
	if (!stream) throw new Error("Calendar download stream unavailable");
	const chunks = [];
	for await (const chunk of stream) chunks.push(chunk);
	const ics = Buffer.concat(chunks).toString();
	const rows = await schedules(page);
	await info.attach("timezone-ics-readback", {
		body: JSON.stringify({ ics, rows }, null, 2),
		contentType: "application/json",
	});
	expect(rows).toMatchObject([{ timezone: "Pacific/Honolulu", nextRunAt: "2030-01-03T19:00:00.000Z" }]);
	expect(ics).toContain("DTSTART:20300103T190000Z");
	expect((await page.request.patch("/api/openapi/auth/profile", { data: { timezone: "Asia/Tokyo" } })).ok()).toBe(true);
	expect(await schedules(page)).toMatchObject([{ timezone: "Asia/Tokyo", nextRunAt: at }]);
	expect(
		(
			await page.request.post("/api/auth/update-user", {
				headers: { origin: process.env.APP_URL ?? "" },
				data: { timezone: "Pacific/Honolulu" },
			})
		).ok(),
	).toBe(true);
	expect(await schedules(page)).toMatchObject([
		{ timezone: "Pacific/Honolulu", nextRunAt: "2030-01-03T19:00:00.000Z" },
	]);
	expect(
		(
			await page.request.post("/api/openapi/career/schedules", {
				data: {
					id: originalClock.id,
					kind: "follow-up",
					applicationId: id,
					nextRunAt: originalClock.nextRunAt,
					timezone: originalClock.timezone,
					query: "Today logical note edit",
				},
			})
		).ok(),
	).toBe(true);
	expect(await get(page, id)).toMatchObject({
		followUpAt: at,
		followUpDateOnly: true,
		followUpNote: "Today logical note edit",
	});
});

test("large Notes retain recovery after transport failure and need explicit replay", async ({
	authPage: page,
}, info) => {
	const id = await create(page, "Review large recovery", { notes: "Server original" });
	await page.goto(`/dashboard/applications/${id}/messages`);
	const notes = page.getByLabel("Notes", { exact: true });
	const large = "Large durable notes. ".repeat(3500);
	expect(Buffer.byteLength(large)).toBeGreaterThan(60 * 1024);
	let blocked = 0;
	await page.route("**/api/rpc/applications/update**", async (route) => {
		blocked++;
		await route.abort("failed");
	});
	await notes.fill(large);
	await notes.blur();
	await expect.poll(() => blocked).toBeGreaterThan(0);
	expect((await get(page, id)).notes).toBe("Server original");
	const context = page.context();
	await page.close();
	const reopened = await context.newPage();
	await reopened.goto(`/dashboard/applications/${id}/messages`);
	await expect(reopened.getByLabel("Notes", { exact: true })).toHaveValue(large);
	await expect(reopened.getByRole("button", { name: "Save recovered draft" })).toBeVisible();
	expect((await get(reopened, id)).notes).toBe("Server original");
	await reopened.getByRole("button", { name: "Save recovered draft" }).click();
	await expect.poll(async () => (await get(reopened, id)).notes).toBe(large);
	await info.attach("large-recovery-readback", {
		body: JSON.stringify({
			bytes: Buffer.byteLength(large),
			blocked,
			serverLength: (await get(reopened, id)).notes.length,
		}),
		contentType: "application/json",
	});
});
test("denied draft storage reports unavailable recovery and still saves", async ({ authPage: page }, info) => {
	const id = await create(page, "Review storage denied");
	await page.addInitScript(() => {
		const original = Storage.prototype.setItem;
		Storage.prototype.setItem = function (key, value) {
			if (key.startsWith("career-draft:")) throw new DOMException("Review storage denied", "QuotaExceededError");
			return original.call(this, key, value);
		};
	});
	await page.goto(`/dashboard/applications/${id}/messages`);
	const notes = page.getByLabel("Notes", { exact: true });
	await notes.fill("Save despite denied recovery");
	await expect(
		page.getByText("This browser could not keep a recovery copy. Wait for saving to finish before leaving."),
	).toBeVisible();
	await expect.poll(async () => (await get(page, id)).notes).toBe("Save despite denied recovery");
	await info.attach("denied-storage-readback", {
		body: JSON.stringify(await get(page, id)),
		contentType: "application/json",
	});
});

test("valid photo transport failure cannot replace saved picture", async ({ authPage: page }, info) => {
	const created = await page.request.post("/api/openapi/resumes", { data: { name: "Review photo owner", tags: [] } });
	expect(created.ok()).toBe(true);
	const id = await created.json();
	const resume = await (await page.request.get(`/api/openapi/resumes/${id}`)).json();
	const original = "https://example.test/prior-photo.png";
	resume.data.picture.url = original;
	resume.data.picture.fit = "contain";
	expect((await page.request.put(`/api/openapi/resumes/${id}`, { data: { data: resume.data } })).ok()).toBe(true);
	await page.goto(`/builder/${id}`);
	await page.getByRole("button", { name: "Edit", exact: true }).first().click();
	let attempted = false;
	await page.route("**/api/rpc/storage/uploadFile**", async (route) => {
		attempted = true;
		await route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({ message: "Synthetic upload failure" }),
		});
	});
	const png = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
		"base64",
	);
	await page
		.locator('input[type="file"][accept*="image"]')
		.first()
		.setInputFiles({ name: "valid.png", mimeType: "image/png", buffer: png });
	await expect(
		page.getByText(
			"Couldn't upload the photo. Choose a readable PNG, JPEG, WebP or GIF photo up to 10 MB, then try again.",
		),
	).toBeVisible();
	expect(attempted).toBe(true);
	const saved = await (await page.request.get(`/api/openapi/resumes/${id}`)).json();
	expect(saved.data.picture.url).toBe(original);
	await info.attach("photo-upload-failure-readback", {
		body: JSON.stringify({ attempted, picture: saved.data.picture }),
		contentType: "application/json",
	});
});

test("exact 10 MiB PDF accepted and cap-plus-one rejected before transport", async ({ authPage: page }, info) => {
	const id = await create(page, "Review attachment boundary");
	await page.goto(`/dashboard/applications/${id}/apply`);
	await page.getByRole("button", { name: "Attach a file instead", exact: true }).click();
	const seed = await readFile("apps/web/public/templates/pdf/azurill.pdf");
	expect(seed.length).toBeLessThan(10 * 1024 * 1024);
	const pdf = Buffer.concat([seed, Buffer.alloc(10 * 1024 * 1024 - seed.length, 32)]);
	const input = page.locator('input[type="file"][accept="application/pdf"]').first();
	let uploads = 0;
	page.on("request", (request) => {
		if (request.url().includes("attachDocument")) uploads++;
	});
	await input.setInputFiles({
		name: "plus-one.pdf",
		mimeType: "application/pdf",
		buffer: Buffer.concat([pdf, Buffer.from(" ")]),
	});
	await expect(
		page.getByText("This PDF is larger than 10 MB. Compress it or export a smaller PDF, then attach it again."),
	).toBeVisible();
	expect(uploads).toBe(0);
	await input.setInputFiles({ name: "exact-cap.pdf", mimeType: "application/pdf", buffer: pdf });
	await expect.poll(async () => (await get(page, id)).resumeFileUrl).not.toBeNull();
	const saved = await get(page, id);
	expect(saved.resumeFileName).toBe("exact-cap.pdf");
	await info.attach("attachment-cap-readback", {
		body: JSON.stringify({ bytes: pdf.length, uploads, saved }),
		contentType: "application/json",
	});
});
