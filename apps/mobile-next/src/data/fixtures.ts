import type { Backend, Resource, ResourceInput, ResourceOutput } from "./resources";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { applicationProfileDataSchema } from "@reactive-resume/schema/application-profile";
import {
	applicationTimelineEntrySchema,
	type ApplicationTimelineEntry,
} from "@reactive-resume/schema/applications/data";
import { careerProfileDataSchema, EMPTY_WORKSPACE, offerTermsSchema } from "@reactive-resume/schema/career";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { setNow, setTimeZone, now } from "./clock";
import { resetFixtureStorage } from "./storage";
import texts from "./storyboard-texts.json";

export type Fixture = "storyboard" | "empty-account";
let selected: Fixture | undefined = process.env.EXPO_PUBLIC_STORYBOARD === "1" ? "storyboard" : undefined;
let generation = 0;
let seedVersion = 0;
let busy = 0;
const listeners = new Set<() => void>();
export const isFake = () => selected !== undefined;
export const isBusy = () => busy > 0;
export const fixtureGeneration = () => generation;
export const fixtureSeedVersion = () => seedVersion;
export function subscribeFixture(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
export const storyboardTexts = texts;
export function screenTexts(screen: keyof typeof texts): readonly string[] {
	return texts[screen];
}
type Row = Record<string, unknown>;
let state: ReturnType<typeof makeState>;
function clock() {
	setNow("2026-11-07T08:41:00.000Z");
	setTimeZone("Europe/Berlin");
}
function makeState(fixture: Fixture) {
	const empty = fixture === "empty-account";
	const at = now();
	const yesterday = new Date("2026-11-06T09:41:00+01:00");
	const data = structuredClone(defaultResumeData);
	data.basics = {
		...data.basics,
		name: "Alex Morgan",
		headline: "Senior product designer",
		location: "Lisbon, Portugal",
		email: "alex@morgan.design",
		phone: "+351 912 345 678",
	};
	const b1 = texts["B1-Overview"];
	data.summary.content = `<p>${b1[8]}</p>`;
	data.sections.education.items = [
		{
			id: "porto",
			hidden: false,
			school: "University of Porto",
			degree: "",
			area: "",
			grade: "",
			location: "Porto",
			period: "2017 – 2019",
			website: { url: "", label: "", inlineLink: false },
			description: "",
		},
	];
	data.sections.skills.items = [
		"Product strategy",
		"Interaction design",
		"Prototyping",
		"Design systems",
		"User research",
	].map((name, index) => ({
		id: `skill-${index}`,
		hidden: false,
		icon: "",
		iconColor: "",
		name,
		proficiency: "",
		level: 0,
		keywords: [],
	}));
	data.sections.experience.items = [
		{
			id: "northwind",
			hidden: false,
			company: "Northwind Labs",
			position: "Senior product designer",
			location: "Lisbon",
			period: "Mar 2022 – Present",
			website: { url: "", label: "", inlineLink: false },
			roles: [],
			description: `<ul>${b1
				.slice(13, 16)
				.map((text) => `<li>${text}</li>`)
				.join("")}</ul>`,
		},
		{
			id: "harbour",
			hidden: false,
			company: "Harbour Studio",
			position: "Product designer",
			location: "Porto",
			period: "Jun 2019 – Feb 2022",
			website: { url: "", label: "", inlineLink: false },
			roles: [],
			description: `<ul>${b1
				.slice(19, 21)
				.map((text) => `<li>${text}</li>`)
				.join("")}</ul>`,
		},
	];
	const resumes = ["Product designer", "Product designer — Lumen", "Design lead"].map((name, index) => ({
		id: ["resume-product", "resume-lumen", "resume-lead"][index] ?? "resume-product",
		name,
		slug: `product-designer${index || ""}`,
		tags: [],
		isLocked: false,
		isPublic: index === 0,
		showDownloadButtons: true,
		hasPassword: false,
		allowWordDownload: false,
		showInSearchEngines: false,
		hideContactDetails: false,
		isPrimary: index === 0,
		applicationId: null,
		createdAt: new Date("2026-10-03T08:00:00Z"),
		updatedAt: index === 0 ? new Date(at.getTime() - 7_200_000) : yesterday,
		data: structuredClone(data),
		aiOperationIds: [],
	}));
	const letters = ["Lumen", "Orbital Health"].map((company, index) => ({
		id: `letter-${index}`,
		name: `Letter for ${company}`,
		recipient: `Hiring team · ${company}, Lisbon`,
		content: texts["L1-Letter"]
			.slice(3, 5)
			.map((text) => `<p>${text}</p>`)
			.join(""),
		greeting: `Dear hiring team at ${company},`,
		signOff: null,
		layout: "structured",
		recipientName: "Hiring team",
		recipientCompany: company,
		letterDate: "2026-11-06",
		sourceResumeId: "resume-lumen",
		sourceApplicationId: index === 0 ? "lumen" : "orbital-health",
		senderLinked: true,
		designLinked: true,
		isLocked: false,
		revision: 1,
		createdAt: yesterday,
		updatedAt: yesterday,
		style: copyCoverLetterStyle(data),
	}));
	const documents: Row[] = [
		...resumes.map((row) => ({
			...row,
			type: "resume",
			editedAt: row.updatedAt,
			recipient: null,
			application: null,
			trashedAt: null,
			hasPassword: false,
		})),
		...letters.map((row) => ({
			...row,
			type: "letter",
			isPublic: false,
			hasPassword: false,
			slug: null,
			tags: [],
			trashedAt: null,
			editedAt: row.updatedAt,
			application: null,
		})),
	];
	const applications = [
		["lumen", "Lumen", "interview"],
		["orbital-health", "Orbital Health", "screening"],
		["parcel", "Parcel & Co.", "offer"],
		["fieldnote", "Fieldnote", "applied"],
		["kiln", "Kiln Studio", "applied"],
	].map(([id, company, status]) => ({
		id,
		company,
		role: "Senior product designer",
		status,
		laneId: null,
		closedReason: null,
		resumeId: "resume-lumen",
		coverLetterId: "letter-0",
		sentResumeVersionId: null as string | null,
		sentCoverLetterVersionId: null as string | null,
		sentCheckScore: null,
		location: "Lisbon",
		salary: null,
		requirements: [],
		source: null,
		sourceUrl: null,
		jobDescription: null,
		postingSource: null,
		matchScore: null,
		aiMetadata: null,
		notes: null,
		resumeFileUrl: null,
		resumeFileName: null,
		coverLetterUrl: null,
		coverLetterName: null,
		followUpAt: null,
		followUpNote: null,
		tags: [],
		contacts: [],
		activity: [] as ApplicationTimelineEntry[],
		appliedAt: new Date("2026-11-02T11:00:00Z"),
		createdAt: new Date("2026-10-24T10:00:00Z"),
		updatedAt: yesterday,
		trashedAt: null as Date | null,
	}));
	for (const row of applications) {
		if (row.id === "lumen" || row.id === "orbital-health")
			row.activity.push(
				applicationTimelineEntrySchema.parse({
					id: `${row.id}-interview`,
					type: "interview",
					at: row.id === "lumen" ? "2026-11-10T10:00:00+01:00" : "2026-11-09T15:30:00+01:00",
					kind: row.id === "lumen" ? "technical" : "screening",
					timezone: "Europe/Berlin",
				}),
			);
	}

	if (!empty) {
		if (!resumes[0] || !letters[0] || !applications[0]) throw new Error("Invalid fixture seed.");
		const junior = { ...resumes[0], id: "resume-junior", name: "Junior designer 2021" };
		const brightside = {
			...letters[0],
			id: "letter-brightside",
			name: "Letter for Brightside",
			recipientCompany: "Brightside",
		};
		resumes.push(junior);
		letters.push(brightside);
		documents.push({
			...junior,
			type: "resume",
			editedAt: junior.updatedAt,
			recipient: null,
			application: null,
			trashedAt: new Date("2026-11-03T08:41:00Z"),
			hasPassword: false,
		});
		documents.push({
			...brightside,
			type: "letter",
			isPublic: false,
			hasPassword: false,
			slug: null,
			tags: [],
			trashedAt: new Date("2026-10-12T08:41:00Z"),
			editedAt: brightside.updatedAt,
			application: null,
		});
		applications.push({
			...applications[0],
			id: "brightside",
			company: "Brightside",
			role: "Product designer",
			status: "saved",
			trashedAt: new Date("2026-11-01T08:41:00Z"),
		});
	}
	const facts = [
		"Led the onboarding redesign at Northwind Labs",
		"Activation rose from 41% to 58% after it",
		"Took part in the accessibility audit",
		"Design systems used by six teams",
	].map((text, index) => ({
		id: `fact-${index}`,
		userId: "alex",
		text,
		category: index === 3 ? "skill" : "experience",
		applicationId: null,
		company: null,
		source: { kind: "resume", id: "resume-product", quote: text },
		sourceKey: `fixture-${index}`,
		status: "active",
		revisions: [],
		usedBy: { stories: 0, savedItems: 0 },
		createdAt: yesterday,
		updatedAt: yesterday,
	}));
	const story = texts["C4-Story"];
	const stories = [
		{
			id: "story-onboarding",
			userId: "alex",
			applicationId: null,
			data: {
				applicationId: null,
				title: story[0],
				situation: story[3],
				task: story[5],
				action: story[7],
				result: story[9],
				reflection: "",
				tags: ["Leadership", "Measurable impact", "Research"],
				factIds: ["fact-0", "fact-1"],
			},
			createdAt: yesterday,
			updatedAt: yesterday,
		},
	];
	return {
		resumes: empty ? [] : resumes,
		letters: empty ? [] : letters,
		documents: empty ? [] : documents,
		applications: empty ? [] : applications,
		facts: empty ? [] : facts,
		stories: empty ? [] : stories,
		preferences: careerProfileDataSchema.parse(
			empty
				? {}
				: {
						targetRoles: ["Senior product designer", "design lead"],
						locations: ["Lisbon", "remote in the EU"],
						priorities: "Pay, then remote, then holidays",
						minBase: { amount: 65000, currency: "EUR", period: "year" },
					},
		),
		profile: empty
			? null
			: {
					data: applicationProfileDataSchema.parse({
						givenName: "Alex",
						familyName: "Morgan",
						email: "alex@morgan.design",
						phone: "+351 912 345 678",
						address: { city: "Lisbon", countryCode: "PT" },
						links: [{ label: "LinkedIn", url: "https://linkedin.com/in/alexmorgan" }],
						requestedSalary: { amount: 65000, currency: "EUR", period: "year" },
					}),
					reviewedAt: at.toISOString(),
					revision: "1",
				},
		workspace: structuredClone(EMPTY_WORKSPACE),
		notifications: [] as Row[],
		schedules: empty
			? []
			: [
					{
						id: "discovery",
						userId: "alex",
						kind: "discovery",
						query: "Senior product designer",
						applicationId: null,
						interviewId: null,
						lead: null,
						locale: "en-US",
						timezone: "Europe/Berlin",
						enabled: true,
						email: false,
						nextRunAt: new Date("2026-11-08T06:00:00Z"),
						lastQueuedAt: null,
						intervalDays: 1,
						aiProviderId: "work-openai",
						lastRun: null,
						createdAt: yesterday,
						updatedAt: yesterday,
					},
				],
		offers: empty
			? []
			: ["Parcel & Co.", "Meridian"].map((company, index) => ({
					id: `offer-${index}`,
					userId: "alex",
					applicationId: index === 0 ? "parcel" : null,
					interviewId: null,
					title: company,
					data: {
						kind: "offer",
						...offerTermsSchema.parse({
							currency: "EUR",
							period: "year",
							base: index === 0 ? 72000 : 68000,
							variable: null,
							variablePercent: index === 0 ? 10 : null,
							equity: index === 0 ? "—" : "0.1% · 4 years",
							location: index === 0 ? "Hybrid" : "Remote",
							leave: index === 0 ? "25 days" : "23 days",
							startDate: index === 0 ? "2026-12-01" : "2027-01-04",
							respondBy: index === 0 ? "2026-11-13T17:00:00+01:00" : "2026-11-20T17:00:00+01:00",
						}),
					},
					evidence: { factIds: [], storyIds: [] },
					jobId: null,
					inputVersion: "fixture",
					aiOperationId: null,
					aiUsage: null,
					application: {
						id: index === 0 ? "parcel" : "meridian",
						company,
						role: "Senior product designer",
						status: "offer",
						closedReason: null,
					},
					outdated: false,
					createdAt: yesterday,
					updatedAt: yesterday,
				})),
		aiProviders: empty
			? []
			: [
					{
						id: "work-openai",
						managed: false,
						label: "Work OpenAI",
						provider: "openai",
						model: "gpt-5-mini",
						fastModel: null,
						capableModel: null,
						baseURL: null,
						enabled: true,
						isDefault: true,
						testStatus: "success",
						testError: null,
						testErrorKind: null,
						apiKeyPreview: "••••4f2a",
						apiKeyFingerprint: "storyboard-key",
						recipientVersion: "0".repeat(64),
						lastTestedAt: yesterday,
						lastUsedAt: yesterday,
						createdAt: yesterday,
						updatedAt: yesterday,
					},
				],
		opportunities: empty
			? []
			: [
					{
						id: "opportunity-kiln",
						userId: "alex",
						url: "https://example.org/kiln",
						role: "Senior product designer",
						company: "Kiln Studio",
						location: "Lisbon",
						snippet: "Hybrid",
						discoverySource: null,
						firstSeenAt: at,
						lastSeenAt: at,
						dismissedAt: null,
						trackedApplicationId: null,
						createdAt: at,
						updatedAt: at,
						matches: ["Lisbon", "Hybrid"],
						keywordOverlap: [],
						unknowns: ["salary"],
					},
				],
		versions: empty
			? []
			: [
					{ id: "version-session", kind: "auto", name: null, createdAt: new Date("2026-11-07T18:02:00+01:00") },
					{ id: "version-ai", kind: "ai", name: null, createdAt: new Date("2026-11-07T09:14:00+01:00") },
					{ id: "version-sent", kind: "sent", name: "Sent to Lumen", createdAt: new Date("2026-11-03T14:20:00+01:00") },
				],
		letterVersions: [] as Row[],
		account: {
			id: "alex",
			name: "Alex Morgan",
			username: "alexmorgan",
			displayUsername: "alexmorgan",
			email: "alex@morgan.design",
			image: null,
			emailVerified: true,
			timezone: "Europe/Berlin",
			locale: "en-US",
		},
	};
}
export function seed(fixture: Fixture): void {
	selected = fixture;
	seedVersion++;
	resetFixtureStorage();
	clock();
	state = makeState(fixture);
	generation++;
	for (const listener of listeners) listener();
}
export function selectRealData(): void {
	selected = undefined;
	seedVersion++;
	setNow();
	setTimeZone();
	generation++;
	for (const listener of listeners) listener();
}
if (selected) seed(selected);
export const fakeBackend: Backend = {
	kind: "fake",
	async read<K extends Resource>(resource: K, input: ResourceInput<K>): Promise<ResourceOutput<K>> {
		busy++;
		await Promise.resolve();
		try {
			state ??= makeState(selected ?? "storyboard");
			const fields = (input ?? {}) as Row;
			let value: unknown;
			if (resource === "resume") value = state.resumes.find((row) => row.id === fields.id);
			else if (resource === "letter") value = state.letters.find((row) => row.id === fields.id);
			else if (resource === "applications") value = state.applications.filter((row) => !row.trashedAt);
			else if (resource === "application") value = state.applications.find((row) => row.id === fields.id);
			else if (resource === "publicResume") value = state.resumes[0];
			else if (resource === "documents")
				value = state.documents.filter(
					(row) =>
						Boolean(row.trashedAt) === Boolean(fields.trashed) &&
						(!fields.type || fields.type === "all" || row.type === fields.type) &&
						(!fields.q || String(row.name).toLowerCase().includes(String(fields.q).toLowerCase())),
				);
			else if (resource === "applicationTrash")
				value = {
					items: state.applications.filter((row) => row.trashedAt),
					total: state.applications.filter((row) => row.trashedAt).length,
				};
			else if (resource === "opportunities") value = state.opportunities;
			else value = (state as Record<string, unknown>)[resource];
			if (value === undefined) throw new Error("Fixture resource not found.");
			// Fixture dispatch is the sole untyped boundary; resource hooks preserve the real router contract.
			return structuredClone(value) as ResourceOutput<K>;
		} finally {
			busy--;
		}
	},
	async write(operation, input) {
		await Promise.resolve();
		state ??= makeState(selected ?? "storyboard");
		const fields = input as Row;
		if (operation === "applicationProfile.save")
			state.profile = {
				data: applicationProfileDataSchema.parse(fields.data),
				reviewedAt: now().toISOString(),
				revision: String(generation + 1),
			};
		else if (operation === "career.updateProfile" || operation === "career.saveProfile")
			state.preferences = { ...state.preferences, ...fields };
		else if (operation === "applications.update") {
			const index = state.applications.findIndex((row) => row.id === fields.id);
			if (index < 0) throw new Error("Fixture application not found.");
			const current = state.applications[index];
			if (!current) throw new Error("Fixture application not found.");
			state.applications[index] = { ...current, ...fields, updatedAt: now() };
		} else if (operation === "documents.rename" || operation === "documents.setTags") {
			const row = state.documents.find((row) => row.id === fields.id && row.type === fields.type);
			if (!row) throw new Error("Fixture document not found.");
			Object.assign(row, fields);
		} else if (operation === "career.saveWorkspace") state.workspace = { ...state.workspace, ...fields };
		else if (operation === "career.saveFact" || operation === "career.updateFact") {
			const existing = state.facts.find((row) => row.id === fields.id);
			if (existing) Object.assign(existing, fields, { updatedAt: now() });
			else
				state.facts.push({
					...state.facts[0],
					...fields,
					id: `fact-${generation}`,
					userId: "alex",
					text: String(fields.text ?? ""),
					category: String(fields.category ?? "experience"),
					applicationId: null,
					company: null,
					source: { kind: "manual", id: "", quote: "" },
					sourceKey: `fixture-${generation}`,
					status: "active",
					revisions: [],
					usedBy: { stories: 0, savedItems: 0 },
					createdAt: now(),
					updatedAt: now(),
				});
		} else if (operation === "career.saveStory") {
			const existing = state.stories.find((row) => row.id === fields.id);
			if (existing) Object.assign(existing.data, fields);
			else
				state.stories.push({
					id: `story-${generation}`,
					userId: "alex",
					applicationId: null,
					data: {
						applicationId: null,
						title: String(fields.title ?? ""),
						situation: String(fields.situation ?? ""),
						task: String(fields.task ?? ""),
						action: String(fields.action ?? ""),
						result: String(fields.result ?? ""),
						reflection: "",
						tags: [],
						factIds: [],
					},
					createdAt: now(),
					updatedAt: now(),
				});
		} else throw new Error(`Fixture mutation not implemented: ${operation}`);
		generation++;
		for (const listener of listeners) listener();
	},
};

const readPaths: Record<string, Resource> = {
	"documents.list": "documents",
	"resume.getById": "resume",
	"coverLetters.getById": "letter",
	"applications.list": "applications",
	"applications.getById": "application",
	"career.workspace": "workspace",
	"career.facts": "facts",
	"career.stories": "stories",
	"career.profile": "preferences",
	"career.savedItems": "offers",
	"career.schedules": "schedules",
	"auth.getProfile": "account",
	"applicationProfile.get": "profile",
	"aiProviders.list": "aiProviders",
	"career.notifications": "notifications",
	"resume.getBySlug": "publicResume",
	"resume.listVersions": "versions",
	"coverLetters.listVersions": "letterVersions",
	"applications.listTrash": "applicationTrash",
	"career.opportunities": "opportunities",
};
export async function invokeFake(operation: string, input: unknown): Promise<unknown> {
	const resource = readPaths[operation];
	if (resource) return fakeBackend.read(resource, input as ResourceInput<typeof resource>);
	state ??= makeState(selected ?? "storyboard");
	const fields = input as Row;
	if (operation === "career.saveSchedule") {
		const current = state.schedules.find((row) => row.id === fields.id);
		const saved = {
			...(current ?? state.schedules[0]),
			...fields,
			id: String(fields.id ?? `schedule-${generation}`),
			userId: "alex",
			updatedAt: now(),
		};
		if (current) Object.assign(current, saved);
		else state.schedules.push(saved as (typeof state.schedules)[number]);
		generation++;
		for (const listener of listeners) listener();
		return saved;
	}
	if (operation === "applications.addNote") {
		const row = state.applications.find((row) => row.id === fields.id);
		if (!row) throw new Error("Fixture application not found.");
		row.activity.push(
			applicationTimelineEntrySchema.parse({
				type: "note",
				id: `note-${generation}`,
				at: now().toISOString(),
				text: fields.text,
			}),
		);
		generation++;
		for (const listener of listeners) listener();
		return structuredClone(row);
	}

	if (operation === "resume.update") {
		const row = state.resumes.find((row) => row.id === fields.id);
		if (!row) throw new Error("Fixture resume not found.");
		if (row.isLocked) throw new Error("Unlock this document before editing.");
		Object.assign(row, fields, { updatedAt: now() });
		return { updatedAt: row.updatedAt };
	}
	if (operation === "coverLetters.update") {
		const row = state.letters.find((row) => row.id === fields.id);
		if (!row) throw new Error("Fixture letter not found.");
		if (row.isLocked) throw new Error("Unlock this document before editing.");
		Object.assign(row, fields, { revision: row.revision + 1, updatedAt: now() });
		return structuredClone(row);
	}
	if (/^(documents|applications)\.(trash|restore|purge|emptyTrash)$/.test(operation)) {
		const [kind, action] = operation.split(".");
		const rows = (kind === "documents" ? state.documents : state.applications) as Row[];
		const targets =
			action === "emptyTrash"
				? rows.filter((row) => row.trashedAt)
				: rows.filter((row) => row.id === fields.id && (kind !== "documents" || row.type === fields.type));
		for (const row of targets) {
			if (row.isLocked) throw new Error("Unlock this document before moving it.");
			if (action === "trash") row.trashedAt = now();
			else if (action === "restore") row.trashedAt = null;
			else if (row.trashedAt) rows.splice(rows.indexOf(row), 1);
		}
		generation++;
		for (const listener of listeners) listener();
		return;
	}
	await fakeBackend.write(operation, input, "storyboard");
	if (operation === "applications.update") {
		const row = state.applications.find((row) => row.id === fields.id);
		if (row && fields.status === "applied") {
			if (fields.resumeId) row.sentResumeVersionId = `sent-${fields.resumeId}-${generation}`;
			if (fields.coverLetterId) row.sentCoverLetterVersionId = `sent-${fields.coverLetterId}-${generation}`;
		}
		return structuredClone(row);
	}
	return;
}
