import type { MessageDescriptor } from "@lingui/core";
import type { Template } from "@reactive-resume/schema/templates";
import { msg } from "@lingui/core/macro";

export type TemplateMetadata = {
	name: string;
	description: MessageDescriptor;
	imageUrl: string;
	/** Style tags (one shared context keeps short words apart from the same words elsewhere); the column count comes from `templateLayouts`. */
	tags: MessageDescriptor[];
};

export const templates = {
	azurill: {
		name: "Azurill",
		description: msg`Two-column with a bold colored sidebar and skill bars; great for creative or tech roles where visual flair is welcome.`,
		imageUrl: "/templates/jpg/azurill.jpg",
		tags: [
			msg({ message: "Creative", context: "Template style tag" }),
			msg({ message: "Tech", context: "Template style tag" }),
			msg({ message: "Visual flair", context: "Template style tag" }),
		],
	},
	bronzor: {
		name: "Bronzor",
		description: msg`One column with labeled section rows and subtle dividers. A compact layout for experience, education and supporting details.`,
		imageUrl: "/templates/jpg/bronzor.jpg",
		tags: [
			msg({ message: "Clean", context: "Template style tag" }),
			msg({ message: "Professional", context: "Template style tag" }),
			msg({ message: "Corporate", context: "Template style tag" }),
			msg({ message: "Finance", context: "Template style tag" }),
			msg({ message: "Consulting", context: "Template style tag" }),
		],
	},
	chikorita: {
		name: "Chikorita",
		description: msg`Two-column with a soft header accent and circular profile photo; ideal for marketing, HR, or client-facing roles.`,
		imageUrl: "/templates/jpg/chikorita.jpg",
		tags: [
			msg({ message: "Soft accent", context: "Template style tag" }),
			msg({ message: "Marketing", context: "Template style tag" }),
			msg({ message: "HR", context: "Template style tag" }),
			msg({ message: "Client-facing", context: "Template style tag" }),
		],
	},
	ditgar: {
		name: "Ditgar",
		description: msg`Two-column with a dark teal sidebar and skills grid; modern feel for developers, data scientists, or technical PMs.`,
		imageUrl: "/templates/jpg/ditgar.jpg",
		tags: [
			msg({ message: "Modern", context: "Template style tag" }),
			msg({ message: "Developer", context: "Template style tag" }),
			msg({ message: "Data science", context: "Template style tag" }),
			msg({ message: "Technical PM", context: "Template style tag" }),
			msg({ message: "Dark sidebar", context: "Template style tag" }),
		],
	},
	ditto: {
		name: "Ditto",
		description: msg`Two columns beneath a colored header band. Keep experience in the main column and supporting details in the sidebar.`,
		imageUrl: "/templates/jpg/ditto.jpg",
		tags: [
			msg({ message: "Minimal", context: "Template style tag" }),
			msg({ message: "Text-dense", context: "Template style tag" }),
			msg({ message: "Traditional", context: "Template style tag" }),
		],
	},
	gengar: {
		name: "Gengar",
		description: msg`Two-column with accent colors and clean typography; balanced choice for business analysts or operations roles.`,
		imageUrl: "/templates/jpg/gengar.jpg",
		tags: [
			msg({ message: "Accent colors", context: "Template style tag" }),
			msg({ message: "Clean typography", context: "Template style tag" }),
			msg({ message: "Business analyst", context: "Template style tag" }),
			msg({ message: "Operations", context: "Template style tag" }),
		],
	},
	glalie: {
		name: "Glalie",
		description: msg`Two-column, minimal with light gray sidebar and subtle icons; professional and understated for legal, finance, or executive roles.`,
		imageUrl: "/templates/jpg/glalie.jpg",
		tags: [
			msg({ message: "Minimal", context: "Template style tag" }),
			msg({ message: "Professional", context: "Template style tag" }),
			msg({ message: "Legal", context: "Template style tag" }),
			msg({ message: "Finance", context: "Template style tag" }),
			msg({ message: "Executive", context: "Template style tag" }),
			msg({ message: "Understated", context: "Template style tag" }),
		],
	},
	kakuna: {
		name: "Kakuna",
		description: msg`Single-column with a magenta left border accent; compact and efficient for entry-level or internship applications.`,
		imageUrl: "/templates/jpg/kakuna.jpg",
		tags: [
			msg({ message: "ATS friendly", context: "Template style tag" }),
			msg({ message: "Compact", context: "Template style tag" }),
			msg({ message: "Efficient", context: "Template style tag" }),
			msg({ message: "Entry level", context: "Template style tag" }),
			msg({ message: "Internship", context: "Template style tag" }),
			msg({ message: "Magenta accent", context: "Template style tag" }),
		],
	},
	lapras: {
		name: "Lapras",
		description: msg`Single-column; polished and serious for senior or enterprise-level positions.`,
		imageUrl: "/templates/jpg/lapras.jpg",
		tags: [
			msg({ message: "ATS friendly", context: "Template style tag" }),
			msg({ message: "Polished", context: "Template style tag" }),
			msg({ message: "Senior", context: "Template style tag" }),
			msg({ message: "Enterprise", context: "Template style tag" }),
		],
	},
	leafish: {
		name: "Leafish",
		description: msg`Two-column with a muted color sidebar; earthy and calm, suits sustainability, healthcare, or nonprofit sectors.`,
		imageUrl: "/templates/jpg/leafish.jpg",
		tags: [
			msg({ message: "Muted sidebar", context: "Template style tag" }),
			msg({ message: "Earthy", context: "Template style tag" }),
			msg({ message: "Calm", context: "Template style tag" }),
			msg({ message: "Sustainability", context: "Template style tag" }),
			msg({ message: "Healthcare", context: "Template style tag" }),
			msg({ message: "Nonprofit", context: "Template style tag" }),
		],
	},
	meowth: {
		name: "Meowth",
		description: msg`Single-column with uppercase section headings over a rule and the photo beside the name; compact and ATS-friendly, well-suited for Asian resume conventions (CN/JP/KR).`,
		imageUrl: "/templates/jpg/meowth.jpg",
		tags: [
			msg({ message: "ATS friendly", context: "Template style tag" }),
			msg({ message: "Ruled headings", context: "Template style tag" }),
			msg({ message: "Compact", context: "Template style tag" }),
			msg({ message: "Asian style", context: "Template style tag" }),
			msg({ message: "CN/JP/KR", context: "Template style tag" }),
		],
	},
	onyx: {
		name: "Onyx",
		description: msg`One column with a photo beside the header and clear section headings. A simple top-to-bottom layout for your experience.`,
		imageUrl: "/templates/jpg/onyx.jpg",
		tags: [
			msg({ message: "ATS friendly", context: "Template style tag" }),
			msg({ message: "Versatile", context: "Template style tag" }),
			msg({ message: "Professional", context: "Template style tag" }),
			msg({ message: "Technical", context: "Template style tag" }),
		],
	},
	persian: {
		name: "Persian",
		description: msg`Single-column Wall Street style with a centered header and ruled section headings.`,
		imageUrl: "/templates/jpg/persian.jpg",
		tags: [
			msg({ message: "ATS friendly", context: "Template style tag" }),
			msg({ message: "Finance", context: "Template style tag" }),
			msg({ message: "Consulting", context: "Template style tag" }),
			msg({ message: "Traditional", context: "Template style tag" }),
		],
	},
	pikachu: {
		name: "Pikachu",
		description: msg`Two-column with a left margin color; simple and approachable for creative, editorial, or junior roles.`,
		imageUrl: "/templates/jpg/pikachu.jpg",
		tags: [
			msg({ message: "Simple", context: "Template style tag" }),
			msg({ message: "Creative", context: "Template style tag" }),
			msg({ message: "Editorial", context: "Template style tag" }),
			msg({ message: "Junior", context: "Template style tag" }),
			msg({ message: "Accent colors", context: "Template style tag" }),
		],
	},
	porygon: {
		name: "Porygon",
		description: msg`Single-column ruled form inspired by the Japanese rirekisho: a bordered header of field cells and every section as a table with a solid title bar; dense and fast to scan for engineering, operations, or applications in Japan.`,
		imageUrl: "/templates/jpg/porygon.jpg",
		tags: [
			msg({ message: "ATS friendly", context: "Template style tag" }),
			msg({ message: "Ruled grid", context: "Template style tag" }),
			msg({ message: "Dense", context: "Template style tag" }),
			msg({ message: "Structured", context: "Template style tag" }),
			msg({ message: "Engineering", context: "Template style tag" }),
			msg({ message: "Operations", context: "Template style tag" }),
			msg({ message: "Asian style", context: "Template style tag" }),
		],
	},
	rhyhorn: {
		name: "Rhyhorn",
		description: msg`Single-column with a minimal top header and lots of whitespace; clean and modern for designers or content creators.`,
		imageUrl: "/templates/jpg/rhyhorn.jpg",
		tags: [
			msg({ message: "ATS friendly", context: "Template style tag" }),
			msg({ message: "Minimal", context: "Template style tag" }),
			msg({ message: "Clean", context: "Template style tag" }),
			msg({ message: "Modern", context: "Template style tag" }),
			msg({ message: "Designer", context: "Template style tag" }),
			msg({ message: "Content creator", context: "Template style tag" }),
			msg({ message: "Whitespace", context: "Template style tag" }),
		],
	},
	scizor: {
		name: "Scizor",
		description: msg`Single-column with uppercase section headings and a primary-color top rule on every page; polished for executive, consulting, or startup resumes.`,
		imageUrl: "/templates/jpg/scizor.jpg",
		tags: [
			msg({ message: "ATS friendly", context: "Template style tag" }),
			msg({ message: "Uppercase headings", context: "Template style tag" }),
			msg({ message: "Executive", context: "Template style tag" }),
			msg({ message: "Consulting", context: "Template style tag" }),
			msg({ message: "Startup", context: "Template style tag" }),
		],
	},
	smeargle: {
		name: "Smeargle",
		description: msg`Single-column set like a magazine feature: a large display name under an uppercase kicker and the summary as a larger standfirst; refined for writers, designers, and communications roles.`,
		imageUrl: "/templates/jpg/smeargle.jpg",
		tags: [
			msg({ message: "ATS friendly", context: "Template style tag" }),
			msg({ message: "Editorial", context: "Template style tag" }),
			msg({ message: "Magazine", context: "Template style tag" }),
			msg({ message: "Serif", context: "Template style tag" }),
			msg({ message: "Writer", context: "Template style tag" }),
			msg({ message: "Designer", context: "Template style tag" }),
			msg({ message: "Communications", context: "Template style tag" }),
		],
	},
} as const satisfies Record<Template, TemplateMetadata>;
