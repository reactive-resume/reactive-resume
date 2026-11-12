#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { request } from "@playwright/test";
import { Pool } from "pg";
import { aiBaseUrl, appUrl, database, env, healthy, now, root, state, timezone } from "./env.mjs";
import { workspaces as seedWorkspaces } from "./workspace.mjs";

// Resets the Calm capture database to the persona of the redesign boards (tests/e2e/fixtures/persona.ts): empties
// every table, seeds alex / empty / noai through the running dev server's API, adds what only the server writes
// (new roles, notifications), sets the dates the boards show, then writes the application workspaces' AI results
// (fit, briefing, practice, debrief, replies) through career.generate against the AI stub, and writes each account's
// signed-in Playwright storage state and the seeded ids to <work>/state/.
//
//   node tooling/calm/dev.mjs start && node tooling/calm/seed.mjs
if (!(await healthy())) {
	console.error("The Calm dev server isn't answering. Start it: node tooling/calm/dev.mjs start");
	process.exit(1);
}
const { seedPersona } = await import(pathToFileURL(resolve(root, "tests/e2e/fixtures/persona.ts")).href);
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
const sql = (text, values) => pool.query(text, values).then((result) => result.rows);

// Only ever a Calm database: the local PostgreSQL also holds the owner's development data.
const [{ name }] = await sql("select current_database() as name");
if (name !== database || !name.startsWith("rr_calm_"))
	throw new Error(`Refusing to reset ${name}; expected ${database}.`);
// Truncating keeps the schema and the server's connections; the migration ledger lives in the `drizzle` schema.
const tables = await sql("select tablename from pg_tables where schemaname = 'public'");
await sql(`truncate ${tables.map((row) => `"${row.tablename}"`).join(", ")} restart identity cascade`);
rmSync(env.LOCAL_STORAGE_PATH, { recursive: true, force: true });
mkdirSync(env.LOCAL_STORAGE_PATH, { recursive: true });

const at = (date, time = "12:00") => `${date}T${time}:00.000Z`;

