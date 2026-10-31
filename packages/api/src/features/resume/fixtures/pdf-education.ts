import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { readLegacyDates } from "@reactive-resume/schema/resume/dates";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { templateSchema } from "@reactive-resume/schema/templates";

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
