import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";

/** Synthetic facts only; timestamps and submitted content remain fixed across seed runs. */
export const fixture = {
	resumes: [
		{
			name: "Beacon variant",
			employer: "Harbor Systems",
			email: "alex.beacon@example.test",
			keywords: ["Python", "Kafka"],
			version: "Beacon baseline",
		},
		{
			name: "Cedar variant",
			employer: "Summit Analytics",
			email: "alex.cedar@example.test",
			keywords: ["Python", "SQL"],
			version: "Cedar baseline",
		},
		{
			name: "Atlas variant",
			employer: "Harbor Systems",
			email: "alex.atlas@example.test",
			keywords: ["Python", "SQL"],
			version: "Atlas baseline",
		},
	],
	letters: [
		{
			name: "Beacon letter",
			resume: 0,
			content: "<p>I improved delivery reliability by 20 percent.</p>",
			letterDate: "2024-09-01",
		},
		{
			name: "Cedar letter",
			resume: 1,
			content: "<p>I reduced reporting time by 35 percent.</p>",
			letterDate: "2024-09-02",
		},
	],
	applications: [
		{
			company: "Beacon Robotics",
			role: "Data Engineer",
			resume: 0,
			letter: 0,
			requirements: ["Python", "Kafka"],
			followUpAt: "2024-09-20T15:00:00.000Z",
			contact: "mara.lin@example.test",
			interview: { at: "2024-09-10T09:00:00-04:00", kind: "technical", durationMinutes: 45 },
		},
		{
			company: "Cedar Analytics",
			role: "Analytics Engineer",
			resume: 1,
			letter: 1,
			requirements: ["Python", "SQL"],
			followUpAt: "2024-09-21T15:00:00.000Z",
			contact: "eli.park@example.test",
			interview: { at: "2024-09-12T14:00:00+02:00", kind: "behavioral", durationMinutes: 60 },
		},
		{
			company: "Atlas Health",
			role: "Platform Engineer",
			resume: 2,
			letter: null,
			requirements: ["Python", "Kubernetes"],
			followUpAt: "2024-09-22T15:00:00.000Z",
			contact: "jo.reed@example.test",
			interview: { at: "2024-09-11T10:00:00Z", kind: "screening", durationMinutes: 30 },
		},
	],
	currentEmployer: "Northwind Labs",
	currentCedarLetter: "<p>I reduced reporting time by 15 percent.</p>",
} as const;

export function resumeData(index: number) {
	const facts = fixture.resumes[index];
	if (!facts) throw new Error("Unknown fixture resume.");
	const data = structuredClone(defaultResumeData);
	data.basics = {
		...data.basics,
		name: "Alex Morgan",
		headline: "Data professional",
		email: facts.email,
		location: "Berlin",
	};
	data.summary.content = "<p>Built reliable data products for international teams.</p>";
	data.sections.experience.items = [
		{
			id: "10000000-0000-4000-8000-000000000001",
			hidden: false,
			company: facts.employer,
			position: "Engineer",
			location: "Berlin",
			period: "2020 – 2024",
			dates: { start: "2020", end: "2024", present: false },
			website: { url: "", label: "", inlineLink: false },
			description: "<p>Built production data pipelines.</p>",
			roles: [],
		},
	];
	data.sections.skills.items = [
		{
			id: "10000000-0000-4000-8000-000000000002",
			hidden: false,
			icon: "",
			iconColor: "",
			name: "Data engineering",
			proficiency: "Advanced",
			level: 4,
			keywords: [...facts.keywords],
		},
	];
	return resumeDataSchema.parse(data);
}
