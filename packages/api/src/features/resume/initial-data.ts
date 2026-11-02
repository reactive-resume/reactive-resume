import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import type { Locale } from "@reactive-resume/utils/locale";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { EMPTY_SEMANTIC_CSS_SOURCE } from "@reactive-resume/schema/resume/stylesheet";

const LETTER_LOCALES: ReadonlySet<string> = new Set(["en-US", "en-CA", "es-MX", "fr-CA"]);

type CreateResumeDataOptions = {
	withSampleData?: boolean;
	/** The person the resume is for, printed as its name: the account holder's name, not the document's. */
	name?: string;
	/** The account's email, for the contact line of a blank resume. */
	email?: string | undefined;
	locale?: Locale;
	template?: Template | undefined;
};

export function createResumeData(options: CreateResumeDataOptions): ResumeData {
	const data = structuredClone(options.withSampleData ? sampleResumeData : defaultResumeData);

	// A sample keeps its fictional person: printing the account's name (or "Guest") on someone else's career misleads.
	const name = options.name?.trim();
	if (name && !options.withSampleData) data.basics.name = name;
	// A sample keeps its own fictional contact details.
	const email = options.email?.trim();
	if (email && !options.withSampleData) data.basics.email = email;
	if (options.locale) data.metadata.page.locale = options.locale;
	if (!options.withSampleData) {
		// A blank resume starts on choices Design offers (the Balanced pairing, the Ink blue accent), so its first visit
		// shows them selected rather than reading as something custom.
		data.metadata.typography.heading.fontFamily = "Source Serif 4";
		data.metadata.typography.heading.fontWeights = ["600"];
		data.metadata.typography.body.fontFamily = "Source Sans 3";
		data.metadata.typography.body.fontWeights = ["400", "700"];
		data.metadata.design.colors.primary = "rgba(47, 90, 138, 1)";
		// Where Letter is the paper people print on.
		if (options.locale && LETTER_LOCALES.has(options.locale)) data.metadata.page.format = "letter";
	}
	if (options.template) data.metadata.template = options.template;
	data.metadata.stylesheet = {
		mode: "semantic",
		source: { languageVersion: 1, text: EMPTY_SEMANTIC_CSS_SOURCE },
	};

	return data;
}
