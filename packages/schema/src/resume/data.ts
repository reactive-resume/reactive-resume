import z from "zod";
import { templateSchema } from "../templates";
import { dateFormatSchema, resumeDatesSchema, syncResumeDates, upgradeResumeDates } from "./dates";
import { semanticStylesheetSchema } from "./stylesheet";

const iconSchema = z
	.string()
	.describe(
		"The icon to display for the custom field. Must be a valid icon name from @phosphor-icons/web icon set, or an empty string to hide. Default to '' (empty string) when unsure which icons are available.",
	);

const iconColorSchema = z
	.string()
	.catch("")
	.describe(
		"Custom color for the icon, defined as rgba(r, g, b, a). Leave blank to use the template default icon color.",
	);

export const websiteSchema = z.object({
	url: z.string().describe("The URL to show as a link. Must be a valid URL with a protocol (http:// or https://)."),
	label: z.string().describe("The label to display for the URL. Leave blank to display the URL as-is."),
});

const itemWebsiteSchema = websiteSchema
	.extend({
		inlineLink: z
			.boolean()
			.catch(false)
			.describe(
				"If true, the website URL is rendered as a hyperlink on the title instead of a separate link at the bottom.",
			),
	})
	.catch({ url: "", label: "", inlineLink: false });

export const pictureSchema = z.object({
	hidden: z.boolean().describe("Whether to hide the picture from the resume."),
	fit: z
		.enum(["cover", "contain"])
		.catch("cover")
		.describe("How the picture fits its frame: cover crops overflow, while contain preserves the whole image."),
	url: z
		.string()
		.describe(
			"The URL to the picture to display on the resume. Prefer local app-served paths (for example /uploads/...) populated via upload.",
		),
	size: z
		.number()
		.min(32)
		.max(512)
		.describe("The size of the picture to display on the resume, defined in points (pt)."),
	rotation: z
		.number()
		.min(0)
		.max(360)
		.describe("The rotation of the picture to display on the resume, defined in degrees (°)."),
	aspectRatio: z
		.number()
		.min(0.5)
		.max(2.5)
		.describe(
			"The aspect ratio of the picture to display on the resume, defined as width / height (e.g. 1.5 for 1.5:1 or 0.5 for 1:2).",
		),
	borderRadius: z
		.number()
		.min(0)
		.max(100)
		.describe("The border radius of the picture to display on the resume, defined in points (pt)."),
	borderColor: z
		.string()
		.describe("The color of the border of the picture to display on the resume, defined as rgba(r, g, b, a)."),
	borderWidth: z
		.number()
		.min(0)
		.describe("The width of the border of the picture to display on the resume, defined in points (pt)."),
	shadowColor: z
		.string()
		.describe("The color of the shadow of the picture to display on the resume, defined as rgba(r, g, b, a)."),
	shadowWidth: z
		.number()
		.min(0)
		.describe("The width of the shadow of the picture to display on the resume, defined in points (pt)."),
});

export const customFieldSchema = z.object({
	id: z.string().describe("The unique identifier for the custom field. Usually generated as a UUID."),
	icon: iconSchema,
	text: z.string().describe("The text to display for the custom field."),
	link: z.string().describe("If the custom field should be a link, the URL to link to.").catch(""),
});

export const basicsSchema = z.object({
	name: z.string().describe("The full name of the author of the resume."),
	headline: z.string().describe("The headline of the author of the resume."),
	email: z.string().describe("The email address of the author of the resume."),
	phone: z.string().describe("The phone number of the author of the resume."),
	location: z.string().describe("The location of the author of the resume."),
	website: websiteSchema.describe("The website of the author of the resume."),
	customFields: z.array(customFieldSchema).describe("The custom fields to display on the resume."),
});

export const summarySchema = z.object({
	title: z.string().describe("The title of the summary of the resume."),
	icon: z
		.string()
		.catch("")
		.describe(
			"Phosphor icon name to display before the summary section title in the PDF output. Empty string uses the default summary icon; 'none' hides the icon.",
		),
	columns: z.number().int().min(1).max(6).catch(1).describe("The number of columns the summary should span across."),
	hidden: z.boolean().describe("Whether to hide the summary from the resume."),
	showHeading: z
		.boolean()
		.optional()
		.catch(true)
		.describe("Whether to show the summary heading, icon, and decoration while retaining summary content."),
	keepTogether: z
		.boolean()
		.catch(false)
		.describe("If true, the summary is kept on a single page instead of splitting across a page break."),
	startOnNewPage: z.boolean().catch(false).describe("If true, the summary always begins on a new page."),
	content: z.string().describe("The content of the summary of the resume. This should be a HTML-formatted string."),
});

