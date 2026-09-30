import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { getResumeSectionTitle } from "@reactive-resume/pdf/section-title";
import { Icon } from "@reactive-resume/ui/components/icon";
import { contrastOnWhite } from "@reactive-resume/utils/color";
import { cn } from "@reactive-resume/utils/style";
import { reflowOrder } from "./reflow";
import { RichText } from "./rich-text";

type Entry = Record<string, unknown> & { id: string };

// Lists keep their markers and paragraphs their spacing, which the app's reset removes.
const RICH = "grid gap-1 [&_ol]:list-decimal [&_ol]:ps-5 [&_ul]:list-disc [&_ul]:ps-5 [&_a]:underline";

// What each kind of entry leads with, what follows it, and the date or place set beside it.
const SHAPES: Record<string, { title: string[]; subtitle: string[]; meta: string[] }> = {
	experience: { title: ["position", "company"], subtitle: ["company"], meta: ["period", "location"] },
	education: { title: ["school"], subtitle: ["degree", "area", "grade"], meta: ["period", "location"] },
	projects: { title: ["name"], subtitle: [], meta: ["period"] },
	skills: { title: ["name"], subtitle: ["proficiency"], meta: [] },
	languages: { title: ["language"], subtitle: ["fluency"], meta: [] },
	interests: { title: ["name"], subtitle: [], meta: [] },
	awards: { title: ["title"], subtitle: ["awarder"], meta: ["date"] },
	certifications: { title: ["title"], subtitle: ["issuer"], meta: ["date"] },
	publications: { title: ["title"], subtitle: ["publisher"], meta: ["date"] },
	volunteer: { title: ["organization"], subtitle: [], meta: ["period", "location"] },
	references: { title: ["name"], subtitle: ["position"], meta: [] },
	profiles: { title: ["network"], subtitle: ["username"], meta: [] },
	summary: { title: [], subtitle: [], meta: [] },
	"cover-letter": { title: [], subtitle: [], meta: [] },
};

const text = (entry: Entry, field: string) => (typeof entry[field] === "string" ? (entry[field] as string).trim() : "");

function sectionOf(data: ResumeData, sectionId: string): { type: string; items: Entry[] } | null {
	if (sectionId === "summary") return { type: "summary", items: [{ id: "content", content: data.summary.content }] };
	if (sectionId in data.sections) {
		const section = data.sections[sectionId as keyof ResumeData["sections"]];
		return { type: sectionId, items: section.items as unknown as Entry[] };
	}
	const custom = data.customSections.find((section) => section.id === sectionId);
	return custom ? { type: custom.type, items: custom.items as unknown as Entry[] } : null;
}

