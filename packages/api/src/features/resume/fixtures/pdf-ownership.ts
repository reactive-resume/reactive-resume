import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { createEntry } from "@reactive-resume/resume/entries";
import { readLegacyDates } from "@reactive-resume/schema/resume/dates";
import { defaultResumeData, sectionDefaults } from "@reactive-resume/schema/resume/default";
import { templateSchema } from "@reactive-resume/schema/templates";

export const ownershipCases = templateSchema.options.flatMap((template) =>
	[
		"default-empty",
		"default-grade",
		"full-before",
		"full-after",
		"two-before",
		"two-after",
		"loose",
		"small",
		"long-identity",
		"custom-links",
	].map((kind) => ({ template, kind })),
);
export function ownershipSource({ kind }: (typeof ownershipCases)[number]): ResumeData {
	const d = structuredClone(defaultResumeData);
	d.picture.hidden = true;
	d.basics = {
		...d.basics,
		name: "Jordan Sample",
		headline: "Product & Platform Lead",
		email: "jordan@example.invalid",
		phone: "+1 (202) 555-0199",
		location: "Singapore",
		website: { url: "https://example.invalid/work", label: "Selected work" },
		customFields:
			kind === "custom-links"
				? [
						{ id: "linkedin", icon: "", text: "linkedin.com/in/jordan", link: "https://linkedin.com/in/jordan" },
						{ id: "github", icon: "", text: "github.com/jordan", link: "https://github.com/jordan" },
					]
				: [],
	};
	d.summary.content = "<p>Berlin-based engineer building accessible platforms.</p>";
	const period = "2012 – 2016";
	const dates = readLegacyDates(period, { locale: "en-US", single: false });
	const values: Record<string, Record<string, unknown>> = {
		experience: {
			company: "eBay",
			position: "Engineer, Platform",
			location: "Remote",
			period: "2020 – 2021",
			dates: { start: "2020", end: "2021", present: false },
			description:
				"<ul><li>Built reliable tools for customers across every supported device.</li><li>Mentored engineers with exact complete wording.</li></ul>",
		},
		education: {
			school: "Synthetic University",
			degree: kind === "full-after" ? "Master of Science" : "BSc",
			area: "Computer Science",
			grade: kind === "default-grade" ? "First class" : "",
			location: "Leeds, UK",
			period,
			dates,
			description: ["default-empty", "full-before", "two-before"].includes(kind)
				? ""
				: "<p>Studied distributed systems and accessible products.</p>",
		},
		projects: {
			name: "Atlas",
			period: "2022 – 2023",
			dates: { start: "2022", end: "2023", present: false },
			description: "<p>Open-source scheduling toolkit.</p>",
		},
		awards: {
			title: "Engineering Prize",
			awarder: "Acme Foundation",
			date: "2019",
			dates: { start: "2019", end: null, present: false },
			description: "<p>Recognized careful platform delivery.</p>",
		},
		certifications: {
			title: "Platform Certification",
			issuer: "Fiction Institute",
			date: "2021",
			dates: { start: "2021", end: null, present: false },
			description: "<p>Verified reliable systems knowledge.</p>",
		},
		publications: {
			title: "Calm Releases",
			publisher: "Technical Journal",
			date: "2020",
			dates: { start: "2020", end: null, present: false },
			description: "<p>Explained practical release methods.</p>",
		},
		volunteer: {
			organization: "Code Club",
			location: "Leeds",
			period: "2015 – 2016",
			dates: { start: "2015", end: "2016", present: false },
			description: "<p>Taught weekly sessions.</p>",
		},
		references: {
			name: "Pat Example",
			position: "CTO",
			phone: "+1 (202) 555-0111",
			description: "<p>Available on request.</p>",
		},
		profiles: {
			network: "LinkedIn",
			username: "jordan",
			website: { url: "https://linkedin.com/in/jordan", label: "Professional profile", inlineLink: false },
		},
		skills: { name: "TypeScript", proficiency: "Advanced", level: 3, keywords: ["Research", "Accessibility"] },
		languages: { language: "German", fluency: "Fluent", level: 3 },
		interests: { name: "Cycling", keywords: ["City routes"] },
	};
	for (const key of Object.keys(d.sections) as (keyof typeof d.sections)[]) {
		const entry = Object.assign(createEntry(key), values[key]);
		if ("website" in entry && key !== "profiles")
			entry.website = { url: `https://example.invalid/${key}`, label: "Details", inlineLink: false };
		d.sections[key].items = [entry] as never;
	}
	const customId = "talks";
	d.customSections = [
		{
			...sectionDefaults(customId),
			id: customId,
			type: "summary",
			title: "SELECTED TALKS",
			items: [
				{ id: "talk-1", hidden: false, content: "<p>Presented accessible engineering at a fictional conference.</p>" },
			],
		},
	];
	const first = kind.endsWith("after") ? ["experience", "education"] : ["education", "experience"];
	const rest = ["projects", "volunteer", "certifications", "publications", "awards", "references", customId];
	if (!kind.startsWith("default"))
		d.metadata.layout.pages = [
			{
				fullWidth: !kind.startsWith("two"),
				main: ["summary", ...first, ...rest],
				sidebar: ["profiles", "skills", "languages", "interests"],
			},
		];
	else d.metadata.layout.pages[0]?.main.push(customId);
	if (!kind.startsWith("default") && !kind.startsWith("two")) {
		const page = d.metadata.layout.pages[0];
		if (page) {
			page.main.push(...page.sidebar);
			page.sidebar = [];
		}
	}
	if (kind === "loose") {
		d.metadata.typography.body.lineHeight = 1.9;
		d.metadata.typography.body.fontSize = 11.5;
	}
	if (kind === "small") {
		d.metadata.typography.body.fontSize = 9;
		d.metadata.typography.body.lineHeight = 1.2;
	}
	if (kind === "long-identity") {
		d.basics.headline =
			"Principal Product Engineer and Accessibility Advocate for Distributed Healthcare Platforms Worldwide";
		d.basics.location = "Washington, D.C., United States of America";
	}
	return d;
}

/** Every data field in these sections is compared; only non-textual identity/style metadata is excluded. */
export function ownershipFields(data: ResumeData): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	const walk = (value: unknown, path: string) => {
		if (Array.isArray(value)) {
			fields[path + ".count"] = value.length;
			value.forEach((item, index) => walk(item, path + "." + index));
			return;
		}
		if (value && typeof value === "object") {
			for (const [key, item] of Object.entries(value)) {
				if (
					[
						"id",
						"hidden",
						"icon",
						"iconColor",
						"inlineLink",
						"columns",
						"keepTogether",
						"startOnNewPage",
						"showHeading",
					].includes(key)
				)
					continue;
				walk(item, path + "." + key);
			}
			return;
		}
		fields[path] = value;
	};
	walk(data.basics, "basics");
	walk({ title: data.summary.title, content: data.summary.content }, "summary");
	for (const [key, section] of Object.entries(data.sections))
		walk({ title: section.title, items: section.items }, "sections." + key);
	walk(data.customSections, "customSections");
	return fields;
}