const baseItemSchema = z.object({
	id: z.string().describe("The unique identifier for the item. Usually generated as a UUID."),
	hidden: z.boolean().describe("Whether to hide the item from the resume."),
});

export const summaryItemSchema = baseItemSchema.extend({
	content: z.string().describe("The rich text content of the summary item. This should be a HTML-formatted string."),
});

export type SummaryItem = z.infer<typeof summaryItemSchema>;

export const awardItemSchema = baseItemSchema.extend({
	title: z.string().describe("The title of the award. Empty while the entry is a draft, which isn't printed."),
	awarder: z.string().describe("The awarder of the award."),
	date: z
		.string()
		.describe(
			"The date when the award was received, as text. Written from `dates` on every save; write `dates` instead.",
		),
	dates: resumeDatesSchema.optional(),
	website: itemWebsiteSchema.describe("The website of the award, if any."),
	description: z.string().describe("The description of the award. This should be a HTML-formatted string."),
});

export const certificationItemSchema = baseItemSchema.extend({
	title: z.string().describe("The title of the certification. Empty while the entry is a draft, which isn't printed."),
	issuer: z.string().describe("The issuer of the certification."),
	date: z
		.string()
		.describe(
			"The date when the certification was received, as text. Written from `dates` on every save; write `dates` instead.",
		),
	dates: resumeDatesSchema.optional(),
	website: itemWebsiteSchema.describe("The website of the certification, if any."),
	description: z.string().describe("The description of the certification. This should be a HTML-formatted string."),
});

export const educationItemSchema = baseItemSchema.extend({
	school: z
		.string()
		.describe("The name of the school or institution. Empty while the entry is a draft, which isn't printed."),
	degree: z.string().describe("The degree or qualification obtained."),
	area: z.string().describe("The area of study or specialization."),
	grade: z.string().describe("The grade or score achieved."),
	location: z.string().describe("The location of the school or institution."),
	period: z
		.string()
		.describe(
			"The period of time the education was obtained over, as text. Written from `dates` on every save; write `dates` instead.",
		),
	dates: resumeDatesSchema.optional(),
	website: itemWebsiteSchema.describe("The website of the school or institution, if any."),
	description: z.string().describe("The description of the education. This should be a HTML-formatted string."),
});

const roleItemSchema = z.object({
	id: z.string().describe("The unique identifier for the role. Usually generated as a UUID."),
	position: z.string().describe("The position or job title for this role."),
	period: z
		.string()
		.describe(
			"The period of time this role was held, as text. Written from `dates` on every save; write `dates` instead.",
		),
	dates: resumeDatesSchema.optional(),
	description: z.string().describe("The description of this specific role. This should be a HTML-formatted string."),
});

export type RoleItem = z.infer<typeof roleItemSchema>;

export const experienceItemSchema = baseItemSchema.extend({
	company: z
		.string()
		.describe("The name of the company or organization. Empty while the entry is a draft, which isn't printed."),
	position: z
		.string()
		.describe(
			"The position held at the company or organization. Used when there is only a single role. If multiple roles are provided in the 'roles' field, this serves as a summary title or can be left blank.",
		),
	location: z.string().describe("The location of the company or organization."),
	period: z
		.string()
		.describe(
			"The overall period of time at the company, as text. When multiple roles are used, this should reflect the total tenure. Written from `dates` on every save; write `dates` instead.",
		),
	dates: resumeDatesSchema.optional(),
	website: itemWebsiteSchema.describe("The website of the company or organization, if any."),
	description: z.string().describe("The description of the experience. This should be a HTML-formatted string."),
	roles: z
		.array(roleItemSchema)
		.catch([])
		.describe("List of individual roles held at this company to show career progression."),
});

export const interestItemSchema = baseItemSchema.extend({
	icon: iconSchema,
	iconColor: iconColorSchema,
	name: z.string().describe("The name of the interest/hobby. Empty while the entry is a draft, which isn't printed."),
	keywords: z
		.array(z.string())
		.catch([])
		.describe("The keywords associated with the interest/hobby, if any. These are displayed as tags below the name."),
});

