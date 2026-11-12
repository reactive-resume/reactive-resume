import { createHash, randomUUID } from "node:crypto";
import { request } from "@playwright/test";

// The application workspaces of the boards (J3, W1–W12, N5–N9), written through the app's own flows: career.generate
// against the AI stub (tests/e2e/fixtures/ai-stub-career.ts holds the words), the workspace, answer and document
// APIs. Runs after seed.mjs has set the persona's dates, because a generated result records the version of what it
// read (application, Knowledge, documents) and reads as outdated when those change afterwards. It then dates each
// result as the boards draw it. Called by seed.mjs; adds its ids to each account's entry in ids.json.

const at = (date, time) => `${date}T${time}:00.000Z`;

const messages = {
	lumen:
		"Hi Alex,\n\nThank you for the call this morning. We'd like to invite you to a technical interview with Priya Raman and Tomás Silva on Tuesday 10 November at 10:00, by video. Could you confirm that time works?\n\nBest,\nMarta Costa",
	parcel:
		"Hi Alex, we are delighted to offer you the Design systems lead role. The base salary is €110,000 a year, with a 10% bonus and stock options, starting 4 January 2027. Please let us know by Friday 13 November.",
	fieldnote:
		"Hi Alex, thanks for applying for the Staff designer role. We'd like to set up a 30-minute intro call with you next week. Could you send me a few times that work for you by Wednesday? Best, Sofia Marques, Head of design\n\n--\nSofia Marques\nHead of design · Fieldnote\nsofia.marques@fieldnote.example",
};

const lumenAnswers = [
	{
		id: "lumen-why",
		question: "Why do you want to work at Lumen?",
		answer:
			"Lumen asks for someone to own onboarding and look after a design system several teams share. That is the work I do at Northwind Labs, where the onboarding I redesigned lifted activation from 41% to 58%.",
		facts: ["Activation rose", "design system that six"],
	},
	{
		id: "lumen-proud",
		question: "Describe a project you are proud of.",
		answer:
			"Redesigning onboarding at Northwind Labs. I interviewed customers who had given up, rebuilt the flow in the order they described their own work, and tested it with five of them before release. Activation rose from 41% to 58%.",
		facts: ["Activation rose"],
	},
];

const practice = {
	question: "How did you get six product teams to adopt one design system?",
	strong:
		"I got six product teams onto one design system by starting with what they rebuilt most. Every team had its own buttons, forms and tables, so the same flow looked different in each product. I audited what they had shipped, and then moved one team at a time.",
	unclear:
		"Six product teams each had their own buttons and forms. We audited what every team had shipped, we built the shared parts, and we moved one team at a time, starting with the team that had the most to gain. All six teams use it now.",
	missing:
		"Every team at Northwind Labs had its own buttons and forms, so the same flow looked different in each product. I interviewed designers and engineers on all six teams about what slowed them down, and started with the components they rebuilt most often. Then I paired with one engineer on each team to move a real screen across. All six teams build from the same system now.",
};

/** The reviewed-answer evidence stamp, as `reviewedAnswerEvidence` in @reactive-resume/schema/application-answers. */
function fnv1a(text) {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
	return hash >>> 0;
}
const factRevision = (fact) =>
	`${new Date(fact.updatedAt).toISOString()}:${fnv1a(JSON.stringify([fact.text, fact.category, fact.status, fact.applicationId, fact.source.kind, fact.source.id, fact.source.quote]))}`;

async function session({ appUrl, storage }, account) {
	const context = await request.newContext({ baseURL: appUrl, storageState: storage(account) });
	const call = async (method, path, data) => {
		const response = await context[method](`/api/openapi${path}`, {
			headers: { origin: appUrl },
			...(data === undefined ? {} : { data }),
		});
		const body = await response.text();
		if (!response.ok()) throw new Error(`${method.toUpperCase()} ${path} failed with ${response.status()}: ${body}`);
		return body ? JSON.parse(body) : undefined;
	};
	return { context, call };
}

/** Saves part of a workspace, expecting the rest of what it replaces to be what the server has. */
async function saveWorkspace(call, applicationId, patch) {
	const current = await call("get", `/career/workspace/${applicationId}`);
	const expected = Object.fromEntries(Object.keys(patch).map((key) => [key, current[key]]));
	return call("patch", `/career/workspace/${applicationId}`, { ...patch, expected });
}

