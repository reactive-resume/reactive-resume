import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import z, { ZodError } from "zod";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { templateSchema } from "@reactive-resume/schema/templates";
import { parseColorString } from "@reactive-resume/utils/color";
import { generateId } from "@reactive-resume/utils/string";
import { rethrowAsImportError } from "./error";

function colorToRgba(color: string): string {
	const parsed = parseColorString(color);
	if (!parsed) return "rgba(0, 0, 0, 1)";
	return `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${parsed.a})`;
}

// ponytail: inlined single-caller wrappers; compile-time constants (rotation=0, sidebarWidth=35, shadow=0) replaced with literals
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const sanitizeEmail = (email?: string) => (email && z.email().safeParse(email).success ? email : "");

type FontWeight = "100" | "200" | "300" | "400" | "500" | "600" | "700" | "800" | "900";

const NAMED_FONT_WEIGHTS: Record<string, FontWeight> = {
	regular: "400",
	italic: "400",
	bold: "700",
	"bold-italic": "700",
};

const convertFontVariantToWeight = (variant: string, defaultWeight: FontWeight = "400"): FontWeight => {
	const name = variant.toLowerCase();
	return /^[1-9]00$/.test(name) ? (name as FontWeight) : (NAMED_FONT_WEIGHTS[name] ?? defaultWeight);
};

const convertFontVariants = (variants: string[] | undefined, defaultWeight: FontWeight = "400"): FontWeight[] => {
	if (!variants || variants.length === 0) return [defaultWeight];
	return variants.map((v) => convertFontVariantToWeight(v, defaultWeight));
};

const convertFontVariantsForHeading = (variants: string[] | undefined): FontWeight[] => {
	const weights = convertFontVariants(variants, "600");
	const filtered = weights.filter((w) => Number.parseInt(w, 10) >= 600);
	return filtered.length > 0 ? filtered : ["600"];
};

// ponytail: V4Url + V4Section<T> collapse 11× {label,href} and 13× 5-field section header into aliases
type V4Url = { label: string; href: string };
type V4Section<T> = {
	name: string;
	columns: number;
	separateLinks: boolean;
	visible: boolean;
	id: string;
	items: Array<T>;
};

type V4ResumeData = {
	basics: {
		name: string;
		headline: string;
		email: string;
		phone: string;
		location: string;
		url: V4Url;
		customFields: Array<{ id?: string; icon?: string; text?: string }>;
		picture: {
			url: string;
			size: number;
			aspectRatio: number;
			borderRadius: number;
			effects: { hidden: boolean; border: boolean; grayscale: boolean };
		};
	};
	sections: {
		summary: { name: string; columns: number; separateLinks: boolean; visible: boolean; id: string; content: string };
		awards: V4Section<{
			id: string;
			visible: boolean;
			title?: string;
			awarder?: string;
			date?: string;
			summary?: string;
			url?: V4Url;
		}>;
		certifications: V4Section<{
			id: string;
			visible: boolean;
			name?: string;
			issuer?: string;
			date?: string;
			summary?: string;
			url?: V4Url;
		}>;
		education: V4Section<{
			id: string;
			visible: boolean;
			institution?: string;
			studyType?: string;
			area?: string;
			score?: string;
			date?: string;
			summary?: string;
			url?: V4Url;
		}>;
		experience: V4Section<{
			id: string;
			visible: boolean;
			company?: string;
			position?: string;
			location?: string;
			date?: string;
			summary?: string;
			url?: V4Url;
		}>;
		volunteer: V4Section<{
			id: string;
			visible: boolean;
			organization?: string;
			position?: string;
			location?: string;
			date?: string;
			summary?: string;
			url?: V4Url;
		}>;
		interests: V4Section<{ id: string; visible: boolean; name?: string; keywords?: string[] }>;
		languages: V4Section<{ id: string; visible: boolean; name?: string; description?: string; level?: number }>;
		profiles: V4Section<{
			id: string;
			visible: boolean;
			network?: string;
			username?: string;
			icon?: string;
			url?: V4Url;
		}>;
		projects: V4Section<{
			id: string;
			visible: boolean;
			name?: string;
			description?: string;
			date?: string;
			summary?: string;
			keywords?: string[];
			url?: V4Url;
		}>;
		publications: V4Section<{
			id: string;
			visible: boolean;
			name?: string;
			publisher?: string;
			date?: string;
			summary?: string;
			url?: V4Url;
		}>;
		references: V4Section<{
			id: string;
			visible: boolean;
			name?: string;
			description?: string;
			summary?: string;
			url?: V4Url;
		}>;
		skills: V4Section<{
			id: string;
			visible: boolean;
			name?: string;
			description?: string;
			level?: number;
			keywords?: string[];
		}>;
		custom?: Record<
			string,
			V4Section<{
				id: string;
				visible: boolean;
				name?: string;
				description?: string;
				date?: string;
				location?: string;
				summary?: string;
				keywords?: string[];
				url?: V4Url;
			}>
		>;
	};
	metadata: {
		template: string;
		layout: Array<Array<string[]>>;
		css: { value: string; visible: boolean };
		page: { margin: number; format: "a4" | "letter"; options: { breakLine: boolean; pageNumbers: boolean } };
		theme: { background: string; text: string; primary: string };
		typography: {
			font: { family: string; subset: string; variants: string[]; size: number };
			lineHeight: number;
			hideIcons: boolean;
			underlineLinks: boolean;
		};
		notes: string;
	};
};

