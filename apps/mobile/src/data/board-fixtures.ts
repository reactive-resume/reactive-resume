import { createDefaultApplicationLanes } from "@reactive-resume/schema/applications/lanes";
import { EMPTY_WORKSPACE, savedItemDataSchema } from "@reactive-resume/schema/career";
import { now } from "./clock";
import { fixtureArtifact } from "./fixture-artifacts";
import texts from "./storyboard-texts.json";

type Row = Record<string, unknown>;
const rows = (state: Row, key: string) => state[key] as Row[];
export const visitorShape = [
	13, 9.5, 19, 16, 6.5, 22.5, 29, 19, 13, 16, 35, 64, 45, 25.5, 19, 13, 9.5, 22.5, 16, 29, 19, 9.5, 13, 25.5,
];
export const postingTerms = [
	"Design systems",
	"Prototyping",
	"User research",
	"Interaction design",
	"Figma",
	"Accessibility",
	"Onboarding",
	"Payments",
	"Product strategy",
	"Accessibility audits",
	"Design tokens",
	"Workshop facilitation",
	"Healthcare",
	"Service design",
];
export const lumenPosting = `Senior product designer at Lumen in Lisbon. ${postingTerms.join(". ")}.`;

/** Shared seed values follow J2 (Parcel role), B15 (sent snapshot), W4 (latest practice). */
export function completeBoardSeed(state: Row, empty: boolean) {
	Object.assign(state.account as Row, { username: "alex", displayUsername: "alex", locale: "en-GB" });
	state.lanes = { revision: 0, lanes: createDefaultApplicationLanes() };
	state.workspaces = {};
	if (empty) return;
	const applications = rows(state, "applications");
	const base = applications[0];
	if (!base) throw new Error("Storyboard application unavailable.");
	const specifications: [string, string, boolean, string][] = [
		["referral-1", "Referrals", true, "screening"],
		["referral-2", "Referrals", false, "applied"],
		["company-1", "Company sites", true, "interview"],
		...[2, 3, 4].map((i) => [`company-${i}`, "Company sites", false, "applied"] as [string, string, boolean, string]),
		...[1, 2].map((i) => [`board-${i}`, "Job boards", true, "screening"] as [string, string, boolean, string]),
		...[3, 4, 5, 6, 7].map((i) => [`board-${i}`, "Job boards", false, "applied"] as [string, string, boolean, string]),
	];
	for (const [id, source, replied, stage] of specifications) {
		applications.push({
			...structuredClone(base),
			id,
			company: id,
			status: "closed",
			closedReason: replied ? "withdrew" : "no-response",
			source,
			activity: [],
			resumeId: null,
			coverLetterId: null,
			sentResumeVersionId: null,
			sentCoverLetterVersionId: null,
			appliedAt: new Date("2026-10-20T12:00:00Z"),
			replyStage: replied ? stage : null,
		});
	}
	for (const app of applications.filter((row) => !row.trashedAt)) {
		const id = String(app.id);
		app.source ??=
			id === "lumen" ? "Referrals" : ["orbital-health", "parcel"].includes(id) ? "Company sites" : "Job boards";
		app.laneId = app.status;
		if (id === "parcel") {
			app.role = "Lead designer";
			app.appliedAt = new Date("2026-10-23T12:00:00Z");
			app.createdAt = new Date("2026-10-18T10:00:00Z");
		}
		if (id === "lumen") app.appliedAt = new Date("2026-11-03T13:20:00Z");
		if (id === "orbital-health") app.appliedAt = new Date("2026-10-29T11:00:00Z");
		if (id === "fieldnote") app.role = "Design systems designer";
		if (id === "orbital-health") app.role = "Product designer";
		const replyStage = app.replyStage ?? (["lumen", "orbital-health", "parcel"].includes(id) ? app.status : null);
		const at = new Date(app.appliedAt as Date);
		const activity = app.activity as Row[];
		activity.unshift(
			{
				id: `${id}-saved`,
				type: "stage",
				stage: "saved",
				at: new Date(Math.min(new Date(app.createdAt as Date).getTime(), at.getTime() - 5 * 86400000)).toISOString(),
			},
			{ id: `${id}-applied`, type: "stage", stage: "applied", at: at.toISOString() },
		);
		if (replyStage)
			activity.push({
				id: `${id}-reply`,
				type: "stage",
				stage: id === "parcel" || id === "lumen" ? "screening" : replyStage,
				at: id === "lumen" ? "2026-11-05T13:20:00Z" : new Date(at.getTime() + 6 * 86400000).toISOString(),
			});
		if (id === "parcel" || id === "lumen")
			activity.push({
				id: `${id}-current-stage`,
				type: "stage",
				stage: app.status,
				at: id === "parcel" ? "2026-11-04T10:00:00Z" : "2026-11-06T10:00:00Z",
			});
		if (app.status === "closed")
			activity.push({
				id: `${id}-closed`,
				type: "stage",
				stage: "closed",
				closedReason: app.closedReason,
				at: "2026-11-06T10:00:00Z",
			});
		const interview = activity.find((row) => row.type === "interview");
		if (interview)
			Object.assign(interview, {
				durationMinutes: 60,
				location: "https://meet.example.org/interview",
				participants:
					id === "lumen"
						? [
								{ name: "Priya Raman", role: "Design lead" },
								{ name: "Tomás Silva", role: "Designer" },
							]
						: [{ name: "Hiring team", role: "Recruiter" }],
			});
		app.contacts =
			id === "lumen"
				? [
						{ id: "priya", name: "Priya Raman", role: "Design lead", email: "", phone: "", linkedinUrl: "" },
						{ id: "tomas", name: "Tomás Silva", role: "Designer", email: "", phone: "", linkedinUrl: "" },
					]
				: id === "fieldnote"
					? [{ id: "joana", name: "Joana Reis", role: "Recruiter", email: "", phone: "", linkedinUrl: "" }]
					: [];
		(state.workspaces as Row)[id] = structuredClone(EMPTY_WORKSPACE);
	}
	Object.assign(base, {
		jobDescription: lumenPosting,
		requirements: postingTerms,
		sourceUrl: "https://lumen.com/careers",
		sentResumeVersionId: "version-sent",
		sentCoverLetterVersionId: "letter-sent",
	});
	const facts = rows(state, "facts");
	if (facts[1])
		Object.assign(facts[1], {
			source: { kind: "user-message", id: "coach-2-nov", quote: facts[1].text },
			createdAt: new Date("2026-11-02T10:00:00Z"),
		});
	if (facts[2])
		Object.assign(facts[2], {
			source: { kind: "user-message", id: "assistant-today", quote: facts[2].text },
			createdAt: now(),
		});
	const quotes = (base.requirements as string[]).slice(0, 8);
	for (let i = 4; i < 12; i++)
		facts.push({
			...structuredClone(facts[0]),
			id: `fact-${i}`,
			text: quotes[i - 4],
			sourceKey: `fixture-${i}`,
			source: { kind: "resume", id: "resume-product", quote: quotes[i - 4] },
		});
	rows(state, "stories").push({
		...structuredClone(rows(state, "stories")[0]),
		id: "story-shared-system",
		data: {
			applicationId: null,
			title: "Building the shared system",
			situation: "Six teams needed a shared system.",
			task: "Build the design system.",
			action: "Built and scaled the design system adopted by six teams.",
			result: "Cut interface defects by a third.",
			reflection: "",
			tags: ["Design systems"],
			factIds: ["fact-3"],
		},
	});
	const items = rows(state, "offers");
	const add = (id: string, applicationId: string, data: unknown, at = now()) => {
		const app = applications.find((row) => row.id === applicationId);
		const parsed = savedItemDataSchema.parse(data);
		items.push({
			...structuredClone(items[0]),
			id,
			applicationId,
			application: app,
			title: "headline" in parsed ? parsed.headline : "title" in parsed ? parsed.title : "",
			data: parsed,
			evidence: { factIds: facts.map((row) => row.id), storyIds: ["story-shared-system"] },
			createdAt: at,
			updatedAt: at,
		});
	};
	// W1–W4's saved work for Lumen, as the boards draw it.
	const requirement = (text: string, origin: "posting" | "inferred", status: string, evidence = "") => ({
		text,
		origin,
		status,
		evidence,
		factIds: [],
	});
	add(
		"lumen-fit",
		"lumen",
		{
			kind: "fit",
			headline: "",
			summary: "",
			requirements: [
				requirement("Design systems at scale", "posting", "supported", "Northwind Labs entry"),
				requirement("Accessibility", "posting", "partial", "in Skills only"),
				requirement("Workshop facilitation", "posting", "missing"),
				requirement("Payments experience", "inferred", "supported", "Harbour Studio entry"),
				requirement("Research synthesis", "inferred", "supported", "Northwind Labs entry"),
				requirement("Prototyping", "inferred", "supported", "Harbour Studio entry"),
				requirement("Mentoring", "inferred", "partial", "in Summary only"),
				requirement("Design tokens", "inferred", "supported", "Northwind Labs entry"),
				requirement("Clinical software", "inferred", "missing"),
				requirement("Stakeholder reviews", "inferred", "missing"),
			],
			checks: [],
			ask: null,
		},
		new Date("2026-11-07T08:40:00+01:00"),
	);
	const likely = [
		"Walk me through a design system decision and its trade-offs.",
		"How do you make accessibility part of the process?",
	];
	add(
		"lumen-briefing",
		"lumen",
		{
			kind: "briefing",
			headline: "",
			summary:
				"Lumen builds scheduling software for clinics; 140 people, design team of 9. Their design system is being rebuilt this year; the posting mentions it twice.",
			plan: [],
			questions: likely.map((text) => ({ text, origin: "Posting" })),
			focus: "",
			opening: "",
			stories: [],
			honesty: "",
			storyIds: ["story-shared-system"],
			practiceQuestions: [
				...likely,
				"Tell me about a time a component didn't work for a team.",
				"How do you measure whether a design system is working?",
			],
		},
		new Date("2026-11-07T07:00:00+01:00"),
	);
	for (const [i, when] of ["2026-11-05T19:30:00+01:00", "2026-11-07T08:12:00+01:00"].entries())
		add(
			`lumen-practice-${i}`,
			"lumen",
			{
				kind: "practice",
				question: likely[0],
				origin: "simulated",
				mode: "spoken",
				answer: "",
				title: "",
				works: "",
				strengthen: "",
				opening: "",
				note: "clear structure, add the result",
			},
			new Date(when),
		);
	add(
		"fieldnote-followup",
		"fieldnote",
		fixtureArtifact({ task: "reply", message: texts["W5-Messages"].slice(8, 12).join("\n\n") }),
	);
	add("lumen-thankyou", "lumen", {
		...fixtureArtifact({ task: "reply", message: "Thank you Priya" }),
		title: "Thank-you note to Priya",
	});
	state.apiKeys = {
		total: 2,
		apiKeys: [0, 1].map((i) => ({
			id: `key-${i}`,
			name: i === 0 ? "Read only" : "Desktop",
			start: "storyboard",
			prefix: null,
			enabled: true,
			createdAt: now(),
			updatedAt: now(),
			expiresAt: null,
			lastRequest: null,
			permissions: { api: i === 0 ? ["read"] : ["read", "write", "delete"] },
		})),
	};
	state.connectedApps = {
		connections: ["Claude Desktop", "Reactive Resume"].map((clientName, i) => ({
			id: `connection-${i}`,
			clientId: `client-${i}`,
			clientName,
			scopes: ["read"],
			createdAt: now(),
		})),
	};
	const provider = rows(state, "aiProviders")[0];
	rows(state, "aiProviders").push({
		...structuredClone(provider),
		id: "ollama-mac",
		label: "Ollama on my Mac",
		provider: "ollama",
		model: "llama3.1",
		baseURL: "http://localhost:11434",
		isDefault: false,
		testStatus: "failure",
		testError: "fetch failed",
		testErrorKind: "network",
		apiKeyPreview: "",
		apiKeyFingerprint: "storyboard-ollama",
		lastUsedAt: null,
	});
}
