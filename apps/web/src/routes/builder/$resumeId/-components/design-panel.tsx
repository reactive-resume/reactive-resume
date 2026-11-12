import type { DesignCategory } from "@/components/calm/category-strip";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Fragment, useEffect, useState } from "react";
import { filterSections } from "@reactive-resume/pdf/filtering";
import { entryHeaderOf } from "@reactive-resume/schema/resume/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { CustomStylesSectionBuilder } from "../-sidebar/right/sections/custom-styles";
import { ColorSectionForm } from "../-sidebar/right/sections/design";
import { LayoutSectionBuilder } from "../-sidebar/right/sections/layout";
import { PageSectionBuilder } from "../-sidebar/right/sections/page";
import { TypographySectionBuilder } from "../-sidebar/right/sections/typography";
import { CategoryStrip, DESIGN_CATEGORIES, getDesignCategoryLabel } from "@/components/calm/category-strip";
import { Crumb, CrumbButton } from "@/components/calm/crumb";
import { List, ListRow } from "@/components/calm/list-row";
import { templates } from "@/dialogs/resume/template/data";
import { getLocaleOptions } from "@/features/locale/locale-options";
import { useIsResumeLocked, useResumeData, useUpdateResumeData } from "@/features/resume/builder/draft";
import { undoToast } from "@/features/resume/builder/undo-toast";
import { PanelBody, PanelHeader } from "@/features/resume/editor/chrome/panel";
import { EntriesGroup } from "@/features/resume/editor/design/entries-group";
import { ACCENTS, matchDensity, matchMargins, rgbaToHex } from "@/features/resume/editor/design/presets";
import { ColorGroup } from "@/features/resume/editor/design/style-groups";
import { TemplateGroup } from "@/features/resume/editor/design/template-group";
import { LockedNote } from "@/features/resume/editor/write/write-panel";

const ICONS: Record<DesignCategory, IconName> = {
	template: "layout",
	layout: "columns",
	entries: "rows",
	typography: "text-aa",
	color: "palette",
	page: "file",
	css: "code",
};