// V4 lays custom sections out as "custom.{id}"; summary is placed separately below.
const transformLayoutColumn = (column: string[]) =>
	column.filter((id) => id !== "summary").map((id) => id.replace(/^custom\./, ""));

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

// A genuine v4 export always carries object-typed basics, sections, and metadata.
// Checking this up front turns "not a v4 file" into a clear error instead of the
// raw TypeError the transform below would throw when it dereferences a missing branch.
const hasV4Shape = (value: unknown): value is V4ResumeData =>
	isRecord(value) && isRecord(value.basics) && isRecord(value.sections) && isRecord(value.metadata);

const NOT_V4_MESSAGE =
	"This file isn't a Reactive Resume v4 export. Choose a v4 JSON export, or pick the matching format.";

type V4Item = { id?: string; visible?: boolean };
type V4SectionHeader = { name?: string; columns?: number; visible?: boolean };

const baseSection = (section?: V4SectionHeader) => ({
	title: section?.name ?? "",
	icon: "",
	columns: section?.columns ?? 1,
	hidden: !(section?.visible ?? true),
	keepTogether: false,
	startOnNewPage: false,
});

const itemBase = (item: V4Item) => ({
	id: item.id ?? generateId(),
	hidden: !(item.visible ?? true),
});

const toWebsite = (url?: V4Url) => ({
	url: url?.href ?? "",
	label: url?.label ?? "",
	inlineLink: false,
});

