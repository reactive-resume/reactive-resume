#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { request } from "@playwright/test";
import { Pool } from "pg";
import { aiBaseUrl, appUrl, database, env, healthy, now, root, state, timezone } from "./env.mjs";

// Resets the Calm capture database to the persona of the redesign boards (tests/e2e/fixtures/persona.ts): empties
// every table, seeds alex / empty / noai through the running dev server's API, adds what only the server writes
// (new roles, notifications, a fit check and a briefing), sets the dates the boards show, and writes each account's
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

// Only ever this database: the local PostgreSQL also holds the owner's development data.
const [{ name }] = await sql("select current_database() as name");
if (name !== database) throw new Error(`Refusing to reset ${name}; expected ${database}.`);
// Truncating keeps the schema and the server's connections; the migration ledger lives in the `drizzle` schema.
const tables = await sql("select tablename from pg_tables where schemaname = 'public'");
await sql(`truncate ${tables.map((row) => `"${row.tablename}"`).join(", ")} restart identity cascade`);
rmSync(env.LOCAL_STORAGE_PATH, { recursive: true, force: true });
mkdirSync(env.LOCAL_STORAGE_PATH, { recursive: true });

const at = (date, time = "12:00") => `${date}T${time}:00.000Z`;

/** What has no create API: rows only scheduled work and the AI write. Shapes follow career/jobs.ts and generate.ts. */
async function serverOnly(seed) {
	const { userId, applications, interviews, facts, stories } = seed;
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

	// The fit check and the briefing for Lumen, as if written against the account as it is now.
	const [probe] = await sql("delete from career_artifact where id = $1 returning input_version", [seed.versionProbeId]);
	const evidence = [
		[
			"Five or more years designing business software",
			"supported",
			"Seven years at Northwind Labs and Harbour Studio.",
			[4, 5],
		],
		[
			"Has owned onboarding or activation for a product",
			"supported",
			"Redesigned onboarding; activation rose from 41% to 58%.",
			[0],
		],
		[
			"Has built or run a design system used by several teams",
			"supported",
			"Built the design system six product teams use.",
			[1],
		],
		[
			"Runs customer research and brings it to product decisions",
			"supported",
			"More than 40 customer interviews a year.",
			[2],
		],
		[
			"Plans work with product and engineering leads",
			"supported",
			"Plans each quarter's design work with both leads.",
			[],
		],
		[
			"Prototypes and tests before release",
			"supported",
			"Tested each release with shop owners at Harbour Studio.",
			[3, 10],
		],
		["Designs to accessibility standards", "supported", "Accessibility is among your skills.", [6]],
		["Works in Figma", "partial", "Figma is on your resume, with no example of its use.", []],
		["Experience in a regulated industry", "missing", "", []],
		["Has mentored or led other designers", "partial", "You lead the design system; mentoring isn't mentioned.", []],
	];
	const artifact = (interviewId, title, data, used, created) =>
		sql(
			`insert into career_artifact (id, user_id, application_id, interview_id, title, data, evidence, input_version, created_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
			[randomUUID(), userId, applications.lumen, interviewId, title, data, used, probe.input_version, created],
		);
	await artifact(
		null,
		"A strong match, with one gap to prepare for",
		{
			kind: "fit",
			headline: "A strong match, with one gap to prepare for",
			summary: "7 of 10 requirements have evidence in your Knowledge. The gap is experience in a regulated industry.",
			requirements: evidence.map(([text, status, proof, ids]) => ({
				text,
				origin: "posting",
				status,
				evidence: proof,
				factIds: ids.map((index) => facts[index]),
			})),
			checks: [
				{ label: "Location", met: true, text: "Lisbon, hybrid: within your 2 office days a week." },
				{ label: "Salary", met: null, text: "Not listed in the posting." },
			],
			ask: { person: "Marta Costa", text: "How many days a week does the team spend in the Lisbon office?" },
		},
		{ factIds: facts.slice(0, 7), storyIds: [] },
		at("2026-11-01", "10:00"),
	);
	await artifact(
		interviews.lumenTechnical,
		"Technical interview at Lumen",
		{
			kind: "briefing",
			headline: "Technical interview at Lumen",
			summary: "Likely questions, who you'll meet and three stories to tell.",
			plan: [
				{
					minutes: 10,
					title: "Read who you'll meet",
					detail: "Priya Raman leads design systems; Tomás Silva manages engineering.",
					action: "none",
					storyId: null,
				},
				{
					minutes: 20,
					title: "Rehearse the design system story",
					detail: "Six teams, one system: say how you moved one team at a time.",
					action: "story",
					storyId: stories[0],
				},
				{
					minutes: 15,
					title: "Practise the onboarding question",
					detail: "Lead with 41% to 58%, then how you found the cause.",
					action: "practise",
					storyId: stories[1],
				},
				{
					minutes: 5,
					title: "Choose your questions",
					detail: "Research budget, and days in the Lisbon office.",
					action: "questions",
					storyId: null,
				},
			],
			questions: [
				{ text: "How is the design system funded and staffed today?", origin: "posting" },
				{ text: "What is the research budget for the team?", origin: "your notes" },
				{ text: "How many days a week is the team in the Lisbon office?", origin: "your notes" },
			],
			focus: "They need someone to own onboarding and a shared design system: show both with numbers.",
			opening:
				"I'm a senior product designer at Northwind Labs, where I lead onboarding and the design system six teams use.",
			stories: [
				"A design system six teams use",
				"Onboarding that lifted activation",
				"Testing checkout with shop owners",
			],
			honesty: "You have no experience in a regulated industry. Say so, and say how you learn a domain.",
			storyIds: stories,
			missingStory: null,
			practiceQuestions: [
				"Walk us through how you got six teams onto one design system.",
				"How did you find out why onboarding wasn't working?",
			],
		},
		{ factIds: facts.slice(0, 4), storyIds: stories },
		at("2026-11-06", "18:00"),
	);
}

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
	await saveSession(context, variant);

	if (variant !== "empty") await serverOnly(seed);
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
// PostgreSQL stamps defaults with the real clock, which is later than the boards' day: nothing was made after "now".
const stamped = await sql(
	`select table_name, column_name from information_schema.columns
	 where table_schema = 'public' and data_type = 'timestamp with time zone'
	 and column_name in ('created_at', 'updated_at', 'edited_at', 'first_seen_at', 'last_seen_at', 'reviewed_at', 'last_tested_at')`,
);
for (const { table_name: table, column_name: column } of stamped)
	await sql(`update "${table}" set "${column}" = $1 where "${column}" > $1`, [now]);
await pool.end();

writeFileSync(resolve(state, "ids.json"), JSON.stringify({ now, appUrl, ...seeds }, null, "\t"));
console.log(`Storage states and ids.json are in ${state}`);