export const languageItemSchema = baseItemSchema.extend({
	language: z
		.string()
		.describe("The name of the language the author knows. Empty while the entry is a draft, which isn't printed."),
	fluency: z
		.string()
		.describe(
			"The fluency level of the language. Can be any text, such as 'Native', 'Fluent', 'Conversational', etc. or can also be a CEFR level (A1, A2, B1, B2, C1, C2).",
		),
	level: z
		.number()
		.min(0)
		.max(5)
		.catch(0)
		.describe(
			"The proficiency level of the language, defined as a number between 0 and 5. If set to 0, the icons displaying the level will be hidden.",
		),
});

export const profileItemSchema = baseItemSchema.extend({
	icon: iconSchema,
	iconColor: iconColorSchema,
	network: z
		.string()
		.describe("The name of the network or platform. Empty while the entry is a draft, which isn't printed."),
	username: z.string().describe("The username of the author on the network or platform."),
	website: itemWebsiteSchema.describe("The link to the profile of the author on the network or platform, if any."),
});

export const projectItemSchema = baseItemSchema.extend({
	name: z.string().describe("The name of the project. Empty while the entry is a draft, which isn't printed."),
	period: z
		.string()
		.describe(
			"The period of time the project was worked on, as text. Written from `dates` on every save; write `dates` instead.",
		),
	dates: resumeDatesSchema.optional(),
	website: itemWebsiteSchema.describe("The link to the project, if any."),
	description: z.string().describe("The description of the project. This should be a HTML-formatted string."),
});

export const publicationItemSchema = baseItemSchema.extend({
	title: z.string().describe("The title of the publication. Empty while the entry is a draft, which isn't printed."),
	publisher: z.string().describe("The publisher of the publication."),
	date: z
		.string()
		.describe(
			"The date when the publication was published, as text. Written from `dates` on every save; write `dates` instead.",
		),
	dates: resumeDatesSchema.optional(),
	website: itemWebsiteSchema.describe("The link to the publication, if any."),
	description: z.string().describe("The description of the publication. This should be a HTML-formatted string."),
});

export const referenceItemSchema = baseItemSchema.extend({
	name: z
		.string()
		.describe(
			"The name of the reference, or a note such as 'Available upon request'. Empty while the entry is a draft, which isn't printed.",
		),
	position: z.string().describe("The position or job title of the reference."),
	website: itemWebsiteSchema.describe("The website or LinkedIn profile of the reference, if any."),
	phone: z.string().describe("The phone number of the reference."),
	description: z
		.string()
		.describe(
			"The description of the reference. Can be used to display a quote, a testimonial, etc. This should be a HTML-formatted string.",
		),
});

export const skillItemSchema = baseItemSchema.extend({
	icon: iconSchema,
	iconColor: iconColorSchema,
	name: z.string().describe("The name of the skill. Empty while the entry is a draft, which isn't printed."),
	proficiency: z
		.string()
		.describe(
			"The proficiency level of the skill. Can be any text, such as 'Beginner', 'Intermediate', 'Advanced', etc.",
		),
	level: z
		.number()
		.min(0)
		.max(5)
		.catch(0)
		.describe(
			"The proficiency level of the skill, defined as a number between 0 and 5. If set to 0, the icons displaying the level will be hidden.",
		),
	keywords: z
		.array(z.string())
		.catch([])
		.describe("The keywords associated with the skill, if any. These are displayed as tags below the name."),
});

export const volunteerItemSchema = baseItemSchema.extend({
	organization: z
		.string()
		.describe("The name of the organization or company. Empty while the entry is a draft, which isn't printed."),
	location: z.string().describe("The location of the organization or company."),
	period: z
		.string()
		.describe(
			"The period of time the author was volunteered at the organization or company, as text. Written from `dates` on every save; write `dates` instead.",
		),
	dates: resumeDatesSchema.optional(),
	website: itemWebsiteSchema.describe("The link to the organization or company, if any."),
	description: z
		.string()
		.describe("The description of the volunteer experience. This should be a HTML-formatted string."),
});

export const coverLetterItemSchema = baseItemSchema.extend({
	recipient: z.string().describe("The recipient's address block as HTML (name, title, company, address, email)."),
	content: z.string().describe("The cover letter body as HTML (salutation, paragraphs, closing, signature)."),
});

export type CoverLetterItem = z.infer<typeof coverLetterItemSchema>;