// ponytail: stateless single-method class → plain function
export function parseReactiveResumeV4JSON(json: string): ResumeData {
	try {
		const parsed: unknown = JSON.parse(json);
		if (!hasV4Shape(parsed)) throw new Error(NOT_V4_MESSAGE);
		const v4Data = parsed;
		const bodySize = clamp((v4Data.metadata.typography?.font?.size ?? 14.67) * 0.75, 6, 24);

		const transformed: ResumeData = {
			picture: {
				hidden: v4Data.basics.picture?.effects?.hidden ?? false,
				fit: "cover",
				url: v4Data.basics.picture?.url ?? "",
				size: clamp(v4Data.basics.picture?.size ?? 80, 32, 512),
				rotation: 0,
				aspectRatio: clamp(v4Data.basics.picture?.aspectRatio ?? 1, 0.5, 2.5),
				borderRadius: clamp(v4Data.basics.picture?.borderRadius ?? 0, 0, 100),
				borderColor: v4Data.basics.picture?.effects?.border ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0)",
				borderWidth: v4Data.basics.picture?.effects?.border ? 1 : 0,
				shadowColor: "rgba(0, 0, 0, 0.5)",
				shadowWidth: 0,
			},
			basics: {
				name: v4Data.basics.name ?? "",
				headline: v4Data.basics.headline ?? "",
				email: sanitizeEmail(v4Data.basics.email),
				phone: v4Data.basics.phone ?? "",
				location: v4Data.basics.location ?? "",
				website: {
					url: v4Data.basics.url?.href ?? "",
					label: v4Data.basics.url?.label ?? "",
				},
				customFields: (v4Data.basics.customFields ?? []).map((field) => ({
					id: field.id ?? generateId(),
					icon: field.icon ?? "",
					text: field.text ?? "",
					link: "",
				})),
			},
			summary: {
				...baseSection(v4Data.sections.summary),
				content: v4Data.sections.summary?.content ?? "",
			},
			sections: {
				profiles: {
					...baseSection(v4Data.sections.profiles),
					items: (v4Data.sections.profiles?.items ?? [])
						.filter((item) => item.network && item.network.length > 0)
						.map((item) => ({
							...itemBase(item),
							icon: item.icon ?? "",
							iconColor: "",
							network: item.network ?? "",
							username: item.username ?? "",
							website: toWebsite(item.url),
						})),
				},
				experience: {
					...baseSection(v4Data.sections.experience),
					items: (v4Data.sections.experience?.items ?? [])
						.filter((item) => item.company && item.company.length > 0)
						.map((item) => ({
							...itemBase(item),
							company: item.company ?? "",
							position: item.position ?? "",
							location: item.location ?? "",
							period: item.date ?? "",
							website: toWebsite(item.url),
							roles: [],
							description: item.summary ?? "",
						})),
				},
				education: {
					...baseSection(v4Data.sections.education),
					items: (v4Data.sections.education?.items ?? [])
						.filter((item) => item.institution && item.institution.length > 0)
						.map((item) => ({
							...itemBase(item),
							school: item.institution ?? "",
							degree: item.studyType ?? "",
							area: item.area ?? "",
							grade: item.score ?? "",
							location: "",
							period: item.date ?? "",
							website: toWebsite(item.url),
							description: item.summary ?? "",
						})),
				},
				projects: {
					...baseSection(v4Data.sections.projects),
					items: (v4Data.sections.projects?.items ?? [])
						.filter((item) => item.name && item.name.length > 0)
						.map((item) => ({
							...itemBase(item),
							name: item.name ?? "",
							period: item.date ?? "",
							website: toWebsite(item.url),
							description: item.summary ?? item.description ?? "",
						})),
				},
				skills: {
					...baseSection(v4Data.sections.skills),
					layout: "default",
					keywordLayout: "inline",
					items: (v4Data.sections.skills?.items ?? [])
						.filter((item) => item.name && item.name.length > 0)
						.map((item) => ({
							...itemBase(item),
							icon: "",
							iconColor: "",
							name: item.name ?? "",
							proficiency: item.description ?? "",
							// v4 stored skill level as 0-10; scale down to v5's 0-5 range
							level: Math.round(clamp(item.level ?? 0, 0, 10) / 2),
							keywords: item.keywords ?? [],
						})),
				},
				languages: {
					...baseSection(v4Data.sections.languages),
					items: (v4Data.sections.languages?.items ?? [])
						.filter((item) => item.name && item.name.length > 0)
						.map((item) => ({
							...itemBase(item),
							language: item.name ?? "",
							fluency: item.description ?? "",
							// v4 stored language level as 0-10; scale down to v5's 0-5 range
							level: Math.round(clamp(item.level ?? 0, 0, 10) / 2),
						})),
				},
				interests: {
					...baseSection(v4Data.sections.interests),
					items: (v4Data.sections.interests?.items ?? [])
						.filter((item) => item.name && item.name.length > 0)
						.map((item) => ({
							...itemBase(item),
							icon: "",
							iconColor: "",
							name: item.name ?? "",
							keywords: item.keywords ?? [],
						})),
				},
				awards: {
					...baseSection(v4Data.sections.awards),
					items: (v4Data.sections.awards?.items ?? [])
						.filter((item) => item.title && item.title.length > 0)
						.map((item) => ({
							...itemBase(item),
							title: item.title ?? "",
							awarder: item.awarder ?? "",
							date: item.date ?? "",
							website: toWebsite(item.url),
							description: item.summary ?? "",
						})),
				},
				certifications: {
					...baseSection(v4Data.sections.certifications),
					items: (v4Data.sections.certifications?.items ?? [])
						.filter((item) => item.name && item.name.length > 0)
						.map((item) => ({
							...itemBase(item),
							title: item.name ?? "",
							issuer: item.issuer ?? "",
							date: item.date ?? "",
							website: toWebsite(item.url),
							description: item.summary ?? "",
						})),
				},
				publications: {
					...baseSection(v4Data.sections.publications),
					items: (v4Data.sections.publications?.items ?? [])
						.filter((item) => item.name && item.name.length > 0)
						.map((item) => ({
							...itemBase(item),
							title: item.name ?? "",
							publisher: item.publisher ?? "",
							date: item.date ?? "",
							website: toWebsite(item.url),
							description: item.summary ?? "",
						})),
				},
				volunteer: {
					...baseSection(v4Data.sections.volunteer),
					items: (v4Data.sections.volunteer?.items ?? [])
						.filter((item) => item.organization && item.organization.length > 0)
						.map((item) => ({
							...itemBase(item),
							organization: item.organization ?? "",
							location: item.location ?? "",
							period: item.date ?? "",
							website: toWebsite(item.url),
							description: item.summary ?? "",
						})),
				},
				references: {
					...baseSection(v4Data.sections.references),
					items: (v4Data.sections.references?.items ?? [])
						.filter((item) => item.name && item.name.length > 0)
						.map((item) => ({
							...itemBase(item),
							name: item.name ?? "",
							position: item.description ?? "",
							phone: "",
							website: toWebsite(item.url),
							description: item.summary ?? "",
						})),
				},
			},
			customSections: Object.entries(v4Data.sections.custom ?? {}).map(([sectionId, section]) => ({
				id: section.id || sectionId,
				title: section.name ?? "",
				icon: "",
				type: "experience" as const, // Default to experience type as it has the most compatible fields
				columns: section.columns ?? 1,
				hidden: !(section.visible ?? true),
				keepTogether: false,
				startOnNewPage: false,
				items: section.items.map((item, index) => {
					const hasName = Boolean(item.name?.trim());
					return {
						id: item.id || generateId(),
						hidden: !(item.visible ?? true),
						company: item.name?.trim() || `#${index + 1}`,
						// Only use description as subtitle when item has a name;
						// otherwise description IS the primary content and goes to the body below
						position: hasName ? (item.description ?? "") : "",
						location: item.location ?? "",
						period: item.date ?? "",
						website: toWebsite(item.url),
						roles: [],
						// Prefer HTML summary; fall back to plain description
						// (for description-only items, description IS the body content)
						description: item.summary ?? item.description ?? "",
					};
				}),
			})),
			metadata: {
				template: (templateSchema.safeParse(v4Data.metadata.template).success
					? v4Data.metadata.template
					: "onyx") as Template,
				layout: {
					sidebarWidth: 35,
					pages: (v4Data.metadata.layout ?? []).map((page) => {
						const main = transformLayoutColumn(page[0] ?? []);
						const sidebar = transformLayoutColumn(page[1] ?? []);
						return {
							fullWidth: sidebar.length === 0,
							main,
							sidebar,
						};
					}),
				},
				page: {
					gapX: 4,
					gapY: 6,
					marginX: Math.max(0, v4Data.metadata.page?.margin ?? 14),
					marginY: Math.max(0, v4Data.metadata.page?.margin ?? 14),
					format: v4Data.metadata.page?.format ?? "a4",
					locale: "en-US",
					hideLinkUnderline: v4Data.metadata.typography?.underlineLinks === false,
					hideIcons: v4Data.metadata.typography?.hideIcons ?? false,
					hideSectionIcons: true,
				},
				design: {
					colors: {
						primary: v4Data.metadata.theme?.primary
							? colorToRgba(v4Data.metadata.theme.primary)
							: "rgba(220, 38, 38, 1)",
						text: v4Data.metadata.theme?.text ? colorToRgba(v4Data.metadata.theme.text) : "rgba(0, 0, 0, 1)",
						background: v4Data.metadata.theme?.background
							? colorToRgba(v4Data.metadata.theme.background)
							: "rgba(255, 255, 255, 1)",
					},
					level: {
						icon: "star",
						type: "circle",
					},
				},
				typography: {
					body: {
						fontFamily: v4Data.metadata.typography?.font?.family ?? "IBM Plex Serif",
						fontWeights: convertFontVariants(v4Data.metadata.typography?.font?.variants),
						fontSize: bodySize,
						lineHeight: clamp(v4Data.metadata.typography?.lineHeight ?? 1.5, 0.5, 4),
					},
					heading: {
						fontFamily: v4Data.metadata.typography?.font?.family ?? "IBM Plex Serif",
						fontWeights: convertFontVariantsForHeading(v4Data.metadata.typography?.font?.variants),
						fontSize: clamp(bodySize + 3, 6, 24),
						lineHeight: clamp(v4Data.metadata.typography?.lineHeight ?? 1.5, 0.5, 4),
					},
				},
				notes: v4Data.metadata.notes ?? "",
				styleRules: [],
			},
		};

		if (v4Data.sections.summary?.visible && v4Data.sections.summary?.content) {
			const firstPage = transformed.metadata.layout.pages[0];
			if (firstPage) {
				firstPage.main.unshift("summary");
			}
		}

		return resumeDataSchema.parse(transformed);
	} catch (error: unknown) {
		if (error instanceof ZodError) rethrowAsImportError(error);
		// Surface malformed JSON as-is; treat any other transform failure (a shape
		// mismatch that slipped past the guard) as "not a valid v4 export" rather
		// than leaking a raw TypeError to the user.
		if (error instanceof SyntaxError) throw error;
		throw error instanceof Error && error.message === NOT_V4_MESSAGE ? error : new Error(NOT_V4_MESSAGE);
	}
}