/** What has no create API: rows only scheduled work and the AI write. Shapes follow career/jobs.ts and generate.ts. */
async function serverOnly(seed) {
	const { userId, applications } = seed;
	const query = "Senior product designer, Lisbon or remote";
	const found = at("2026-11-07", "07:00");
	const roles = [
		[
			"Lead product designer",
			"Tideway",
			"Remote",
			"Lead the design system for a logistics platform, remote across Europe.",
		],
		[
			"Senior product designer",
			"Marlow & Finch",
			"Lisbon · Hybrid",
			"Design onboarding and billing for an accounting product. Salary not listed.",
		],
		["Product designer", "Corvid Labs", "Porto", "Product design for developer tools, with weekly customer research."],
		[
			"Staff product designer",
			"Saltmarsh",
			"Remote",
			"Own interaction design for a scheduling product used by clinics.",
		],
	];
	for (const [index, [role, company, location, snippet]] of roles.entries())
		await sql(
			`insert into career_opportunity (id, user_id, url, role, company, location, snippet, discovery_source, description, first_seen_at, last_seen_at, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10, $10)`,
			[
				randomUUID(),
				userId,
				`https://${company.toLowerCase().replace(/[^a-z]+/g, "")}.example/careers/${role.toLowerCase().replace(/[^a-z]+/g, "-")}`,
				role,
				company,
				location,
				snippet,
				{ query, checkedAt: found },
				`${company} is hiring a ${role.toLowerCase()}. ${snippet}`,
				// Listed in this order whether a reader sorts by newest or takes the rows as stored.
				new Date(Date.parse(found) + (roles.length - index) * 1000),
			],
		);

	// Daily at 07:00. Saving it through the API needs a web search provider, which the boards show as not connected.
	await sql(
		`insert into career_schedule (id, user_id, kind, query, locale, timezone, enabled, next_run_at, interval_days, ai_provider_id, created_at, updated_at)
		 values ($1, $2, 'discovery', $3, 'en-GB', $4, true, $5, 1, $6, $7, $7)`,
		[randomUUID(), userId, query, timezone, at("2026-11-08", "07:00"), seed.aiProviderId, at("2026-10-20", "09:00")],
	);

	const notify = (key, applicationId, notice, url, created, read) =>
		sql(
			`insert into career_notification (id, user_id, application_id, key, notice, url, read_at, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
			[randomUUID(), userId, applicationId, key, notice, url, read, created],
		);
	// Read, so "Needs you" holds what the boards show; the roles themselves wait in New roles either way.
	await notify(
		"calm:roles",
		null,
		{ type: "opportunities", count: roles.length, query },
		"/dashboard/career",
		found,
		found,
	);
	// Fieldnote's follow-up reminder fell due on 4 November: one finished run and the notice it left. The server may
	// have run it already during seeding, at whatever instant its minute tick fell, so replace what it wrote.
	const [reminder] = await sql(
		"select id, next_run_at from career_schedule where user_id = $1 and kind = 'follow-up'",
		[userId],
	);
	await sql("delete from career_job where schedule_id = $1", [reminder.id]);
	await sql("delete from career_notification where user_id = $1 and notice->>'type' = 'followup'", [userId]);
	await sql("update career_schedule set last_queued_at = next_run_at where id = $1", [reminder.id]);
	const jobId = randomUUID();
	await sql(
		`insert into career_job (id, user_id, schedule_id, due_at, status, attempts, created_at, updated_at)
		 values ($1, $2, $3, $4, 'completed', 1, $4, $4)`,
		[jobId, userId, reminder.id, reminder.next_run_at],
	);
	await notify(
		jobId,
		applications.fieldnote,
		{ type: "followup", company: "Fieldnote", role: "Staff designer", note: "Send a follow-up" },
		`/dashboard/applications/${applications.fieldnote}`,
		reminder.next_run_at,
		// Read too: T1 draws Today at rest, with no unread schedule results (C11 is the state with them).
		reminder.next_run_at,
	);
}

/** What the Share, History, Knowledge, coach and Settings boards draw that has no create API, or whose dates do. */
async function boardData(seed) {
	const { userId, resumes, applications } = seed;
	const resumeId = resumes.productDesigner;
	const [{ data }] = await sql("select data from resume where id = $1", [resumeId]);
	const ids = {};

	// B5, B28: the custom domain, added but not connected yet, checked a few minutes ago.
	await sql(
		`insert into custom_domain (user_id, hostname, verification_token, last_checked_at, created_at)
		 values ($1, 'cv.morgan.design', '7f3a9c2e41b8d605', $2, $3)`,
		[userId, at("2026-11-07", "08:56"), at("2026-11-06", "18:40")],
	);

	// B5: 38 views in the last 30 days (9 Oct to today), busiest day 4, and 6 downloads.
	const views = [0, 1, 0, 2, 1, 0, 0, 1, 3, 2, 1, 0, 0, 2, 1, 1, 0, 3, 2, 0, 0, 1, 1, 2, 4, 3, 2, 0, 3, 2];
	const downloads = new Set([8, 13, 17, 24, 25, 28]);
	for (const [index, count] of views.entries()) {
		const date = new Date(Date.parse("2026-10-09T12:00:00Z") + index * 86_400_000).toISOString().slice(0, 10);
		const download = downloads.has(index) ? 1 : 0;
		if (count || download)
			await sql(
				`insert into resume_statistics_daily (id, resume_id, date, views, downloads, created_at)
				 values ($1, $2, $3, $4, $5, $6)`,
				[randomUUID(), resumeId, date, count, download, at(date)],
			);
	}
	await sql(
		`insert into resume_statistics (id, resume_id, views, downloads, last_viewed_at, last_downloaded_at, created_at, updated_at)
		 values ($1, $2, 38, 6, $3, $4, $5, $3)`,
		[randomUUID(), resumeId, at("2026-11-07", "08:20"), at("2026-11-06", "16:05"), at("2026-10-09", "10:00")],
	);

	// B5 "1 active", P4: Daniel Reis (active, one open comment), Careers office (turned off), Inês (expired).
	const link = async (key, label, fields) => {
		const id = randomUUID();
		ids[key] = id;
		await sql(
			`insert into feedback_link (id, user_id, resume_id, label, snapshot, resume_name, application_ids, expires_at, revoked_at, last_viewed_at, created_at)
			 values ($1, $2, $3, $4, $5, 'Product designer', $6, $7, $8, $9, $10)`,
			[id, userId, resumeId, label, data, ...fields.slice(0, 5)],
		);
		for (const [type, when] of fields[5])
			await sql("insert into feedback_event (id, link_id, user_id, type, created_at) values ($1, $2, $3, $4, $5)", [
				randomUUID(),
				id,
				userId,
				type,
				when,
			]);
		for (const [body, when, resolved] of fields[6] ?? [])
			await sql(
				`insert into feedback_comment (id, link_id, user_id, author_name, body, resolved_at, created_at)
			 values ($1, $2, $3, $4, $5, $6, $7)`,
				[randomUUID(), id, userId, label.replace(/ \(.*\)$/, ""), body, resolved, when],
			);
	};
	await link("daniel", "Daniel Reis", [
		[applications.lumen, applications.fieldnote],
		at("2026-12-05", "09:14"),
		null,
		at("2026-11-06", "18:30"),
		at("2026-11-05", "09:14"),
		[
			["created", at("2026-11-05", "09:14")],
			["viewed", at("2026-11-06", "18:30")],
			["commented", at("2026-11-06", "18:42")],
		],
		[
			[
				"The 41% to 58% line is your strongest. I'd open the Northwind Labs bullets with it.",
				at("2026-11-06", "18:42"),
				null,
			],
		],
	]);
	await link("careersOffice", "Careers office", [
		[],
		null,
		at("2026-11-03", "11:00"),
		null,
		at("2026-10-29", "10:00"),
		[
			["created", at("2026-10-29", "10:00")],
			["revoked", at("2026-11-03", "11:00")],
		],
	]);
	await link("ines", "Inês (mentor)", [
		[],
		at("2026-10-19", "10:00"),
		null,
		at("2026-10-12", "19:20"),
		at("2026-10-05", "10:00"),
		[
			["created", at("2026-10-05", "10:00")],
			["viewed", at("2026-10-12", "19:20")],
			["commented", at("2026-10-12", "19:31")],
			["commented", at("2026-10-12", "19:36")],
		],
		[
			[
				"Lead the summary with onboarding; it's the number people remember.",
				at("2026-10-12", "19:31"),
				at("2026-10-14", "09:00"),
			],
			[
				"Harbour Studio's second line could say how many shop owners you tested with.",
				at("2026-10-12", "19:36"),
				at("2026-10-14", "09:00"),
			],
		],
	]);

	// B15: two editing sessions and a named version (Created and the sent versions come from the API).
	await sql("delete from resume_version where resume_id = $1 and kind = 'auto'", [resumeId]);
	const version = (kind, name, session, when) =>
		sql(
			`insert into resume_version (id, resume_id, user_id, data, kind, name, session_id, created_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
			[randomUUID(), resumeId, userId, data, kind, name, session, when],
		);
	[{ id: ids.beforeRewrite }] = await version("named", "Before the summary rewrite", null, at("2026-11-03", "15:10"));
	await version("auto", null, "calm-yesterday", at("2026-11-06", "18:05"));
	await version("auto", null, "calm-today", at("2026-11-07", "08:44"));

	// C2, C9: the two forgotten facts, forgotten on 21 Oct and 3 Nov.
	const forgotten = await sql(
		"select id from career_fact where user_id = $1 and status = 'forgotten' order by created_at, id",
		[userId],
	);
	for (const [index, { id }] of forgotten.entries())
		await sql("update career_fact set updated_at = $2 where id = $1", [
			id,
			[at("2026-10-21", "09:05"), at("2026-11-03", "14:20")][index],
		]);

	seed.feedbackLinks = Object.fromEntries(["daniel", "careersOffice", "ines"].map((key) => [key, ids[key]]));
	seed.versions = { beforeRewrite: ids.beforeRewrite };
	if (seed.variant !== "alex") return;

	// C1, C4: two career conversations, each about one application.
	const thread = async (applicationId, title, created, messages) => {
		const id = randomUUID();
		await sql(
			`insert into agent_threads (id, user_id, ai_provider_id, scope, application_id, title, status, last_message_at, created_at, updated_at)
			 values ($1, $2, $3, 'career', $4, $5, 'active', $6, $7, $6)`,
			[id, userId, seed.aiProviderId, applicationId, title, messages.at(-1)[2], created],
		);
		for (const [sequence, [role, text, when]] of messages.entries())
			await sql(
				`insert into agent_messages (id, user_id, thread_id, role, status, sequence, ui_message, created_at, updated_at)
				 values ($1, $2, $3, $4, 'completed', $5, $6, $7, $7)`,
				[randomUUID(), userId, id, role, sequence, { id: randomUUID(), role, parts: [{ type: "text", text }] }, when],
			);
		return id;
	};
	seed.threads = {
		lumenStories: await thread(
			applications.lumen,
			"Stories for the Lumen technical interview",
			at("2026-11-06", "19:02"),
			[
				[
					"user",
					"Which of my stories should I tell in Tuesday's technical interview at Lumen?",
					at("2026-11-06", "19:02"),
				],
				[
					"assistant",
					"Lead with “A design system six teams use”: Priya Raman leads design systems, and the posting asks for a system several teams share. Keep “Onboarding that lifted activation” for the question about measurable outcomes, and open it with 41% to 58%. “Testing checkout with shop owners” answers how you test before release.\n\nYou have no story for a regulated industry. If it comes up, say so plainly and say how you learn a new domain.",
					at("2026-11-06", "19:03"),
				],
			],
		),
		parcelQuestions: await thread(
			applications.parcel,
			"Questions to ask Parcel & Co. before replying",
			at("2026-11-05", "17:40"),
			[
				["user", "What should I ask Parcel & Co. before I reply to the offer?", at("2026-11-05", "17:40")],
				[
					"assistant",
					"Three things the written offer leaves open:\n\n1. How the 10% variable pay is decided, and when it was last paid in full.\n2. What the stock options are worth today, and when they vest.\n3. Whether the Lisbon hub days are expected or optional.\n\nAsk Rui Almeida in one message, and say when you'll reply: the offer stands until Friday 13 November.",
					at("2026-11-05", "17:41"),
				],
			],
		),
	};

	// S1: a verified email, a password from August, Google linked and one passkey. Google and GitHub rows show only
	// when the server has those providers configured; the capture server has none.
	await sql('update "user" set email_verified = true where id = $1', [userId]);
	await sql("update account set updated_at = $2, created_at = $2 where user_id = $1 and provider_id = 'credential'", [
		userId,
		at("2026-08-18", "20:15"),
	]);
	await sql(
		`insert into account (id, account_id, provider_id, user_id, scope, created_at, updated_at)
		 values ($1, 'calm-google-account', 'google', $2, 'openid email profile', $3, $3)`,
		[randomUUID(), userId, at("2026-09-14", "10:00")],
	);
	await sql(
		`insert into passkey (id, name, public_key, credential_id, counter, device_type, backed_up, transports, user_id, created_at, updated_at)
		 values ($1, 'MacBook Pro', 'calm-not-a-real-public-key', 'calm-not-a-real-credential', 0, 'multiDevice', true, 'internal,hybrid', $2, $3, $3)`,
		[randomUUID(), userId, at("2026-09-20", "11:30")],
	);

	// S5: the keys' dates, and Claude connected on 2 Nov with read and write access and offline access.
	await sql(
		"update apikey set created_at = $2, updated_at = $2, last_request = $3, expires_at = $4 where reference_id = $1 and name = 'Claude Desktop'",
		[userId, at("2026-11-02", "14:10"), at("2026-11-06", "21:40"), at("2027-01-31", "23:59")],
	);
	await sql(
		"update apikey set created_at = $2, updated_at = $2, last_request = null, expires_at = null where reference_id = $1 and name = 'Portfolio site'",
		[userId, at("2026-10-14", "16:00")],
	);
	const scopes = ["openid", "profile", "email", "offline_access", "api:read", "api:write"];
	await sql(
		`insert into oauth_client (id, client_id, name, redirect_uris, token_endpoint_auth_method, grant_types, response_types, public, require_pkce, scopes, created_at, updated_at)
		 values ($1, $2, 'Claude', $3, 'none', $4, $5, true, true, $6, $7, $7)`,
		[
			randomUUID(),
			`calm-claude-${userId}`,
			["https://claude.ai/api/mcp/auth_callback"],
			["authorization_code", "refresh_token"],
			["code"],
			scopes,
			at("2026-11-02", "14:30"),
		],
	);
	await sql(
		`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at)
		 values ($1, $2, $3, $4, $5, $5)`,
		[randomUUID(), `calm-claude-${userId}`, userId, scopes, at("2026-11-02", "14:31")],
	);
}

/** The workspace results, last: career.generate saves them against the account's dates as they now are. */
const workspaces = (seeds) =>
	seedWorkspaces({ seeds, sql, appUrl, state, storage: (name) => resolve(state, `${name}.json`) });

async function saveSession(context, name) {
	const session = await context.storageState();
	// The session cookie's lifetime follows the real clock, the server's follows fake-clock.mjs: keep the cookie.
	for (const cookie of session.cookies) if (cookie.expires > 0) cookie.expires = 4_102_444_800;
	writeFileSync(resolve(state, `${name}.json`), JSON.stringify(session, null, "\t"));
	await context.dispose();
}

const seeds = {};
for (const variant of ["alex", "empty", "noai"]) {
	const context = await request.newContext({ baseURL: appUrl });
	const seed = await seedPersona(context, { baseURL: appUrl, variant, aiBaseURL: aiBaseUrl });
	// The persona's throwaway offer only marked the input version an SQL-written fit check needed; career.generate
	// now writes those results itself.
	if (seed.versionProbeId) {
		const gone = await context.delete(`/api/openapi/career/saved/${seed.versionProbeId}`, {
			headers: { origin: appUrl },
		});
		if (!gone.ok()) throw new Error(`Deleting the version probe failed with ${gone.status()}`);
	}
	await saveSession(context, variant);

	if (variant !== "empty") {
		await serverOnly(seed);
		await boardData(seed);
	}
	for (const { table, id, at: changed, created, trashed } of seed.times) {
		if (table === "application_profile")
			await sql("update application_profile set reviewed_at = $2 where user_id = $1", [id, changed]);
		else
			await sql(
				`update "${table}" set updated_at = $2, created_at = $3, trashed_at = $4 ${table === "application" ? "" : ", edited_at = $2"} where id = $1`,
				[id, changed, created ?? changed, trashed ?? null],
			);
	}
	const { times: _times, versionProbeId: _probe, ...ids } = seed;
	seeds[variant] = ids;
	console.log(`Seeded ${seed.account.email}`);
}

// A guest session with nothing in it, for the first-run boards.
{
	const context = await request.newContext({ baseURL: appUrl });
	const response = await context.post("/api/auth/sign-in/anonymous", { headers: { origin: appUrl }, data: {} });
	if (!response.ok()) throw new Error(`Guest sign-in failed with ${response.status()}: ${await response.text()}`);
	await context.patch("/api/openapi/auth/profile", {
		headers: { origin: appUrl },
		data: { locale: "en-GB", timezone },
	});
	await saveSession(context, "guest");
	console.log("Seeded a guest session");
}

// Documents were sent on the day the application moved to Applied.
await sql("update application set submitted_at = applied_at where submitted_at is not null");
await sql(
	"update resume_version v set created_at = a.applied_at from application a where a.sent_resume_version_id = v.id",
);
await sql(
	"update cover_letter_version v set created_at = a.applied_at from application a where a.sent_cover_letter_version_id = v.id",
);
// A document's first version was saved when the document was made.
await sql(
	"update resume_version v set created_at = r.created_at from resume r where v.resume_id = r.id and v.kind = 'created'",
);
await sql(
	"update cover_letter_version v set created_at = c.created_at from cover_letter c where v.cover_letter_id = c.id and v.kind = 'created'",
);
// PostgreSQL stamps defaults with the real clock, which is later than the boards' day: nothing was made after "now".
const stamped = await sql(
	`select table_name, column_name from information_schema.columns
	 where table_schema = 'public' and data_type = 'timestamp with time zone'
	 and column_name in ('created_at', 'updated_at', 'edited_at', 'first_seen_at', 'last_seen_at', 'reviewed_at', 'last_tested_at')`,
);
const clamp = async () => {
	for (const { table_name: table, column_name: column } of stamped)
		await sql(`update "${table}" set "${column}" = $1 where "${column}" > $1`, [now]);
};
await clamp();
await workspaces(seeds);
await clamp();
// After the clamp: the boards date two rows after their own "now" (W4 "Today, 09:12"), and the Kiln letter was last
// edited the evening before (W2), not when the seed linked it to its resume copy.
await sql("update career_artifact set created_at = $2, updated_at = $2 where id = $1", [
	seeds.alex.saved.lumenPractice[2],
	"2026-11-07T09:12:00.000Z",
]);
await sql("update cover_letter set updated_at = $2, edited_at = $2 where id = $1", [
	seeds.alex.letters.kiln,
	"2026-11-06T18:30:00.000Z",
]);
await pool.end();

writeFileSync(resolve(state, "ids.json"), JSON.stringify({ now, appUrl, ...seeds }, null, "\t"));
console.log(`Storage states and ids.json are in ${state}`);