function EntryView({ type, entry }: { type: string; entry: Entry }) {
	const shape = SHAPES[type] ?? SHAPES.projects;
	const roles = Array.isArray(entry.roles) ? (entry.roles as Entry[]).filter((role) => text(role, "position")) : [];
	const repeatedPosition =
		type === "experience" && roles.some((role) => text(role, "position") === text(entry, "position"));
	const title =
		shape?.title
			.filter((field) => !repeatedPosition || field !== "position")
			.map((field) => text(entry, field))
			.find(Boolean) ?? "";
	const subtitle = [
		...(type === "experience" && text(entry, "position") ? ["company"] : []),
		...(shape?.subtitle.filter((field) => field !== "company") ?? []),
	]
		.map((field) => text(entry, field))
		.filter((value) => value && value !== title);
	const meta = shape?.meta.map((field) => text(entry, field)).filter(Boolean) ?? [];
	const website = entry.website as { url?: string; label?: string } | undefined;
	const url = typeof entry.url === "string" ? entry.url : website?.url;
	const keywords = Array.isArray(entry.keywords) ? (entry.keywords as string[]).filter(Boolean) : [];
	const html = text(entry, "content") || text(entry, "description");

	return (
		<article className="grid gap-0.5">
			{title && <h3 className="font-semibold">{title}</h3>}
			{(subtitle.length > 0 || meta.length > 0) && (
				<p className="text-[14px] text-[#555]">{[...subtitle, ...meta].join(" · ")}</p>
			)}
			{url && /^https?:/i.test(url) && (
				<a className="w-fit text-[14px] underline" href={url} target="_blank" rel="noopener noreferrer nofollow">
					{website?.label || url.replace(/^https?:\/\//, "")}
				</a>
			)}
			{keywords.length > 0 && <p className="text-[14px] text-[#555]">{keywords.join(", ")}</p>}
			{html && <RichText html={html} className={cn(RICH, "mt-1")} />}
			{roles.map((role) => (
				<div key={role.id} className="mt-1.5 grid gap-0.5">
					<h4 className="font-medium">{text(role, "position")}</h4>
					{text(role, "period") && <p className="text-[14px] text-[#555]">{text(role, "period")}</p>}
					{text(role, "description") && <RichText html={text(role, "description")} className={RICH} />}
				</div>
			))}
		</article>
	);
}

type ContactPill = { icon: IconName; label: string; href: string };

function contactPills(basics: ResumeData["basics"]): ContactPill[] {
	const pills: ContactPill[] = [];
	if (basics.email) pills.push({ icon: "mail", label: basics.email, href: `mailto:${basics.email}` });
	if (basics.phone) pills.push({ icon: "call", label: basics.phone, href: `tel:${basics.phone.replace(/\s+/g, "")}` });
	if (basics.website.url)
		pills.push({
			icon: "language",
			label: basics.website.label || basics.website.url.replace(/^https?:\/\//, ""),
			href: basics.website.url,
		});
	for (const field of basics.customFields)
		if (field.text && /^(https?:|mailto:|tel:)/i.test(field.link))
			pills.push({ icon: "link", label: field.text, href: field.link });
	return pills;
}

type ResumeReflowProps = { data: ResumeData };

/**
 * Phones: the resume as readable text at 15px, in the order the PDF prints it and in the template's colour and body
 * font. Contact details are tap targets. The PDF stays the exact page.
 */
export function ResumeReflow({ data }: ResumeReflowProps) {
	const order = reflowOrder(data);
	const { basics } = data;
	// The template's colour, darkened where it would be too faint to read on white.
	const primary = data.metadata.design.colors.primary;
	const accent = contrastOnWhite(primary) >= 4.5 ? primary : `color-mix(in srgb, ${primary} 70%, black)`;
	const font = data.metadata.typography.body.fontFamily;

	return (
		<div
			lang={data.metadata.page.locale}
			className="grid gap-6 bg-white px-5 py-6 text-[15px] leading-[1.5] text-[#1a1a1a]"
			style={{ fontFamily: `"${font}", ui-sans-serif, system-ui, sans-serif` }}
		>
			<header className="grid gap-2">
				<h1 className="text-[26px] leading-tight font-semibold">{basics.name}</h1>
				{(basics.headline || basics.location) && (
					<p className="text-[#555]">{[basics.headline, basics.location].filter(Boolean).join(" · ")}</p>
				)}
				<ul className="flex flex-wrap gap-2">
					{contactPills(basics).map((pill) => (
						<li key={pill.href}>
							<a
								href={pill.href}
								className="flex h-9 items-center gap-1.5 rounded-full border border-[#ddd] px-3 text-[14px]"
								{...(pill.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}
							>
								<Icon name={pill.icon} size={18} />
								<span className="max-w-[16rem] truncate">{pill.label}</span>
							</a>
						</li>
					))}
				</ul>
			</header>

			{order.map(({ sectionId, itemIds }) => {
				const section = sectionOf(data, sectionId);
				if (!section) return null;
				const entries = itemIds.length
					? itemIds.map((id) => section.items.find((item) => item.id === id)).filter((item): item is Entry => !!item)
					: section.items.filter((item) => !item.hidden);
				if (entries.length === 0) return null;
				return (
					<section key={sectionId} className="grid gap-3">
						<h2 className="border-b pb-1 text-[17px] font-semibold" style={{ color: accent, borderColor: accent }}>
							{getResumeSectionTitle(data, sectionId)}
						</h2>
						{entries.map((entry) => (
							<EntryView key={entry.id} type={section.type} entry={entry} />
						))}
					</section>
				);
			})}
		</div>
	);
}