export async function workspaces({ seeds, sql, appUrl, storage }) {
	const alex = seeds.alex;
	const { call, context } = await session({ appUrl, storage }, "alex");
	const facts = await call("get", "/career/facts?all=true");
	const factIds = (...phrases) =>
		phrases.flatMap((phrase) => facts.filter((fact) => fact.text.includes(phrase)).map((fact) => fact.id));
	const generate = (applicationId, task) =>
		call("post", "/career/generate", { applicationId, locale: "en-GB", task }).then((result) => result.item ?? result);
	const date = (id, when) =>
		sql("update career_artifact set created_at = $2, updated_at = $2 where id = $1", [id, when]);
	const { lumen, parcel, fieldnote, kiln } = alex.applications;
	const saved = {};

	// --- Kiln Studio (W2): a resume copy for the job, two form questions, a reviewed answer, prepared drafts -------
	const kilnResume = await call("post", "/documents/copy-for-job", {
		resumeId: alex.resumes.productDesigner,
		applicationId: kiln,
		name: "Product designer · Kiln Studio",
	});
	alex.resumes.kiln = kilnResume;
	await call("put", `/applications/${kiln}`, { resumeId: kilnResume });
	// The letter goes with the copy, so preparing drafts keeps it instead of starting another letter.
	const letter = await call("get", `/cover-letters/${alex.letters.kiln}`);
	await call("put", `/cover-letters/${alex.letters.kiln}`, { expectedRevision: letter.revision, resumeId: kilnResume });
	const why = "Why do you want to work at Kiln Studio?";
	const drafted = (
		await call("post", "/career/generate", {
			applicationId: kiln,
			locale: "en-GB",
			task: { task: "answer", question: why, answer: "" },
		})
	).answer;
	await saveWorkspace(call, kiln, {
		answers: [
			{
				id: "kiln-why",
				question: why,
				answer: drafted.text,
				factIds: drafted.factIds,
				aiOperationIds: drafted.aiOperationIds,
			},
			{ id: "kiln-proud", question: "Describe a project you are proud of.", answer: "", factIds: [] },
		],
		checklist: [0, 1],
	});
	const evidence = facts
		.filter((fact) => drafted.factIds.includes(fact.id))
		.map((fact) => ({ kind: "fact", id: fact.id, revision: factRevision(fact) }))
		.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`));
	alex.answers = {
		kilnWhy: (
			await call("post", "/career/answers", {
				applicationId: kiln,
				question: why,
				answer: drafted.text,
				aiOperationIds: drafted.aiOperationIds,
				source: "ai-assisted",
				scope: "employer",
				factIds: drafted.factIds,
				storyIds: [],
				expectedEvidence: evidence,
				reviewed: true,
				noEmployerWording: false,
			})
		).id,
	};
	// Pending tailoring proposals and an unsaved letter draft (W8-01); nothing is accepted.
	const prepared = await call("post", `/applications/${kiln}/ai/prepare`, { questions: [] });
	alex.threads = { ...alex.threads, kilnPrepare: prepared.threadId };

	// --- Lumen (J3, W1, W3–W5, W7, W9, W10, W12) --------------------------------------------------------------
	await saveWorkspace(call, lumen, {
		questions: [{ text: "How many days a week is the team in the office?", origin: "From Fit" }],
		message: messages.lumen,
		answers: lumenAnswers.map(({ facts: phrases, ...answer }) => ({ ...answer, factIds: factIds(...phrases) })),
	});
	saved.lumenFit = (await generate(lumen, { task: "fit" })).id;
	await date(saved.lumenFit, at("2026-11-07", "08:40"));
	saved.lumenBriefing = (await generate(lumen, { task: "briefing", interviewId: alex.interviews.lumenTechnical })).id;
	await date(saved.lumenBriefing, at("2026-11-06", "18:02"));
	const attempt = async (answer, mode, storyId, when) => {
		const item = await generate(lumen, {
			task: "practice",
			interviewId: alex.interviews.lumenTechnical,
			question: practice.question,
			origin: "simulated",
			mode,
			answer,
			...(storyId ? { storyId } : {}),
		});
		await date(item.id, when);
		return item.id;
	};
	saved.lumenPractice = [
		await attempt(practice.strong, "spoken", null, at("2026-11-05", "18:31")),
		await attempt(practice.unclear, "spoken", alex.stories[0], at("2026-11-05", "18:40")),
		await attempt(practice.missing, "typed", alex.stories[0], at("2026-11-07", "09:12")),
	];
	saved.lumenDebrief = (
		await generate(lumen, {
			task: "debrief",
			interviewId: alex.interviews.lumenScreening,
			question: "Why are you leaving Northwind Labs?",
			answer:
				"That I have taken the onboarding work as far as it goes and want a product where the design system is still being shaped. I talked about the reorganisation for too long before I got there.",
			landed: "mixed",
		})
	).id;
	await date(saved.lumenDebrief, at("2026-11-05", "12:15"));
	saved.lumenReply = (await generate(lumen, { task: "reply", message: messages.lumen })).id;
	await date(saved.lumenReply, at("2026-11-05", "16:20"));
	await saveWorkspace(call, lumen, {
		ticks: { [`plan:${saved.lumenBriefing}`]: ["0", "1"], [`week:${saved.lumenDebrief}`]: ["0"] },
	});
	// Sent with the application on 2 Nov. Only Apply's submission writes this snapshot, and the persona reaches
	// Applied by moving the stage, so it is written as submission writes it (hashed the same way).
	const sent = lumenAnswers.map(({ facts: phrases, ...answer }) => ({ ...answer, factIds: factIds(...phrases) }));
	const [{ id: answersId }] = await sql(
		`insert into career_artifact (id, user_id, application_id, interview_id, title, data, evidence, input_version, created_at, updated_at)
		 values ($7, $1, $2, null, 'Application answers', $3, $4, $5, $6, $6) returning id`,
		[
			alex.userId,
			lumen,
			{ kind: "answers", answers: sent },
			{ factIds: [...new Set(sent.flatMap((answer) => answer.factIds))], storyIds: [] },
			createHash("sha256").update(JSON.stringify(sent)).digest("hex"),
			at("2026-11-02", "16:58"),
			randomUUID(),
		],
	);
	saved.lumenAnswers = answersId;

	// --- Parcel & Co. (W6) and Fieldnote (W11): pasted messages read by the coach --------------------------------
	await saveWorkspace(call, parcel, { message: messages.parcel });
	saved.parcelReply = (await generate(parcel, { task: "reply", message: messages.parcel })).id;
	await date(saved.parcelReply, at("2026-11-05", "17:05"));
	// The offer came with that message on 5 Nov.
	await sql(
		"update career_artifact set created_at = $2, updated_at = $2 where application_id = $1 and data->>'kind' = 'offer'",
		[parcel, at("2026-11-05", "17:10")],
	);
	await saveWorkspace(call, fieldnote, { message: messages.fieldnote });
	saved.fieldnoteReply = (await generate(fieldnote, { task: "reply", message: messages.fieldnote })).id;
	await date(saved.fieldnoteReply, at("2026-11-07", "08:32"));
	alex.saved = saved;
	await context.dispose();

	// --- noai (N6, N9): the same Parcel message, saved without AI, and one checklist step done ------------------------------------------------------
	const noai = await session({ appUrl, storage }, "noai");
	await saveWorkspace(noai.call, seeds.noai.applications.parcel, { message: messages.parcel });
	// N6: the first step of the checklist is done.
	await saveWorkspace(noai.call, seeds.noai.applications.lumen, {
		ticks: { [`now:${seeds.noai.interviews.lumenTechnical}`]: ["0"] },
	});
	await sql(
		"update career_artifact set created_at = $2, updated_at = $2 where application_id = $1 and data->>'kind' = 'offer'",
		[seeds.noai.applications.parcel, at("2026-11-05", "17:10")],
	);
	await noai.context.dispose();

	// The application rows the copy and letter moves touched read as the persona dates them.
	await sql("update application set updated_at = $2 where id = $1", [kiln, at("2026-11-05", "14:05")]);
}