export const baseSectionSchema = z.object({
	title: z.string().describe("The title of the section."),
	icon: z
		.string()
		.catch("")
		.describe(
			"Phosphor icon name to display before the section title in the PDF output. Empty string uses the default section icon; 'none' hides the icon.",
		),
	columns: z.number().int().min(1).max(6).catch(1).describe("The number of columns the section should span across."),
	hidden: z.boolean().describe("Whether to hide the section from the resume."),
	showHeading: z
		.boolean()
		.optional()
		.catch(true)
		.describe("Whether to show the section heading, icon, and decoration while retaining section content."),
	keepTogether: z
		.boolean()
		.catch(false)
		.describe("If true, the section is kept on a single page instead of splitting across a page break."),
	startOnNewPage: z.boolean().catch(false).describe("If true, the section always begins on a new page."),
});

// ponytail: 12 identical baseSectionSchema.extend({ items }) blocks collapsed to a factory
const itemSection = <T extends z.ZodTypeAny>(itemSchema: T, description: string) =>
	baseSectionSchema.extend({ items: z.array(itemSchema).describe(description) });

const awardsSectionSchema = itemSection(awardItemSchema, "The items to display in the awards section.");
const certificationsSectionSchema = itemSection(
	certificationItemSchema,
	"The items to display in the certifications section.",
);
const educationSectionSchema = itemSection(educationItemSchema, "The items to display in the education section.");
const experienceSectionSchema = itemSection(experienceItemSchema, "The items to display in the experience section.");
const interestsSectionSchema = itemSection(interestItemSchema, "The items to display in the interests section.");
const languagesSectionSchema = itemSection(languageItemSchema, "The items to display in the languages section.");
const profilesSectionSchema = itemSection(profileItemSchema, "The items to display in the profiles section.");
const projectsSectionSchema = itemSection(projectItemSchema, "The items to display in the projects section.");
const publicationsSectionSchema = itemSection(
	publicationItemSchema,
	"The items to display in the publications section.",
);
const referencesSectionSchema = itemSection(referenceItemSchema, "The items to display in the references section.");
const skillKeywordLayoutSchema = z
	.enum(["inline", "list"])
	.default("inline")
	.catch("inline")
	.describe("How skill keywords are displayed: inline separated by commas, or one bullet per keyword.");

export const skillsSectionSchema = itemSection(skillItemSchema, "The items to display in the skills section.")
	.extend({
		keywordLayout: skillKeywordLayoutSchema,
		layout: z
			.enum(["default", "inline"])
			.default("default")
			.catch("default")
			.describe("The layout style for skill items. 'inline' places item fields next to name"),
	})
	.transform((section) => (section.layout === "inline" ? { ...section, columns: 1 } : section));
const volunteerSectionSchema = itemSection(volunteerItemSchema, "The items to display in the volunteer section.");

const sectionsSchema = z.object({
	profiles: profilesSectionSchema.describe("The section to display the profiles of the author."),
	experience: experienceSectionSchema.describe("The section to display the experience of the author."),
	education: educationSectionSchema.describe("The section to display the education of the author."),
	projects: projectsSectionSchema.describe("The section to display the projects of the author."),
	skills: skillsSectionSchema.describe("The section to display the skills of the author."),
	languages: languagesSectionSchema.describe("The section to display the languages of the author."),
	interests: interestsSectionSchema.describe("The section to display the interests of the author."),
	awards: awardsSectionSchema.describe("The section to display the awards of the author."),
	certifications: certificationsSectionSchema.describe("The section to display the certifications of the author."),
	publications: publicationsSectionSchema.describe("The section to display the publications of the author."),
	volunteer: volunteerSectionSchema.describe("The section to display the volunteer experience of the author."),
	references: referencesSectionSchema.describe("The section to display the references of the author."),
});

export type SectionType = keyof z.infer<typeof sectionsSchema>;
type SectionData<T extends SectionType = SectionType> = z.infer<typeof sectionsSchema>[T];
export type SectionItem<T extends SectionType = SectionType> = SectionData<T>["items"][number];

export const sectionTypeSchema = z.enum([
	"summary",
	"profiles",
	"experience",
	"education",
	"projects",
	"skills",
	"languages",
	"interests",
	"awards",
	"certifications",
	"publications",
	"volunteer",
	"references",
	"cover-letter",
]);

export type CustomSectionType = z.infer<typeof sectionTypeSchema>;

