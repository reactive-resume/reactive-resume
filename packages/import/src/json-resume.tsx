import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { ZodError, z } from "zod";
import { getNetworkIcon } from "@reactive-resume/resume/icons";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { generateId } from "@reactive-resume/utils/string";
import { formatPeriod, formatSingleDate } from "./date";
import { rethrowAsImportError } from "./error";
import { arrayToHtmlList, toHtmlDescription } from "./html";
import { parseLevel } from "./level";

const createUrl = (url?: string, label?: string): { url: string; label: string } => {
	if (!url) return { url: "", label: "" };
	return { url, label: label || url };
};

const createItemWebsite = (url?: string, label?: string) => ({
	...createUrl(url, label),
	inlineLink: false,
});

// Custom ISO 8601 date pattern that allows partial dates (year only, year-month, or full date)
const iso8601 = z
	.string()
	.regex(
		/^([1-2][0-9]{3}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])|[1-2][0-9]{3}-(?:0[1-9]|1[0-2])|[1-2][0-9]{3})$/,
		"Must be a valid ISO 8601 date (YYYY, YYYY-MM, or YYYY-MM-DD)",
	);

const locationSchema = z.looseObject({
	address: z.string().optional(),
	postalCode: z.string().optional(),
	city: z.string().optional(),
	countryCode: z.string().optional(),
	region: z.string().optional(),
});

const profileSchema = z.looseObject({
	network: z.string().optional(),
	username: z.string().optional(),
	url: z.url().optional(),
});

const basicsSchema = z.looseObject({
	name: z.string().optional(),
	label: z.string().optional(),
	image: z.string().optional(),
	email: z.email().optional(),
	phone: z.string().optional(),
	url: z.url().optional(),
	summary: z.string().optional(),
	location: locationSchema.optional(),
	profiles: z.array(profileSchema).optional(),
});

const workSchema = z.looseObject({
	name: z.string().optional(),
	location: z.string().optional(),
	description: z.string().optional(),
	position: z.string().optional(),
	url: z.url().optional(),
	startDate: iso8601.optional(),
	endDate: iso8601.optional(),
	summary: z.string().optional(),
	highlights: z.array(z.string()).optional(),
});

const volunteerSchema = z.looseObject({
	organization: z.string().optional(),
	position: z.string().optional(),
	url: z.url().optional(),
	startDate: iso8601.optional(),
	endDate: iso8601.optional(),
	summary: z.string().optional(),
	highlights: z.array(z.string()).optional(),
});

const educationSchema = z.looseObject({
	institution: z.string().optional(),
	url: z.url().optional(),
	area: z.string().optional(),
	studyType: z.string().optional(),
	startDate: iso8601.optional(),
	endDate: iso8601.optional(),
	score: z.string().optional(),
	courses: z.array(z.string()).optional(),
});

const awardSchema = z.looseObject({
	title: z.string().optional(),
	date: iso8601.optional(),
	awarder: z.string().optional(),
	summary: z.string().optional(),
});

const certificateSchema = z.looseObject({
	name: z.string().optional(),
	date: iso8601.optional(),
	url: z.url().optional(),
	issuer: z.string().optional(),
});

const publicationSchema = z.looseObject({
	name: z.string().optional(),
	publisher: z.string().optional(),
	releaseDate: iso8601.optional(),
	url: z.url().optional(),
	summary: z.string().optional(),
});

const skillSchema = z.looseObject({
	name: z.string().optional(),
	level: z.string().optional(),
	keywords: z.array(z.string()).optional(),
});

const languageSchema = z.looseObject({
	language: z.string().optional(),
	fluency: z.string().optional(),
});

const interestSchema = z.looseObject({
	name: z.string().optional(),
	keywords: z.array(z.string()).optional(),
});

const referenceSchema = z.looseObject({
	name: z.string().optional(),
	reference: z.string().optional(),
});

const projectSchema = z.looseObject({
	name: z.string().optional(),
	description: z.string().optional(),
	highlights: z.array(z.string()).optional(),
	keywords: z.array(z.string()).optional(),
	startDate: iso8601.optional(),
	endDate: iso8601.optional(),
	url: z.url().optional(),
	roles: z.array(z.string()).optional(),
	entity: z.string().optional(),
	type: z.string().optional(),
});

