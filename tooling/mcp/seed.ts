import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture, resumeData } from "./fixture";

// Dry-run validates authored answers against independently traversed fixture relationships.
for (const [index] of fixture.resumes.entries()) resumeData(index);
const pairs = [
	...(await readFile(new URL("./evaluation.xml", import.meta.url), "utf8")).matchAll(
		/<qa_pair>\s*<question>([^<]+)<\/question>\s*<answer>([^<]+)<\/answer>\s*<\/qa_pair>/g,
	),
];
const applications = fixture.applications;
const earliest = [...applications].sort((a, b) => Date.parse(a.interview.at) - Date.parse(b.interview.at))[0];
assert(earliest);
const cedar = applications.find(
	(application) => fixture.resumes[application.resume]?.email === "alex.cedar@example.test",
);
assert(cedar && cedar.letter !== null);
const delivery = applications.find(
	(application) =>
		application.letter !== null && fixture.letters[application.letter]?.content.includes("delivery reliability"),
);
assert(delivery);
const noLetter = applications.find((application) => application.letter === null);
assert(noLetter);
const kafka = applications.find((application) =>
	resumeData(application.resume).sections.skills.items.some((skill) => skill.keywords.includes("Kafka")),
);
assert(kafka);
const verifiedAnswers = [
	fixture.resumes[earliest.resume]?.employer,
	cedar.followUpAt,
	fixture.letters[cedar.letter]?.content.match(/(\d+) percent/)?.[1],
	applications.find(
		(application) => application.resume === 0 && fixture.resumes[0].employer !== String(fixture.currentEmployer),
	)?.company,
	noLetter.requirements.find(
		(requirement) =>
			!resumeData(noLetter.resume)
				.sections.skills.items.flatMap((skill) => skill.keywords)
				.includes(requirement),
	),
	new Date(delivery.interview.at).toISOString(),
	String(delivery.interview.durationMinutes),
	kafka.contact,
	String(
		applications
			.filter((application) => fixture.resumes[application.resume]?.employer === "Harbor Systems")
			.reduce((minutes, application) => minutes + application.interview.durationMinutes, 0),
	),
	fixture.resumes[cedar.resume]?.version,
];
assert.equal(pairs.length, 10, "Expected ten valid evaluation pairs.");
assert.deepEqual(
	pairs.map((pair) => pair[2]),
	verifiedAnswers,
	"Evaluation answers disagree with fixture facts.",
);

const args = process.argv.slice(2);
assert(
	args.every((arg) => arg === "--seed"),
	"Only --seed is supported.",
);
if (!args.includes("--seed")) {
	console.log(
		"Dry-run passed: 3 resumes, 2 letters, 3 applications; all 10 authored answers verified. No requests sent.",
	);
	process.exit(0);
}

const base = new URL(process.env.MCP_EVALUATION_APP_URL ?? "http://127.0.0.1:3000");
assert(
	base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname),
	"Seeding requires local HTTP loopback.",
);
assert(
	!base.username && !base.password && base.pathname === "/" && !base.search && !base.hash,
	"Supply an origin without credentials, path or query.",
);
const key = process.env.MCP_EVALUATION_API_KEY;
assert(key, "Set MCP_EVALUATION_API_KEY for an empty, dedicated evaluation account.");
const authenticationHeaders = { "x-api-key": key };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
	const response = await fetch(new URL(`/api/openapi${path}`, base), {
		method,
		redirect: "error",
		signal: AbortSignal.timeout(30_000),
		headers: { ...authenticationHeaders, ...(body === undefined ? {} : { "content-type": "application/json" }) },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	assert(response.ok, `HTTP ${response.status}: ${method} ${path}`);
	return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

// Refuse to add fixtures to an account containing user documents or application records.
assert.equal((await request<unknown[]>("GET", "/resumes?limit=1")).length, 0, "Evaluation account contains resumes.");
assert.equal(
	(await request<unknown[]>("GET", "/applications?limit=1")).length,
	0,
	"Evaluation account contains applications.",
);
assert.equal(
	(await request<{ total: number }>("GET", "/cover-letters?limit=1")).total,
	0,
	"Evaluation account contains letters.",
);
const ids: { resumes: string[]; letters: string[]; applications: string[] } = {
	resumes: [],
	letters: [],
	applications: [],
};
for (const [index, facts] of fixture.resumes.entries()) {
	const id = await request<string>("POST", "/resumes", {
		name: facts.name,
		tags: ["mcp-evaluation"],
		withSampleData: false,
	});
	assert.equal(typeof id, "string");
	ids.resumes.push(id);
	await request("PATCH", `/resumes/${encodeURIComponent(id)}/metadata`, { data: resumeData(index) });
	await request("POST", `/resumes/${encodeURIComponent(id)}/versions`, { name: facts.version });
}
for (const facts of fixture.letters) {
	const letter = await request<{ id: string }>("POST", "/cover-letters", {
		name: facts.name,
		resumeId: ids.resumes[facts.resume],
		content: facts.content,
		letterDate: facts.letterDate,
		recipientCompany: fixture.applications[facts.resume]?.company,
	});
	assert.equal(typeof letter.id, "string");
	ids.letters.push(letter.id);
	await request("POST", `/cover-letters/${encodeURIComponent(letter.id)}/versions`, { name: `${facts.name} baseline` });
}
for (const facts of fixture.applications) {
	const id = await request<string>("POST", "/applications", {
		company: facts.company,
		role: facts.role,
		status: "applied",
		stageEnteredAt: "2024-09-03",
		resumeId: ids.resumes[facts.resume],
		...(facts.letter === null ? {} : { coverLetterId: ids.letters[facts.letter] }),
		requirements: facts.requirements,
		contacts: [{ name: "Recruiter", type: "Recruiter", email: facts.contact }],
		followUpAt: facts.followUpAt,
		tags: ["mcp-evaluation"],
	});
	assert.equal(typeof id, "string");
	ids.applications.push(id);
	await request("POST", `/applications/${encodeURIComponent(id)}/interviews`, facts.interview);
	const recorded = await request<{ sentResumeVersionId: string | null; sentCoverLetterVersionId: string | null }>(
		"GET",
		`/applications/${encodeURIComponent(id)}`,
	);
	assert(recorded.sentResumeVersionId, "Submitted resume snapshot missing.");
	if (facts.letter !== null) assert(recorded.sentCoverLetterVersionId, "Submitted letter snapshot missing.");
}
const beaconId = ids.resumes[0];
assert(beaconId);
const revised = resumeData(0);
const employer = revised.sections.experience.items[0];
assert(employer);
employer.company = fixture.currentEmployer;
await request("PATCH", `/resumes/${encodeURIComponent(beaconId)}/metadata`, { data: revised });
const cedarLetterId = ids.letters[1];
assert(cedarLetterId);
const cedarLetter = await request<{ revision: number }>("GET", `/cover-letters/${encodeURIComponent(cedarLetterId)}`);
await request("PATCH", `/cover-letters/${encodeURIComponent(cedarLetterId)}`, {
	expectedRevision: cedarLetter.revision,
	content: fixture.currentCedarLetter,
});
console.log("Synthetic evaluation account seeded. Use a separate read-only key for model evaluation.");