// Correlation protects renderer requirements; it does not make otherwise-overlapping item shapes exclusive.
// Keep cover-letter before summary so the overlapping content shapes retain their established precedence.
export const customSectionItemDefinitionByType = {
	"cover-letter": { schemaName: "coverLetterItemSchema", schema: coverLetterItemSchema.catchall(z.any()) },
	summary: { schemaName: "summaryItemSchema", schema: summaryItemSchema.catchall(z.any()) },
	profiles: { schemaName: "profileItemSchema", schema: profileItemSchema.catchall(z.any()) },
	experience: { schemaName: "experienceItemSchema", schema: experienceItemSchema.catchall(z.any()) },
	education: { schemaName: "educationItemSchema", schema: educationItemSchema.catchall(z.any()) },
	projects: { schemaName: "projectItemSchema", schema: projectItemSchema.catchall(z.any()) },
	skills: { schemaName: "skillItemSchema", schema: skillItemSchema.catchall(z.any()) },
	languages: { schemaName: "languageItemSchema", schema: languageItemSchema.catchall(z.any()) },
	interests: { schemaName: "interestItemSchema", schema: interestItemSchema.catchall(z.any()) },
	awards: { schemaName: "awardItemSchema", schema: awardItemSchema.catchall(z.any()) },
	certifications: { schemaName: "certificationItemSchema", schema: certificationItemSchema.catchall(z.any()) },
	publications: { schemaName: "publicationItemSchema", schema: publicationItemSchema.catchall(z.any()) },
	volunteer: { schemaName: "volunteerItemSchema", schema: volunteerItemSchema.catchall(z.any()) },
	references: { schemaName: "referenceItemSchema", schema: referenceItemSchema.catchall(z.any()) },
} as const satisfies Record<CustomSectionType, { schemaName: string; schema: z.ZodType }>;

export type CustomSectionItem = z.infer<(typeof customSectionItemDefinitionByType)[CustomSectionType]["schema"]>;

const customSectionSchemaOptions = Object.entries(customSectionItemDefinitionByType).map(([type, { schema }]) =>
	baseSectionSchema.extend({
		keywordLayout: (type === "skills" ? skillKeywordLayoutSchema : z.undefined().catch(undefined)).optional(),
		id: z.string().describe("The unique identifier for the custom section. Usually generated as a UUID."),
		type: z
			.literal(type as CustomSectionType)
			.describe("The type of items this custom section contains. Determines which item schema and form fields to use."),
		items: z
			.array(schema)
			.describe("The items to display in the custom section. Items follow the schema of the section type."),
	}),
);

const [firstCustomSectionSchema, ...remainingCustomSectionSchemas] = customSectionSchemaOptions;
if (!firstCustomSectionSchema) throw new Error("At least one custom section schema is required.");

export const customSectionSchema = z.discriminatedUnion("type", [
	firstCustomSectionSchema,
	...remainingCustomSectionSchemas,
]);

export type CustomSection = z.infer<typeof customSectionSchema>;

const customSectionsSchema = z.array(customSectionSchema);

const fontWeightSchema = z.enum(["100", "200", "300", "400", "500", "600", "700", "800", "900"]);

const typographyItemSchema = z.object({
	fontFamily: z.string().describe("The family of the font to use. Must be a supported resume font."),
	fontWeights: z
		.array(fontWeightSchema)
		.catch(["400"])
		.describe(
			"The weight of the font, defined as a number between 100 and 900. Default to 400 when unsure if the weight is available in the font.",
		),
	fontSize: z.number().min(6).max(24).catch(11).describe("The size of the font to use, defined in points (pt)."),
	lineHeight: z
		.number()
		.min(0.5)
		.max(4)
		.catch(1.5)
		.describe("The line height of the font to use, defined as a multiplier of the font size (e.g. 1.5 for 1.5x)."),
});

const pageLayoutSchema = z.object({
	fullWidth: z
		.boolean()
		.describe(
			"Whether the layout of the page should be full width. If true, the main column will span the entire width of the page. This means that there should be no items in the sidebar column.",
		),
	main: z
		.array(z.string())
		.describe(
			"The items to display in the main column of the page. A string array of section IDs (experience, education, projects, skills, languages, interests, awards, certifications, publications, volunteer, references, profiles, summary or UUIDs for custom sections).",
		),
	sidebar: z
		.array(z.string())
		.describe(
			"The items to display in the sidebar column of the page. A string array of section IDs (experience, education, projects, skills, languages, interests, awards, certifications, publications, volunteer, references, profiles, summary or UUIDs for custom sections).",
		),
});

