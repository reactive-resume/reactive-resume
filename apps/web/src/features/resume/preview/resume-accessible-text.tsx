import type {
	AwardItem,
	CertificationItem,
	CoverLetterItem,
	CustomSectionItem,
	CustomSectionType,
	EducationItem,
	ExperienceItem,
	InterestItem,
	LanguageItem,
	ProfileItem,
	ProjectItem,
	PublicationItem,
	ReferenceItem,
	ResumeData,
	SectionType,
	SkillItem,
	SummaryItem,
	VolunteerItem,
} from "@reactive-resume/schema/resume/data";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Fragment } from "react";
import { stripHtml } from "@reactive-resume/utils/string";
import { useResumeData } from "@/features/resume/builder/draft";
import { getSectionTitle } from "@/libs/resume/section";

// Fixed reading order for built-in sections. The visual PDF column order can differ,
// but for a screen-reader mirror a stable, complete order matters more than column fidelity.
const SECTION_ORDER: SectionType[] = [
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
];

const joinInline = (...parts: (string | undefined | null | false)[]): string =>
	parts.filter((part): part is string => typeof part === "string" && part.trim().length > 0).join(" · ");

const isSafeHref = (value: string | undefined): string | undefined => {
	const href = value?.trim();
	if (!href || /^(?:javascript|data|vbscript):/i.test(href)) return undefined;
	if (/^(?:https?:|mailto:|tel:|\/|#|\?)/i.test(href)) return href;
	return undefined;
};

const RICH_TEXT_OMIT_TAGS = new Set([
	"base",
	"button",
	"embed",
	"form",
	"iframe",
	"input",
	"link",
	"meta",
	"object",
	"script",
	"select",
	"style",
	"template",
	"textarea",
]);

function renderRichTextNode(node: ChildNode, key: string): ReactNode {
	if (node.nodeType === 3) return node.textContent;
	if (node.nodeType !== 1) return null;

	const element = node as Element;
	const tagName = element.tagName.toLowerCase();
	if (RICH_TEXT_OMIT_TAGS.has(tagName)) return null;

	const children = Array.from(element.childNodes).map((child, index) => renderRichTextNode(child, `${key}-${index}`));

	switch (tagName) {
		case "a": {
			const href = isSafeHref(element.getAttribute("href") ?? undefined);
			return href ? (
				<a key={key} href={href}>
					{children}
				</a>
			) : (
				<Fragment key={key}>{children}</Fragment>
			);
		}
		case "br":
			return <br key={key} />;
		case "em":
		case "i":
			return <em key={key}>{children}</em>;
		case "strong":
		case "b":
			return <strong key={key}>{children}</strong>;
		case "del":
		case "s":
			return <del key={key}>{children}</del>;
		case "mark":
			return <mark key={key}>{children}</mark>;
		case "code":
			return <code key={key}>{children}</code>;
		case "blockquote":
			return <blockquote key={key}>{children}</blockquote>;
		case "ol":
			return <ol key={key}>{children}</ol>;
		case "ul":
			return <ul key={key}>{children}</ul>;
		case "li":
			return <li key={key}>{children}</li>;
		case "p":
			return <p key={key}>{children}</p>;
		default:
			return <Fragment key={key}>{children}</Fragment>;
	}
}

function RichText({ html }: { html: string }) {
	if (!html.trim()) return null;

	const body = new DOMParser().parseFromString(html, "text/html").body;
	return Array.from(body.childNodes).map((node, index) => renderRichTextNode(node, `rich-text-${index}`));
}

function hasRenderableRichText(html: string): boolean {
	if (!html.trim()) return false;

	const body = new DOMParser().parseFromString(html, "text/html").body;
	const getText = (node: ChildNode): string => {
		if (node.nodeType === 3) return node.textContent ?? "";
		if (node.nodeType !== 1) return "";

		const element = node as Element;
		if (RICH_TEXT_OMIT_TAGS.has(element.tagName.toLowerCase())) return "";
		return Array.from(element.childNodes).map(getText).join("");
	};

	return Array.from(body.childNodes).some((node) => getText(node).trim().length > 0);
}

type ItemWebsite = { url?: string; label?: string };

type ItemBodyProps = {
	heading?: string;
	headingLevel?: 3 | 4;
	primary?: string;
	details?: string;
	description?: string;
	website?: ItemWebsite;
};

function ItemBody({ heading, headingLevel = 3, primary, details, description, website }: ItemBodyProps) {
	const header = joinInline(primary, details);
	const headingText = heading?.trim();
	const websiteUrl = isSafeHref(website?.url);

	return (
		<>
			{headingText ? headingLevel === 4 ? <h4>{headingText}</h4> : <h3>{headingText}</h3> : null}
			{header ? <p>{header}</p> : null}
			{description ? <RichText html={description} /> : null}
			{websiteUrl ? <a href={websiteUrl}>{website?.label?.trim() || websiteUrl}</a> : null}
		</>
	);
}

function renderItem(type: CustomSectionType, item: CustomSectionItem, keywordLayout?: "inline" | "list"): ReactNode {
	switch (type) {
		case "experience": {
			const it = item as ExperienceItem;
			const roles = it.roles ?? [];

			return (
				<>
					<ItemBody
						heading={roles.length > 0 ? it.company : joinInline(it.position, it.company)}
						details={joinInline(it.location, it.period)}
						description={it.description}
						website={it.website}
					/>
					{roles.length > 0 ? (
						<ul>
							{roles.map((role) => (
								<li key={role.id}>
									<ItemBody
										heading={role.position}
										headingLevel={it.company.trim() ? 4 : 3}
										details={role.period}
										description={role.description}
									/>
								</li>
							))}
						</ul>
					) : null}
				</>
			);
		}
		case "education": {
			const it = item as EducationItem;

			return (
				<ItemBody
					heading={it.school}
					details={joinInline(it.degree, it.area, it.grade, it.location, it.period)}
					description={it.description}
					website={it.website}
				/>
			);
		}
		case "skills": {
			const it = item as SkillItem;

			if (keywordLayout === "list") {
				return (
					<>
						<ItemBody heading={it.name} details={it.proficiency} />
						{it.keywords.length > 0 && (
							<ul>
								{it.keywords.map((keyword, index) => (
									<li key={index}>{keyword}</li>
								))}
							</ul>
						)}
					</>
				);
			}
			return <ItemBody heading={it.name} details={joinInline(it.proficiency, (it.keywords ?? []).join(", "))} />;
		}
		case "interests": {
			const it = item as InterestItem;

			return <ItemBody heading={it.name} details={(it.keywords ?? []).join(", ")} />;
		}
		case "languages": {
			const it = item as LanguageItem;

			return <ItemBody heading={it.language} details={it.fluency} />;
		}
		case "profiles": {
			const it = item as ProfileItem;

			return <ItemBody heading={joinInline(it.network, it.username)} website={it.website} />;
		}
		case "projects": {
			const it = item as ProjectItem;

			return <ItemBody heading={it.name} details={it.period} description={it.description} website={it.website} />;
		}
		case "awards": {
			const it = item as AwardItem;

			return (
				<ItemBody
					heading={it.title}
					details={joinInline(it.awarder, it.date)}
					description={it.description}
					website={it.website}
				/>
			);
		}
		case "certifications": {
			const it = item as CertificationItem;

			return (
				<ItemBody
					heading={it.title}
					details={joinInline(it.issuer, it.date)}
					description={it.description}
					website={it.website}
				/>
			);
		}
		case "publications": {
			const it = item as PublicationItem;

			return (
				<ItemBody
					heading={it.title}
					details={joinInline(it.publisher, it.date)}
					description={it.description}
					website={it.website}
				/>
			);
		}
		case "volunteer": {
			const it = item as VolunteerItem;

			return (
				<ItemBody
					heading={it.organization}
					details={joinInline(it.location, it.period)}
					description={it.description}
					website={it.website}
				/>
			);
		}
		case "references": {
			const it = item as ReferenceItem;

			return (
				<ItemBody
					heading={it.name}
					details={joinInline(it.position, it.phone)}
					description={it.description}
					website={it.website}
				/>
			);
		}
		case "cover-letter": {
			const it = item as CoverLetterItem;

			return <ItemBody description={joinInline(stripHtml(it.recipient), stripHtml(it.content))} />;
		}
		case "summary": {
			const it = item as SummaryItem;

			return <ItemBody description={it.content} />;
		}
		default:
			return null;
	}
}

type AccessibleSectionProps = {
	type: CustomSectionType;
	title: string;
	hidden: boolean;
	items: CustomSectionItem[];
	keywordLayout?: "inline" | "list" | undefined;
};

function AccessibleSection({ type, title, hidden, items, keywordLayout }: AccessibleSectionProps) {
	if (hidden) return null;

	const visibleItems = items.filter((item) => !item.hidden);
	if (visibleItems.length === 0) return null;

	return (
		<section>
			<h2>{title}</h2>
			<ul>
				{visibleItems.map((item) => (
					<li key={item.id}>{renderItem(type, item, keywordLayout)}</li>
				))}
			</ul>
		</section>
	);
}

type ResumeAccessibleTextProps = {
	data?: ResumeData | undefined;
};

/**
 * Visually-hidden, screen-reader-readable mirror of the resume content. The builder preview
 * renders the resume as a rasterized PDF canvas that is opaque to assistive tech, so this
 * structured HTML mirror is the permanent accessibility surface for the live editor.
 *
 * DOM-only: the PDF/export pipeline generates its own document and never reads this markup.
 */
export function ResumeAccessibleText({ data }: ResumeAccessibleTextProps) {
	const builderResumeData = useResumeData();
	const resumeData = data ?? builderResumeData;

	if (!resumeData) return null;

	const { basics, summary, sections, customSections } = resumeData;
	const summaryText = summary && !summary.hidden ? summary.content : "";
	const website = basics.website;

	const contact: ReactNode[] = [];
	if (basics.email) contact.push(<a href={isSafeHref(`mailto:${basics.email}`)}>{basics.email}</a>);
	if (basics.phone) contact.push(<a href={isSafeHref(`tel:${basics.phone}`)}>{basics.phone}</a>);
	if (basics.location) contact.push(basics.location);
	const websiteUrl = isSafeHref(website?.url);
	if (websiteUrl) contact.push(<a href={websiteUrl}>{website.label?.trim() || websiteUrl}</a>);
	for (const field of basics.customFields ?? []) {
		if (!field.text?.trim()) continue;
		const fieldLink = isSafeHref(field.link);
		contact.push(fieldLink ? <a href={fieldLink}>{field.text}</a> : field.text);
	}

	return (
		<section className="sr-only" aria-label={t`Resume content`}>
			<header>
				{basics.name ? <h1>{basics.name}</h1> : null}
				{basics.headline ? <p>{basics.headline}</p> : null}
				{contact.length > 0 ? (
					<ul>
						{contact.map((entry, index) => (
							<li key={index}>{entry}</li>
						))}
					</ul>
				) : null}
			</header>

			{hasRenderableRichText(summaryText) ? (
				<section>
					<h2>{summary.title?.trim() || getSectionTitle("summary")}</h2>
					<RichText html={summaryText} />
				</section>
			) : null}

			{SECTION_ORDER.map((type) => {
				const section = sections[type];
				if (!section) return null;

				return (
					<AccessibleSection
						key={type}
						type={type}
						title={section.title?.trim() || getSectionTitle(type)}
						hidden={section.hidden}
						items={section.items}
						keywordLayout={"keywordLayout" in section ? section.keywordLayout : undefined}
					/>
				);
			})}

			{(customSections ?? []).map((section) => (
				<AccessibleSection
					key={section.id}
					type={section.type}
					title={section.title?.trim() || getSectionTitle(section.type)}
					hidden={section.hidden}
					items={section.items}
					keywordLayout={"keywordLayout" in section ? section.keywordLayout : undefined}
				/>
			))}
		</section>
	);
}