const metaSchema = z.looseObject({
	canonical: z.url().optional(),
	version: z.string().optional(),
	lastModified: z.string().optional(),
});

const jsonResumeSchema = z.looseObject({
	$schema: z.url().optional(),
	basics: basicsSchema.optional(),
	work: z.array(workSchema).optional(),
	volunteer: z.array(volunteerSchema).optional(),
	education: z.array(educationSchema).optional(),
	awards: z.array(awardSchema).optional(),
	certificates: z.array(certificateSchema).optional(),
	publications: z.array(publicationSchema).optional(),
	skills: z.array(skillSchema).optional(),
	languages: z.array(languageSchema).optional(),
	interests: z.array(interestSchema).optional(),
	references: z.array(referenceSchema).optional(),
	projects: z.array(projectSchema).optional(),
	meta: metaSchema.optional(),
});

type JSONResume = z.infer<typeof jsonResumeSchema>;

// ponytail: stateless two-method class → two plain functions
function convertJSONResume(jsonResume: JSONResume): ResumeData {
	const result: ResumeData = {
		...defaultResumeData,
	};

	// Map basics
	if (jsonResume.basics) {
		const basics = jsonResume.basics;
		result.basics = {
			name: basics.name || "",
			headline: basics.label || "",
			email: basics.email || "",
			phone: basics.phone || "",
			location: [basics.location?.city, basics.location?.region, basics.location?.countryCode]
				.filter(Boolean)
				.join(", "),
			website: createUrl(basics.url),
			customFields: [],
		};

		// Map image to picture
		if (basics.image) {
			result.picture = {
				...defaultResumeData.picture,
				url: basics.image,
				hidden: false,
			};
		}
	}

	// Map summary
	if (jsonResume.basics?.summary) {
		result.summary = {
			...defaultResumeData.summary,
			content: `<p>${jsonResume.basics.summary}</p>`,
			hidden: false,
		};
	}

	// Map work to experience
	if (jsonResume.work && jsonResume.work.length > 0) {
		result.sections.experience = {
			...defaultResumeData.sections.experience,
			items: jsonResume.work
				.filter((work) => work.name || work.position)
				.map((work) => ({
					id: generateId(),
					hidden: false,
					company: work.name || "",
					position: work.position || "",
					location: work.location || "",
					period: formatPeriod(work.startDate, work.endDate),
					website: createItemWebsite(work.url),
					roles: [],
					description: toHtmlDescription(work.summary, work.highlights),
				})),
		};
	}

	// Map education
	if (jsonResume.education && jsonResume.education.length > 0) {
		result.sections.education = {
			...defaultResumeData.sections.education,
			items: jsonResume.education
				.filter((edu) => edu.institution)
				.map((edu) => ({
					id: generateId(),
					hidden: false,
					school: edu.institution || "",
					degree: [edu.studyType, edu.area].filter(Boolean).join(" in ") || "",
					area: edu.area || "",
					grade: edu.score || "",
					location: "",
					period: formatPeriod(edu.startDate, edu.endDate),
					website: createItemWebsite(edu.url),
					description: edu.courses && edu.courses.length > 0 ? arrayToHtmlList(edu.courses) : "",
				})),
		};
	}

	// Map projects
	if (jsonResume.projects && jsonResume.projects.length > 0) {
		result.sections.projects = {
			...defaultResumeData.sections.projects,
			items: jsonResume.projects
				.filter((project) => project.name)
				.map((project) => ({
					id: generateId(),
					hidden: false,
					name: project.name || "",
					period: formatPeriod(project.startDate, project.endDate),
					website: createItemWebsite(project.url),
					description: toHtmlDescription(project.description, project.highlights),
				})),
		};
	}

	// Map skills
	if (jsonResume.skills && jsonResume.skills.length > 0) {
		result.sections.skills = {
			...defaultResumeData.sections.skills,
			items: jsonResume.skills
				.filter((skill) => skill.name)
				.map((skill) => ({
					id: generateId(),
					hidden: false,
					icon: "star",
					iconColor: "",
					name: skill.name || "",
					proficiency: skill.level || "",
					level: parseLevel(skill.level),
					keywords: skill.keywords || [],
				})),
		};
	}

	// Map languages
	if (jsonResume.languages && jsonResume.languages.length > 0) {
		result.sections.languages = {
			...defaultResumeData.sections.languages,
			items: jsonResume.languages
				.filter((lang) => lang.language)
				.map((lang) => ({
					id: generateId(),
					hidden: false,
					language: lang.language || "",
					fluency: lang.fluency || "",
					level: parseLevel(lang.fluency),
				})),
		};
	}

	// Map interests
	if (jsonResume.interests && jsonResume.interests.length > 0) {
		result.sections.interests = {
			...defaultResumeData.sections.interests,
			items: jsonResume.interests
				.filter((interest) => interest.name)
				.map((interest) => ({
					id: generateId(),
					hidden: false,
					icon: "star",
					iconColor: "",
					name: interest.name || "",
					keywords: interest.keywords || [],
				})),
		};
	}

	// Map awards
	if (jsonResume.awards && jsonResume.awards.length > 0) {
		result.sections.awards = {
			...defaultResumeData.sections.awards,
			items: jsonResume.awards
				.filter((award) => award.title)
				.map((award) => ({
					id: generateId(),
					hidden: false,
					title: award.title || "",
					awarder: award.awarder || "",
					date: formatSingleDate(award.date),
					website: createItemWebsite(),
					description: award.summary ? `<p>${award.summary}</p>` : "",
				})),
		};
	}

	// Map certificates
	if (jsonResume.certificates && jsonResume.certificates.length > 0) {
		result.sections.certifications = {
			...defaultResumeData.sections.certifications,
			items: jsonResume.certificates
				.filter((cert) => cert.name)
				.map((cert) => ({
					id: generateId(),
					hidden: false,
					title: cert.name || "",
					issuer: cert.issuer || "",
					date: formatSingleDate(cert.date),
					website: createItemWebsite(cert.url),
					description: "",
				})),
		};
	}

	// Map publications
	if (jsonResume.publications && jsonResume.publications.length > 0) {
		result.sections.publications = {
			...defaultResumeData.sections.publications,
			items: jsonResume.publications
				.filter((pub) => pub.name)
				.map((pub) => ({
					id: generateId(),
					hidden: false,
					title: pub.name || "",
					publisher: pub.publisher || "",
					date: formatSingleDate(pub.releaseDate),
					website: createItemWebsite(pub.url),
					description: pub.summary ? `<p>${pub.summary}</p>` : "",
				})),
		};
	}

	// Map volunteer
	if (jsonResume.volunteer && jsonResume.volunteer.length > 0) {
		result.sections.volunteer = {
			...defaultResumeData.sections.volunteer,
			items: jsonResume.volunteer
				.filter((vol) => vol.organization)
				.map((vol) => ({
					id: generateId(),
					hidden: false,
					organization: vol.organization || "",
					location: "",
					period: formatPeriod(vol.startDate, vol.endDate),
					website: createItemWebsite(vol.url),
					description: toHtmlDescription(vol.summary, vol.highlights),
				})),
		};
	}

	// Map references
	if (jsonResume.references && jsonResume.references.length > 0) {
		result.sections.references = {
			...defaultResumeData.sections.references,
			items: jsonResume.references
				.filter((ref) => ref.name || ref.reference)
				.map((ref) => ({
					id: generateId(),
					hidden: false,
					name: ref.name || "",
					position: "",
					website: createItemWebsite(),
					phone: "",
					description: ref.reference ? `<p>${ref.reference}</p>` : "",
				})),
		};
	}

	// Map profiles (from basics.profiles) to profiles section
	if (jsonResume.basics?.profiles && jsonResume.basics.profiles.length > 0) {
		result.sections.profiles = {
			...defaultResumeData.sections.profiles,
			items: jsonResume.basics.profiles
				.filter((profile) => profile.network)
				.map((profile) => ({
					id: generateId(),
					hidden: false,
					icon: getNetworkIcon(profile.network),
					iconColor: "",
					network: profile.network || "",
					username: profile.username || "",
					website: createItemWebsite(profile.url, profile.username || profile.network),
				})),
		};
	}

	return resumeDataSchema.parse(result);
}

export function parseJSONResume(json: string): ResumeData {
	try {
		const jsonResume = jsonResumeSchema.parse(JSON.parse(json));
		return convertJSONResume(jsonResume);
	} catch (error) {
		if (error instanceof ZodError) rethrowAsImportError(error);
		throw error;
	}
}