export function DesignPanel() {
	const data = useResumeData();
	const locked = useIsResumeLocked();
	const [category, setCategory] = useState<DesignCategory | null>(null);
	// The slot belongs to the frame; restore its width whenever this category leaves.
	useEffect(() => {
		if (category !== "template") return;
		const parent = document.getElementById("editor-panel")?.parentElement;
		if (!parent) return;
		const before = parent.style.getPropertyValue("--editor-panel");
		parent.style.setProperty("--editor-panel", "clamp(380px, 65vw, 936px)");
		return () => {
			if (before) parent.style.setProperty("--editor-panel", before);
			else parent.style.removeProperty("--editor-panel");
		};
	}, [category]);
	if (!data) return null;
	const { metadata } = data;
	const template = templates[metadata.template];
	const columns = templateLayouts[metadata.template];
	const visible = filterSections(
		metadata.layout.pages.flatMap((page) => [...page.main, ...page.sidebar]),
		data,
	).length;
	const hidden = [data.summary, ...Object.values(data.sections), ...data.customSections].filter(
		(section) => section.hidden,
	).length;
	const entry = entryHeaderOf(metadata.design);
	const accent = ACCENTS.find((value) => value.hex === rgbaToHex(metadata.design.colors.primary));
	const margins = matchMargins(metadata);
	const density = matchDensity(metadata);
	const marginLabel = margins
		? { narrow: t`narrow margins`, normal: t`normal margins`, wide: t`wide margins` }[margins]
		: t`custom margins`;
	const densityLabel = density
		? { compact: t`compact density`, normal: t`normal density`, roomy: t`roomy density` }[density]
		: t`custom density`;
	const locale = getLocaleOptions().find((value) => value.value === metadata.page.locale);
	const layoutLabel = {
		stacked: t`Stacked headers`,
		inline: t`One-line headers`,
		compact: t`Compact headers`,
		"date-column": t`Date column`,
		eyebrow: t`Eyebrow headers`,
	}[entry.layout];
	const levelLabel = {
		hidden: t`levels hidden`,
		circle: t`circle levels`,
		square: t`square levels`,
		rectangle: t`rectangle levels`,
		"rectangle-full": t`full-width levels`,
		"progress-bar": t`progress bar levels`,
		icon: t`icon levels`,
	}[metadata.design.level.type];
	const dateLabel = { short: t`Mar 2022`, long: t`March 2022`, numeric: "03/2022", iso: "2022-03" }[
		metadata.page.dateFormat ?? "short"
	];
	const summaries: Record<DesignCategory, string> = {
		template: `${template.name} · ${columns.columns === 1 ? t`One column` : t`Two columns`}${columns.atsSafe ? ` · ${t`ATS-safe`}` : ""}`,
		layout: `${plural(metadata.layout.pages.length, { one: "One page", other: "# pages" })} · ${t`${visible} sections shown, ${hidden} hidden`}`,
		entries: `${layoutLabel} · ${entry.lead === "organization" ? t`company first` : t`position first`}\n${entry.accent === "none" ? t`No accent` : { rule: t`Rule accent`, bar: t`Bar accent`, band: t`Band accent` }[entry.accent]} · ${levelLabel}`,
		typography: t`Headings in ${metadata.typography.heading.fontFamily}, ${metadata.typography.heading.fontSize} pt\nBody in ${metadata.typography.body.fontFamily}, ${metadata.typography.body.fontSize} pt`,
		color:
			["#000000", "#1D1D1F"].includes(rgbaToHex(metadata.design.colors.text) ?? "") &&
			rgbaToHex(metadata.design.colors.background) === "#FFFFFF"
				? t`${accent ? i18n._(accent.label) : t`Custom`} accent · near-black text on white`
				: t`${accent ? i18n._(accent.label) : t`Custom`} accent · ${rgbaToHex(metadata.design.colors.text) ?? metadata.design.colors.text} text`,
		page: `${metadata.page.format === "a4" ? "A4" : metadata.page.format === "letter" ? t`Letter` : t`Free-form`} · ${marginLabel} · ${densityLabel}\n${locale?.textValue ?? metadata.page.locale} · ${t`dates as ${dateLabel}`}`,
		css: metadata.stylesheet?.source.text.trim() ? t`Custom rules` : t`No custom rules`,
	};
	return (
		<PanelBody
			className={cn(category && "pt-3.5", category === "template" && "px-7")}
			data-design-category={category ?? "overview"}
		>
			{category ? (
				<>
					<div className="flex items-center justify-between gap-2">
						<Crumb>
							<CrumbButton onClick={() => setCategory(null)}>
								<Trans>Design</Trans>
							</CrumbButton>
						</Crumb>
						{category !== "template" && <CategoryStrip current={category} onSelect={setCategory} className="-me-1.5" />}
					</div>
					<PanelHeader title={getDesignCategoryLabel(category)} className="mt-0.5" />
				</>
			) : (
				<PanelHeader title={<Trans>Design</Trans>} />
			)}
			{locked && <LockedNote className="mt-3" />}
			<fieldset disabled={locked && category !== null} className="m-0 flex min-w-0 grow flex-col border-0 p-0">
				{!category && (
					<>
						<List className="mt-2">
							{DESIGN_CATEGORIES.map((value) => (
								<ListRow
									key={value}
									leading={
										<span className="flex w-6 shrink-0">
											<Icon name={ICONS[value]} className="text-ink-2" />
										</span>
									}
									title={getDesignCategoryLabel(value)}
									subtitle={
										<span className="block w-full t-small">
											{summaries[value].split("\n").map((line, index) => (
												<Fragment key={line}>
													{index > 0 && <br />}
													{line}
												</Fragment>
											))}
										</span>
									}
									caret
									interactive
									render={<button type="button" onClick={() => setCategory(value)} />}
								/>
							))}
						</List>
						<fieldset disabled={locked} className="contents">
							<ResetDesign />
						</fieldset>
					</>
				)}
				{category === "template" && <TemplateGroup onUse={() => setCategory("layout")} />}
				{category === "layout" && (
					<div className="grid gap-4 pt-1">
						<p className="t-small text-ink-3">
							{columns.columns === 2
								? t`${template.name} has two columns: a sidebar and a main column.`
								: t`${template.name} has one column.`}
						</p>
						<LayoutSectionBuilder />
					</div>
				)}
				{category === "entries" && <EntriesGroup />}
				{category === "typography" && <TypographySectionBuilder />}
				{category === "color" && (
					<div className="grid gap-0">
						<ColorGroup />
						<section className="grid gap-0">
							<h3 className="pt-6 pb-2 t-section-title">
								<Trans>Text and background</Trans>
							</h3>
							<ColorSectionForm includePrimary={false} />
							<p className="mt-2 t-caption text-ink-3">
								<Trans>Near-black text on white prints cleanly and is what applicant tracking systems expect.</Trans>
							</p>
						</section>
					</div>
				)}
				{category === "page" && <PageSectionBuilder />}
				{category === "css" && <CustomCss />}
			</fieldset>
		</PanelBody>
	);
}