export const layoutSchema = z.object({
	sidebarWidth: z
		.number()
		.min(10)
		.max(50)
		.catch(35)
		.describe("The width of the sidebar column, defined as a percentage of the page width."),
	sidebarSide: z
		.enum(["left", "right"])
		.optional()
		.catch(undefined)
		.describe(
			"Which side of the page the sidebar column sits on in two-column templates. When unset, each template uses its own side (and right-to-left resumes mirror it).",
		),
	pages: z.array(pageLayoutSchema).describe("The pages to display in the layout."),
});

export const pageSchema = z.object({
	gapX: z.number().min(0).describe("The horizontal gap between the sections of the page, defined in points (pt)."),
	gapY: z.number().min(0).describe("The vertical gap between the sections of the page, defined in points (pt)."),
	marginX: z.number().min(0).max(100).catch(14).describe("The horizontal margin of the page, defined in points (pt)."),
	marginY: z.number().min(0).max(100).catch(12).describe("The vertical margin of the page, defined in points (pt)."),
	format: z
		.enum(["a4", "letter", "free-form"])
		.describe("The format of the page. Can be 'a4', 'letter', or 'free-form'.")
		.catch("a4"),
	locale: z
		.string()
		.describe("The locale of the page. Used for displaying pre-translated section headings, if not overridden.")
		.catch("en-US"),
	dateFormat: dateFormatSchema
		.optional()
		.catch(undefined)
		.describe(
			"How dates print: 'short' (Mar 2022), 'long' (March 2022), 'numeric' (03/2022) or 'iso' (2022-03). When missing, it's read from how the dates were typed.",
		),
	hideLinkUnderline: z.boolean().describe("Whether to hide the underlines of the links.").catch(false),
	hideIcons: z.boolean().describe("Whether to hide the item-level icons (skills, profiles, interests).").catch(false),
	hideSectionIcons: z
		.boolean()
		.describe("Whether to hide the section heading icons displayed before section titles.")
		.catch(true),
});

export const levelDesignSchema = z.object({
	icon: iconSchema,
	type: z
		.enum(["hidden", "circle", "square", "rectangle", "rectangle-full", "progress-bar", "icon"])
		.describe(
			"The type of the level design. 'hidden' will hide the level design, 'circle' will display a circle, 'square' will display a square, 'rectangle' will display a rectangle, 'rectangle-full' will display a full rectangle, 'progress-bar' will display a progress bar, and 'icon' will display an icon. If 'icon' is selected, the icon to display should be specified in the 'icon' field.",
		),
});

export const colorDesignSchema = z.object({
	primary: z.string().describe("The primary color of the design, defined as rgba(r, g, b, a)."),
	text: z
		.string()
		.describe("The text color of the design, defined as rgba(r, g, b, a). Usually set to black: rgba(0, 0, 0, 1)."),
	background: z
		.string()
		.describe(
			"The background color of the design, defined as rgba(r, g, b, a). Usually set to white: rgba(255, 255, 255, 1).",
		),
});

const designSchema = z.object({
	level: levelDesignSchema,
	colors: colorDesignSchema,
});

export const typographySchema = z.object({
	body: typographyItemSchema.describe("The typography for the body of the resume."),
	heading: typographyItemSchema.describe("The typography for the headings of the resume."),
	hyphenation: z
		.boolean()
		.optional()
		.describe("Enable automatic PDF hyphenation using the resume language. Defaults to false."),
});

const styleSlotSchema = z.enum([
	"section",
	"heading",
	"item",
	"text",
	"secondaryText",
	"link",
	"icon",
	"level",
	"richParagraph",
	"richList",
	"richListItemRow",
	"richListItemContent",
	"richLink",
	"richBold",
	"richMark",
]);

export type StyleSlot = z.infer<typeof styleSlotSchema>;

const styleIntentSchema = z
	.strictObject({
		color: z.string().optional(),
		backgroundColor: z.string().optional(),
		borderColor: z.string().optional(),
		textDecorationColor: z.string().optional(),
		opacity: z.number().min(0).max(1).optional(),
		fontSize: z.number().min(6).max(48).optional(),
		fontWeight: fontWeightSchema.optional(),
		fontStyle: z.enum(["normal", "italic"]).optional(),
		lineHeight: z.number().min(0.5).max(4).optional(),
		letterSpacing: z.number().min(-16).max(16).optional(),
		textDecoration: z.enum(["none", "underline", "line-through"]).optional(),
		textDecorationStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
		textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
		textTransform: z.enum(["none", "uppercase", "lowercase", "capitalize"]).optional(),
		padding: z.number().min(-72).max(72).optional(),
		paddingTop: z.number().min(-72).max(72).optional(),
		paddingRight: z.number().min(-72).max(72).optional(),
		paddingBottom: z.number().min(-72).max(72).optional(),
		paddingLeft: z.number().min(-72).max(72).optional(),
		marginTop: z.number().min(-72).max(72).optional(),
		marginRight: z.number().min(-72).max(72).optional(),
		marginBottom: z.number().min(-72).max(72).optional(),
		marginLeft: z.number().min(-72).max(72).optional(),
		rowGap: z.number().min(-72).max(72).optional(),
		columnGap: z.number().min(-72).max(72).optional(),
		borderStyle: z.enum(["solid", "dashed", "dotted"]).optional(),
		borderWidth: z.number().min(0).optional(),
		borderRadius: z.number().min(0).optional(),
	})
	.describe("Constrained visual style intent that can be safely translated to React PDF styles.");

