import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { readLegacyDates } from "@reactive-resume/schema/resume/dates";
import { sectionDefaults } from "@reactive-resume/schema/resume/default";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { templateSchema } from "@reactive-resume/schema/templates";
import { ownershipSource } from "./pdf-ownership";

export const educationCases = templateSchema.options.flatMap((template) =>
	[
		"month-first",
		"year-first",
		"empty-first",
		"reverse",
		"two-single",
		"three-mixed",
		"three-reverse",
		"wrapped",
		"wrapped-empty",
		"linked",
	].map((kind) => ({
		template,
		kind,
	})),
);
export function educationSource({ kind }: (typeof educationCases)[number]): ResumeData {
	const data = structuredClone(defaultResumeData);
	data.picture.hidden = true;
	data.basics = {
		...data.basics,
		name: "Mariana Okafor",
		headline: "Staff Data Engineer",
		email: "mariana@okafor.invalid",
		phone: "+44 20 7946 0958",
		location: "Manchester, UK",
		website: { url: "https://okafor.invalid/", label: "Portfolio" },
	};
	const first =
		kind === "year-first"
			? "2014"
			: kind === "empty-first" || kind === "three-mixed" || kind === "wrapped-empty"
				? ""
				: "May 2014";
	const make = (
		school: string,
		degree: string,
		area: string,
		grade: string,
		location: string,
		period: string,
		description: string,
	) => ({
		id: school,
		hidden: false,
		school,
		degree,
		area,
		grade,
		location,
		period,
		dates: readLegacyDates(period, { locale: "en-US", single: !period.includes("–") }),
		website: { url: "", label: "", inlineLink: false },
		description,
	});
	const a = make(
		"University of California, Berkeley",
		"Bachelor of Science",
		"Electrical Engineering",
		"",
		"Berkeley, CA",
		first,
		"",
	);
	const b = make(
		"Imperial College London",
		"MSc",
		"Data Science",
		"Distinction",
		"London, UK",
		kind === "two-single" ? "2016" : "2015 – 2016",
		"<p>Thesis on exactly-once streaming joins.</p>",
	);
	const c = make(
		"Polytechnic Institute",
		"Certificate",
		"Accessible Computing",
		"Merit",
		"Zürich, CH",
		kind === "three-reverse" ? "" : "Jan 2019",
		"<ul><li>Studied inclusive systems and reliable data.</li><li>Completed independent field research.</li></ul>",
	);
	data.sections.education.items =
		kind === "reverse"
			? [b, a]
			: kind === "three-mixed"
				? [a, c, b]
				: kind === "three-reverse"
					? [b, { ...a, period: "2014", dates: readLegacyDates("2014", { locale: "en-US", single: true }) }, c]
					: [a, b];
	if (kind === "linked") {
		a.degree = "Bachelor of Engineering (Honours)";
		a.website = { url: "https://example.invalid/education", label: "Details", inlineLink: false };
		data.metadata.layout.pages = [{ fullWidth: false, main: ["education"], sidebar: ["skills"] }];
		data.sections.skills.items = [
			{
				id: "skill",
				hidden: false,
				icon: "",
				iconColor: "",
				name: "SQL",
				proficiency: "Expert",
				level: 0,
				keywords: [],
			},
		];
	}
	if (kind.startsWith("wrapped")) {
		a.degree = "Bachelor of Engineering (Honours)";
		data.metadata.typography.body.fontSize = 11.5;
		data.metadata.typography.body.lineHeight = 1.9;
		data.metadata.layout.pages = [{ fullWidth: false, main: ["education"], sidebar: ["skills"] }];
		data.sections.skills.items = [
			{
				id: "skill",
				hidden: false,
				icon: "",
				iconColor: "",
				name: "SQL",
				proficiency: "Expert",
				level: 0,
				keywords: [],
			},
		];
	}
	return data;
}
export const educationFields = (items: ResumeData["sections"]["education"]["items"]) =>
	items.map(({ school, degree, area, grade, location, period, dates, website, description }) => ({
		school,
		degree,
		area,
		grade,
		location,
		period,
		dates,
		website,
		description,
	}));
/** Every authored word in Education must remain somewhere in stored Education, even when mapping is uncertain. */
export function educationWords(items: ResumeData["sections"]["education"]["items"]) {
	return (
		educationFields(items)
			.flatMap((item) => [
				item.school,
				item.degree,
				item.area,
				item.grade,
				item.location,
				item.period,
				item.description.replace(/<[^>]+>/g, " "),
			])
			.join(" ")
			.match(/[\p{L}\p{N}]+/gu) ?? []
	);
}

export const educationOwnershipCases = templateSchema.options.flatMap((template) =>
	["full-before", "two-before"].flatMap((layout) =>
		["distinct", "identical", "substring-short", "substring-long", "mentioned", "three-runs"].map((kind) => ({
			template,
			layout,
			kind,
		})),
	),
);

export function educationOwnershipSource({ template, layout, kind }: (typeof educationOwnershipCases)[number]) {
	const source = ownershipSource({ template, kind: layout });
	const first = source.sections.education.items[0];
	const page = source.metadata.layout.pages[0];
	if (!first || !page) throw new Error("Missing Education fixture");
	if (kind === "substring-short") first.school = "Leeds College";
	if (kind === "substring-long") first.school = "Leeds College of Art";
	const second = {
		...structuredClone(first),
		id: "qualification-1",
		school:
			kind === "identical" || kind === "three-runs"
				? first.school
				: kind === "substring-short"
					? "Leeds College of Art"
					: kind === "substring-long"
						? "Leeds College"
						: "Northfield Institute",
		degree: "PGCert",
		area: "Teaching",
		location: "York, UK",
		period: "2018 – 2019",
		dates: readLegacyDates("2018 – 2019", { locale: "en-US", single: false }),
		website: { url: "https://example.invalid/quals", label: "Details", inlineLink: false },
		description:
			kind === "mentioned"
				? `<p>Evening programme accredited by ${first.school}.</p>`
				: "<p>Evening programme in adult education.</p>",
	};
	const add = (id: string, title: string, item: typeof second) => {
		source.customSections.push({ ...sectionDefaults(id), id, type: "education", title, items: [item] });
		page.main.splice(page.main.indexOf("education") + 1, 0, id);
	};
	add("quals", "Qualifications", second);
	if (kind === "three-runs") {
		source.sections.education.items.push({
			...structuredClone(second),
			id: "masters",
			degree: "MSc",
			area: "Data Science",
			website: { ...second.website, url: "https://example.invalid/masters" },
		});
		add("training", "Education and Training", {
			...structuredClone(second),
			id: "training-cert",
			degree: "Certificate",
			area: "Accessible Computing",
			website: { ...second.website, url: "https://example.invalid/training" },
		});
	}
	return source;
}