function ResetDesign() {
	const update = useUpdateResumeData();
	return (
		<div className="mt-auto border-t border-line pt-3 pb-5">
			<Button
				variant="ghost"
				className="-ms-3.5"
				onClick={() => {
					update(
						(draft) => {
							const defaults = defaultResumeData.metadata;
							draft.metadata.typography = structuredClone(defaults.typography);
							draft.metadata.design = structuredClone(defaults.design);
							draft.metadata.layout.sidebarWidth = defaults.layout.sidebarWidth;
							const { gapX, gapY, marginX, marginY, hideIcons, hideLinkUnderline, hideSectionIcons } = defaults.page;
							Object.assign(draft.metadata.page, {
								gapX,
								gapY,
								marginX,
								marginY,
								hideIcons,
								hideLinkUnderline,
								hideSectionIcons,
							});
						},
						{ newStep: true },
					);
					undoToast(t`Design reset to defaults`);
				}}
			>
				<Icon name="arrow-counter-clockwise" />
				<Trans>Reset design to defaults</Trans>
			</Button>
			<p className="t-caption text-ink-3">
				<Trans>
					Resets fonts, colors, entries, margins and spacing. Your template, paper, language, section order and custom
					CSS stay.
				</Trans>
			</p>
		</div>
	);
}

function CustomCss() {
	const data = useResumeData();
	const update = useUpdateResumeData();
	const text = data?.metadata.stylesheet?.source.text ?? "";
	const targets = [
		["header", t`Your name and contact details`],
		['section[type="skills"]', t`Every section of one kind`],
		["section-heading", t`Section titles`],
		["item", t`One entry`],
		["item-header", t`An entry's top row`],
		['field[name="position"]', t`One named field`],
		["list-item", t`A bullet`],
		["--resume-primary-color", t`Your accent, read-only`],
	];
	return (
		<div className="flex grow flex-col gap-3 pt-1">
			<p className="t-small text-ink-3">
				<Trans>
					For details the other categories don't cover. Rules apply to the page, the PDF and your public page.
				</Trans>
			</p>
			<CustomStylesSectionBuilder />
			<div>
				<h3 className="mb-3 t-section-title">
					<Trans>What you can target</Trans>
				</h3>
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 t-caption">
					{targets.map(([selector, label]) => (
						<div key={selector} className="contents">
							<dt className="py-1 font-mono">{selector}</dt>
							<dd className="py-1 text-ink-3">{label}</dd>
						</div>
					))}
				</dl>
			</div>
			<div className="mt-auto border-t border-line pt-2 pb-4">
				<Button
					variant="ghost"
					className="-ms-3.5"
					disabled={!text}
					onClick={() => {
						update(
							(draft) => {
								draft.metadata.stylesheet = { mode: "semantic", source: { languageVersion: 1, text: "" } };
							},
							{ newStep: true },
						);
						undoToast(t`Custom CSS cleared`);
					}}
				>
					<Icon name="eraser" />
					<Trans>Clear custom CSS</Trans>
				</Button>
				<p className="t-caption text-ink-3">
					<Trans>
						Undo brings your rules back, and History keeps every saved version. Reset design never touches your CSS.
					</Trans>
				</p>
			</div>
		</div>
	);
}

export function DesignSheet() {
	const [expanded, setExpanded] = useState(false);
	return (
		<section
			aria-label={t`Design`}
			className={cn(
				"absolute inset-x-0 bottom-0 z-20 flex h-[calc(100%-1rem)] flex-col rounded-t-2xl border-t border-line bg-bg shadow-e3 transition-[translate] duration-emphasized ease-enter",
				!expanded && "translate-y-[calc(50%-0.5rem)]",
			)}
		>
			<button
				type="button"
				aria-expanded={expanded}
				aria-label={expanded ? t`Lower the design sheet` : t`Raise the design sheet`}
				onClick={() => setExpanded(!expanded)}
				className="flex h-6 shrink-0 items-center justify-center"
			>
				<span className="h-1 w-9 rounded-full bg-line-2" />
			</button>
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
				<DesignPanel />
				{!expanded && <div aria-hidden="true" className="h-[45svh] shrink-0" />}
			</div>
		</section>
	);
}