export type StyleIntent = z.infer<typeof styleIntentSchema>;

// ponytail: 15 hand-listed optional slots collapsed to partialRecord; unknown keys still rejected
const styleRuleSlotsSchema = z
	.partialRecord(styleSlotSchema, styleIntentSchema)
	.refine((slots) => Object.values(slots).some(Boolean), {
		message: "At least one style slot must be configured.",
	});

const styleRuleTargetSchema = z.discriminatedUnion("scope", [
	z.strictObject({ scope: z.literal("global") }),
	z.strictObject({ scope: z.literal("sectionType"), sectionType: sectionTypeSchema }),
	z.strictObject({ scope: z.literal("sectionId"), sectionId: z.string().min(1) }),
]);

export const styleRuleSchema = z.strictObject({
	id: z.string().min(1).describe("Unique identifier for this style rule."),
	label: z.string().catch("").describe("Human-readable label for this style rule."),
	enabled: z.boolean().catch(true).describe("Whether this style rule should affect PDF rendering."),
	target: styleRuleTargetSchema.describe("The resume content this style rule applies to."),
	slots: styleRuleSlotsSchema.describe("The semantic style slots configured by this rule."),
});

const filterStyleIntent = (intent: unknown): StyleIntent | undefined => {
	const styleIntentShape = styleIntentSchema.shape;
	if (typeof intent !== "object" || intent === null) return undefined;
	const filteredIntent = Object.entries(intent).filter(([key, value]) => {
		const fieldSchema = styleIntentSchema.shape[key as keyof typeof styleIntentShape];
		if (!fieldSchema) return false;
		return fieldSchema.safeParse(value).success;
	});
	return filteredIntent.length > 0 ? (Object.fromEntries(filteredIntent) as StyleIntent) : undefined;
};

export const styleRulesSchema = z
	.array(z.unknown())
	.transform((arr) =>
		arr
			.map((item) => {
				const base = z
					.strictObject({
						id: z.string().min(1),
						label: z.string().catch(""),
						enabled: z.boolean().catch(true),
						target: styleRuleTargetSchema,
						slots: z.partialRecord(styleSlotSchema, z.unknown()),
					})
					.safeParse(item);

				if (!base.success) return undefined;

				const cleanedSlots = Object.fromEntries(
					Object.entries(base.data.slots)
						.map(([slot, intent]) => [slot, filterStyleIntent(intent)])
						.filter((entry): entry is [string, StyleIntent] => entry[1] !== undefined),
				);

				if (Object.keys(cleanedSlots).length === 0) return undefined;

				return { ...base.data, slots: cleanedSlots };
			})
			.filter((rule): rule is StyleRule => rule !== undefined),
	)
	.catch([]);

export type StyleRule = z.infer<typeof styleRuleSchema>;
export type StyleRuleTarget = z.infer<typeof styleRuleTargetSchema>;

