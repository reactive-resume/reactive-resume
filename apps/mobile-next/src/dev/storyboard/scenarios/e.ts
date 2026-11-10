import type { Scenario } from "../harness";
// Storyboard scenarios owned by screen agent E (see PLAN.md): Applications (J1–J9) and the application workspace
// (W1–W5). `prepare` fills in what the shared storyboard fixture doesn't carry yet (contacts, interview details,
// stage history, follow-ups), through the fake backend's own write path.
import { overBackdrop } from "../backdrop";
import { invokeFake } from "@/data/fixtures";

type Fields = Record<string, unknown>;
const update = (id: string, fields: Fields) => invokeFake("applications.update", { id, ...fields });
const stage = (id: string, stageName: string, at: string) => ({
	id,
	type: "stage",
	stage: stageName,
	at: new Date(at),
});

async function seedApplications(overrides: Record<string, Fields> = {}) {
	const lumen = {
		location: "Lisbon · Hybrid",
		contacts: [
			{ name: "Priya Raman", role: "Design lead", type: "Hiring Manager", email: "", phone: "" },
			{ name: "Tomás Silva", role: "Staff designer", type: "", email: "", phone: "" },
		],
		activity: [
			stage("lumen-saved", "saved", "2026-10-24T12:00:00Z"),
			stage("lumen-applied", "applied", "2026-11-02T12:00:00Z"),
			stage("lumen-interview-stage", "interview", "2026-11-06T12:00:00Z"),
			{
				id: "lumen-interview",
				type: "interview",
				at: new Date("2026-11-10T10:00:00+01:00"),
				kind: "technical",
				durationMinutes: 45,
				location: "meet.lumen.com/design-loop",
				notes: "",
				participants: [
					{ name: "Priya Raman", role: "" },
					{ name: "Tomás Silva", role: "" },
				],
				audience: "panel",
				timezone: "Europe/Berlin",
			},
			...[
				"Ask about the design system roadmap",
				"Bring the onboarding case study",
				"Salary range from the recruiter",
			].map((text, i) => ({ id: `lumen-note-${i}`, type: "note", at: new Date("2026-11-05T12:00:00Z"), text })),
		],
		sentResumeVersionId: "sent-resume-lumen",
		sentCoverLetterVersionId: "sent-letter-0",
		sourceUrl: "https://lumen.com/careers",
		...overrides.lumen,
	};
	await update("lumen", lumen);
	await update("orbital-health", {
		status: "interview",
		role: "Product designer",
		activity: [
			stage("orbital-applied", "applied", "2026-11-01T12:00:00Z"),
			stage("orbital-interview-stage", "interview", "2026-11-05T12:00:00Z"),
			{
				id: "orbital-health-interview",
				type: "interview",
				at: new Date("2026-11-09T15:30:00+01:00"),
				kind: "screening",
				durationMinutes: 30,
				location: "",
				notes: "",
				participants: [],
				audience: "recruiter",
				timezone: "Europe/Berlin",
			},
		],
		...overrides["orbital-health"],
	});
	await update("parcel", {
		role: "Lead designer",
		activity: [
			stage("parcel-applied", "applied", "2026-10-20T12:00:00Z"),
			stage("parcel-offer", "offer", "2026-11-04T12:00:00Z"),
		],
		...overrides.parcel,
	});
	await update("fieldnote", {
		role: "Design systems designer",
		appliedAt: new Date("2026-10-28T08:00:00Z"),
		activity: [stage("fieldnote-applied", "applied", "2026-10-28T08:00:00Z")],
		followUpAt: new Date("2026-11-10T17:00:00+01:00"),
		followUpNote: null,
		contacts: [
			{ name: "Joana Reis", role: "Recruiter", type: "Recruiter", email: "joana@fieldnote.example", phone: "" },
		],
		...overrides.fieldnote,
	});
	await update("kiln", {
		appliedAt: new Date("2026-11-04T12:00:00Z"),
		activity: [stage("kiln-applied", "applied", "2026-11-04T12:00:00Z")],
		...overrides.kiln,
	});
}

/** J1 draws only the five open applications; the seed's closed ones (J4's outcomes) are not on its board. */
async function onlyOpenApplications() {
	await seedApplications();
	const apps = (await invokeFake("applications.list", {})) as { id: string; status: string }[];
	for (const app of apps.filter((row) => row.status === "closed"))
		await update(app.id, { trashedAt: new Date("2026-11-06T10:00:00Z") });
}