export const metadataSchema = z.object({
	template: templateSchema
		.catch("onyx")
		.describe("The template to use for the resume. Determines the overall design and appearance of the resume."),
	layout: layoutSchema.describe(
		"The layout of the resume. Determines the structure and arrangement of the sections on the resume.",
	),
	page: pageSchema.describe(
		"The page settings of the resume. Determines the margins, format, and locale of the resume.",
	),
	design: designSchema.describe(
		"The design settings of the resume. Determines the colors, level designs, and typography of the resume.",
	),
	typography: typographySchema.describe(
		"The typography settings of the resume. Determines the fonts and sizes of the body and headings of the resume.",
	),
	notes: z
		.string()
		.describe(
			"Personal notes for the resume. Can be used to add any additional information or instructions for the resume. These notes are not displayed on the resume, they are only visible to the author of the resume when editing the resume. This should be a HTML-formatted string.",
		),
	styleRules: styleRulesSchema.describe(
		"Structured style rules that target semantic resume sections and slots for PDF rendering.",
	),
	stylesheet: semanticStylesheetSchema.optional(),
	web: z
		.object({
			showCredit: z
				.boolean()
				.catch(true)
				.describe("Whether the web page shows the small 'Made with Reactive Resume' footer."),
		})
		.optional()
		.catch(undefined)
		.describe(
			"Settings for the resume's public web page, which uses the resume's template. Missing until the author changes them in Share.",
		),
	check: z
		.object({
			ignored: z
				.array(z.string())
				.catch([])
				.describe("Check issues the author chose to ignore, by issue key (the rule code and where it applies)."),
			hiddenTerms: z
				.array(z.string())
				.catch([])
				.describe("Job-posting terms the author hid from Job match as not true for them."),
		})
		.optional()
		.catch(undefined)
		.describe("The author's Check choices for this resume. Not printed; missing until a choice is made."),
});

export const resumeDataSchema = z.looseObject({
	picture: pictureSchema.describe("Configuration for photograph displayed on the resume"),
	basics: basicsSchema.describe(
		"Basic information about the author, such as name, email, phone, location, and website",
	),
	summary: summarySchema.describe("Summary section of the resume, useful for a short bio or introduction"),
	sections: sectionsSchema.describe("Various sections of the resume, such as experience, education, projects, etc."),
	customSections: customSectionsSchema.describe(
		"Custom sections of the resume, such as a custom section for notes, etc.",
	),
	metadata: metadataSchema.describe(
		"Metadata for the resume, such as template, layout, typography, etc. This section describes the overall design and appearance of the resume.",
	),
});

export type ResumeData = z.infer<typeof resumeDataSchema>;

export const parseResumeData = (data: unknown): ResumeData => {
	const parsed = resumeDataSchema.parse(data);
	parsed.summary.showHeading ??= true;
	for (const section of Object.values(parsed.sections)) section.showHeading ??= true;
	for (const section of parsed.customSections) section.showHeading ??= true;
	upgradeResumeDates(parsed);
	syncResumeDates(parsed);
	return parsed;
};

export type LayoutPage = z.infer<typeof pageLayoutSchema>;
export type Typography = z.infer<typeof typographySchema>;
export type Design = z.infer<typeof designSchema>;
export type Page = z.infer<typeof pageSchema>;
export type Layout = z.infer<typeof layoutSchema>;
export type Basics = z.infer<typeof basicsSchema>;
export type Summary = z.infer<typeof summarySchema>;
export type AwardItem = z.infer<typeof awardItemSchema>;
export type CertificationItem = z.infer<typeof certificationItemSchema>;
export type EducationItem = z.infer<typeof educationItemSchema>;
export type ExperienceItem = z.infer<typeof experienceItemSchema>;
export type InterestItem = z.infer<typeof interestItemSchema>;
export type LanguageItem = z.infer<typeof languageItemSchema>;
export type ProfileItem = z.infer<typeof profileItemSchema>;
export type ProjectItem = z.infer<typeof projectItemSchema>;
export type PublicationItem = z.infer<typeof publicationItemSchema>;
export type ReferenceItem = z.infer<typeof referenceItemSchema>;
export type SkillItem = z.infer<typeof skillItemSchema>;
export type VolunteerItem = z.infer<typeof volunteerItemSchema>;
export type AwardsSection = z.infer<typeof awardsSectionSchema>;
export type CertificationsSection = z.infer<typeof certificationsSectionSchema>;
export type EducationSection = z.infer<typeof educationSectionSchema>;
export type ExperienceSection = z.infer<typeof experienceSectionSchema>;
export type InterestsSection = z.infer<typeof interestsSectionSchema>;
export type LanguagesSection = z.infer<typeof languagesSectionSchema>;
export type ProjectsSection = z.infer<typeof projectsSectionSchema>;
export type PublicationsSection = z.infer<typeof publicationsSectionSchema>;
export type ReferencesSection = z.infer<typeof referencesSectionSchema>;
export type SkillsSection = z.infer<typeof skillsSectionSchema>;
export type VolunteerSection = z.infer<typeof volunteerSectionSchema>;
export type Picture = z.infer<typeof pictureSchema>;
export type CustomField = z.infer<typeof customFieldSchema>;
export type Website = z.infer<typeof websiteSchema>;