/** Maestro flows only: Kiln Studio not yet sent, so every route to Applied (swipe, board drop) can be tried. */
const kilnSaved = { kiln: { status: "saved", laneId: "saved", appliedAt: null, activity: [] } };

const tab = "/applications";
const lumen = "/applications/lumen";

export const scenarios: Record<string, Scenario> = {
	"J1-List": { hrefs: [`${tab}?view=list`], prepare: onlyOpenApplications },
	// Not storyboard screens: the J1 list and J2 board with Kiln Studio Saved (behaviour/applied-swipe, applied-board).
	"J1-KilnSaved": {
		hrefs: [`${tab}?view=list`],
		prepare: async () => {
			await onlyOpenApplications();
			await update("kiln", kilnSaved.kiln);
		},
	},
	"J2-KilnSaved": {
		hrefs: [`${tab}?view=board&stage=saved`],
		prepare: async () => {
			await seedApplications(kilnSaved);
		},
	},
	"J2-Board": { hrefs: [`${tab}?view=board&stage=interview`], prepare: () => seedApplications() },
	"J3-Calendar": { hrefs: [`${tab}?view=calendar&day=2026-11-10`], prepare: () => seedApplications() },
	// The shared seed already carries J4's 18 sent applications; seedApplications' J6 history would add an interview.
	"J4-Insights": { hrefs: [tab, "/applications/insights?range=90"] },
	"J5-SaveJob": {
		hrefs: [
			tab,
			"/applications/new?url=https%3A%2F%2Flumen.jobs%2Froles%2Fsenior-product-designer&role=Senior%20product%20designer&company=Lumen&location=Lisbon%20%C2%B7%20Hybrid",
		],
	},
	"J6-Detail": { hrefs: [tab, lumen], prepare: () => seedApplications() },
	"J7-Stage": { hrefs: [tab, ...overBackdrop("J7-Stage", `${lumen}/stage`)], prepare: () => seedApplications() },
	"J8-Interview": {
		hrefs: [tab, ...overBackdrop("J8-Interview", `${lumen}/interview?interview=lumen-interview`)],
		prepare: () => seedApplications(),
	},
	// Not a storyboard screen: the Maestro flow for J8's repeated hour (behaviour/j8-repeated-hour.yaml). An interview
	// on the night clocks go back in Berlin, so the system picker opens at 25 Oct 02:30, the hour that happens twice.
	"J8-RepeatedHour": {
		hrefs: [tab, ...overBackdrop("J8-Interview", `${lumen}/interview?interview=lumen-dst`)],
		prepare: async () => {
			await seedApplications();
			const app = (await invokeFake("applications.getById", { id: "lumen" })) as { activity: Fields[] };
			await update("lumen", {
				activity: [
					...app.activity,
					{
						id: "lumen-dst",
						type: "interview",
						at: new Date("2026-10-25T02:30:00+02:00"),
						kind: "screening",
						durationMinutes: 30,
						location: "",
						notes: "",
						participants: [],
						timezone: "Europe/Berlin",
					},
				],
			});
		},
	},
	"J9-Close": {
		hrefs: [tab, ...overBackdrop("J9-Close", "/applications/parcel/stage?step=close")],
		prepare: () => seedApplications({ parcel: { role: "Product designer", location: "Lisbon" } }),
	},
	"W1-Fit": { hrefs: [tab, lumen, `${lumen}/fit`], prepare: () => seedApplications() },
	"W2-Apply": { hrefs: [tab, lumen, `${lumen}/apply`], prepare: () => seedApplications() },
	"W3-Prep": {
		hrefs: [tab, lumen, `${lumen}/prepare`],
		prepare: async () => {
			await seedApplications();
			await invokeFake("career.saveWorkspace", {
				applicationId: "lumen",
				questions: [{ text: "Who owns the design system day to day?", origin: "From Fit" }],
			});
		},
	},
	"W4-Practice": { hrefs: [tab, lumen, `${lumen}/practise`], prepare: () => seedApplications() },
	"W5-Messages": {
		hrefs: [tab, "/applications/fieldnote", "/applications/fieldnote/messages"],
		prepare: () => seedApplications(),
	},
};
