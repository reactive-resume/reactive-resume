import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import type { ReactNode } from "react";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Slider } from "@reactive-resume/ui/components/slider";
import { isRTL } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "../store";
import { DecimalInput, Field } from "./fields";
import { useTemplateThumbnail } from "./thumbnails";
import { Chip, FilterField } from "@/components/calm/filter-bar";
import { templates } from "@/dialogs/resume/template/data";
import { useResumeData, useResumeStore, useUpdateResumeData } from "@/features/resume/builder/draft";
import { undoToast } from "@/features/resume/builder/undo-toast";

type Filter = "all" | "one" | "two" | "ats";
const TEMPLATE_IDS = Object.keys(templates) as Template[];
const matchesFilter = (id: Template, filter: Filter) =>
	filter === "all" ||
	(filter === "one"
		? templateLayouts[id].columns === 1
		: filter === "two"
			? templateLayouts[id].columns === 2
			: templateLayouts[id].atsSafe);
const layoutTags = (id: Template) =>
	[templateLayouts[id].columns === 1 ? t`One column` : t`Two columns`, templateLayouts[id].atsSafe ? t`ATS-safe` : null]
		.filter(Boolean)
		.join(" · ");

/** The template's style tags, after its column count (which the layout tag already says). */
const styleTags = (id: Template) =>
	[
		templateLayouts[id].columns === 1 ? t`One column` : t`Two columns`,
		...templates[id].tags.filter((tag) => !/^(single|two)-column$/i.test(tag)),
	].join(" · ");

type TemplateGroupProps = {
	/** The way back up: the crumb above the title. */
	crumb?: ReactNode;
	onUse?: () => void;
};

/**
 * Template (B7): every template in the wide panel, filtered by columns, ATS safety or words. A click previews it on
 * the user's own page; nothing changes until Use this template, and Keep or Escape goes back.
 */
export function TemplateGroup({ crumb, onUse }: TemplateGroupProps) {
	const data = useResumeData();
	const [filter, setFilter] = useState<Filter>("all");
	const [query, setQuery] = useState("");
	const filterRef = useRef<HTMLInputElement>(null);
	const preview = useEditorStore((state) => state.previewTemplate);
	useEffect(() => () => useEditorStore.setState({ previewTemplate: null }), []);
	// "/" goes to the filter, unless something else takes typing.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
			if (target?.closest("input, textarea, [contenteditable=true]")) return;
			event.preventDefault();
			filterRef.current?.focus();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);
	if (!data) return null;
	const current = data.metadata.template;
	const chosen = preview ?? current;
	const shown = TEMPLATE_IDS.filter(
		(id) =>
			matchesFilter(id, filter) &&
			[templates[id].name, i18n._(templates[id].description), ...templates[id].tags]
				.join(" ")
				.toLocaleLowerCase()
				.includes(query.trim().toLocaleLowerCase()),
	);
	const filters: { id: Filter; label: string }[] = [
		{ id: "all", label: t`All` },
		{ id: "one", label: t`One column` },
		{ id: "two", label: t`Two columns` },
		{ id: "ats", label: t`ATS-safe` },
	];
	const cancel = () => useEditorStore.setState({ previewTemplate: null });
	const use = () => {
		if (!preview) return;
		useResumeStore.getState().updateResumeData(
			(draft) => {
				draft.metadata.template = preview;
			},
			{ newStep: true },
		);
		undoToast(t`Template changed to ${templates[preview].name}`);
		cancel();
		onUse?.();
	};
	return (
		<div
			role="group"
			aria-label={t`Template preview`}
			className="flex min-h-0 grow flex-col pb-5"
			onKeyDown={(event) => {
				if (event.key === "Escape" && preview) {
					event.stopPropagation();
					cancel();
				}
			}}
		>
			{crumb}
			<div className="mt-0.5 flex flex-wrap items-center gap-4">
				<h2 className="me-auto t-page-title">
					<Trans>Template</Trans>
				</h2>
				<div role="group" aria-label={t`Show templates`} className="flex flex-wrap gap-1.5">
					{filters.map((option) => (
						<Chip key={option.id} pressed={filter === option.id} onClick={() => setFilter(option.id)}>
							{option.label}
							<span className={cn("font-mono text-xs/4 font-medium", filter !== option.id && "text-ink-3")}>
								{i18n.number(TEMPLATE_IDS.filter((id) => matchesFilter(id, option.id)).length)}
							</span>
						</Chip>
					))}
				</div>
				<FilterField
					ref={filterRef}
					label={t`Filter templates`}
					icon="funnel"
					shortcut="/"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
			</div>
			<div
				role="group"
				aria-label={plural(shown.length, { one: "# template", other: "# templates" })}
				className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-[18px] min-[1280px]:grid-cols-6"
			>
				{shown.map((id) => (
					<TemplateCard
						key={id}
						id={id}
						data={data}
						current={id === current}
						previewing={id === preview}
						onPreview={() => useEditorStore.setState({ previewTemplate: id === current ? null : id })}
					/>
				))}
			</div>
			{shown.length === 0 && (
				<p className="py-4 t-small text-ink-3">
					<Trans>No templates match your filter.</Trans>
				</p>
			)}
			{/* Over the canvas, beside the page it changes: its start edge follows the panel's width. */}
			<div
				role="status"
				aria-label={templates[chosen].name}
				className="mt-auto flex flex-col gap-1.5 border-t border-line pt-3 min-[1280px]:fixed min-[1280px]:start-[calc(var(--editor-panel)+24px)] min-[1280px]:end-6 min-[1280px]:bottom-5 min-[1280px]:z-20 min-[1280px]:rounded-xl min-[1280px]:border min-[1280px]:bg-raised min-[1280px]:px-[18px] min-[1280px]:py-3.5 min-[1280px]:shadow-e2"
			>
				<div className="flex items-baseline gap-2.5">
					<h3 className="t-section-title">{templates[chosen].name}</h3>
					<span className="t-small text-ink-3">{styleTags(chosen)}</span>
					<span className="sr-only">{preview ? t`Previewing` : t`Current`}</span>
				</div>
				<p className="t-small text-ink-2">{i18n._(templates[chosen].description)}</p>
				{!templateLayouts[chosen].atsSafe && (
					<p className="flex items-center gap-1.5 t-small text-warn-text">
						<Icon name="warning-circle" size={16} />
						<span>
							<Trans>Not ATS-safe: two columns can be read out of order.</Trans>
						</span>
					</p>
				)}
				<div className="mt-1 flex justify-end gap-2">
					<Button variant="secondary" onClick={cancel}>
						<Trans>Keep {templates[current].name}</Trans>
					</Button>
					{/* Ink, not the accent: Download PDF stays the one accent button. */}
					<Button
						disabled={!preview}
						className="bg-ink text-bg hover:bg-[color-mix(in_oklab,var(--ink),var(--bg)_14%)]"
						onClick={use}
					>
						<Trans>Use this template</Trans>
					</Button>
				</div>
			</div>
		</div>
	);
}

type TemplateCardProps = {
	id: Template;
	data: ResumeData;
	current: boolean;
	previewing: boolean;
	onPreview: () => void;
};
function TemplateCard({ id, data, current, previewing, onPreview }: TemplateCardProps) {
	const ref = useRef<HTMLButtonElement>(null);
	const visible = useInView(ref, { margin: "240px" });
	const resumeId = useResumeStore((state) => state.resume?.id ?? "");
	const { data: thumbnail } = useTemplateThumbnail(id, data, visible, resumeId);
	return (
		<button
			ref={ref}
			type="button"
			aria-pressed={previewing || current}
			aria-label={t`Preview ${templates[id].name}`}
			onClick={onPreview}
			className="flex min-w-0 flex-col text-start"
		>
			<span
				className={cn(
					"relative block aspect-page overflow-hidden rounded-paper bg-paper shadow-e1 ring-1 ring-line",
					previewing && "shadow-none ring-2 ring-accent ring-offset-2 ring-offset-bg",
				)}
			>
				<img src={thumbnail ?? templates[id].imageUrl} alt="" className="size-full object-cover object-top" />
			</span>
			<span className="mt-[7px] flex items-center gap-1.5 t-ui font-medium">
				{templates[id].name}
				{previewing ? (
					<Badge variant="accent">{t`Previewing`}</Badge>
				) : (
					current && (
						<Badge>
							<Icon name="check" size={14} />
							{t`Current`}
						</Badge>
					)
				)}
			</span>
			<span className="t-caption font-normal text-ink-3">{layoutTags(id)}</span>
		</button>
	);
}

type SidebarPanelProps = { data: ResumeData; template: Template };

/** Two-column templates: the sidebar's side and width. Write moves sections between columns. */
export function SidebarPanel({ data, template }: SidebarPanelProps) {
	const updateResumeData = useUpdateResumeData();
	// The side the page shows now: the chosen one, else the template's own (mirrored on right-to-left pages).
	const ownSide = templateLayouts[template].sidebarSide ?? "left";
	const shownOwnSide = isRTL(data.metadata.page.locale) ? (ownSide === "left" ? "right" : "left") : ownSide;
	const side = data.metadata.layout.sidebarSide ?? shownOwnSide;
	const width = data.metadata.layout.sidebarWidth;

	return (
		<>
			<Field label={<Trans>Side</Trans>}>
				<SegmentedControl
					aria-label={t`Sidebar side`}
					value={side}
					onValueChange={(value) =>
						updateResumeData(
							(draft) => {
								draft.metadata.layout.sidebarSide = value === "right" ? "right" : "left";
							},
							{ newStep: true },
						)
					}
					className="w-full"
				>
					<SegmentedControlItem value="left">
						<Trans>Left</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="right">
						<Trans>Right</Trans>
					</SegmentedControlItem>
				</SegmentedControl>
			</Field>
			<Field
				className="mt-3.5"
				label={<Trans>Width</Trans>}
				help={
					<span className="flex items-baseline font-mono text-xs/4 font-medium text-ink-2">
						<DecimalInput
							aria-label={t`Sidebar width`}
							value={width}
							min={10}
							max={50}
							step={0.1}
							className="text-end focus-visible:underline"
							onValueChange={(value) =>
								updateResumeData(
									(draft) => {
										draft.metadata.layout.sidebarWidth = value;
									},
									{ coalesceKey: "design.sidebarWidth" },
								)
							}
						/>
						<span aria-hidden="true">%</span>
					</span>
				}
			>
				<div className="flex h-5 items-center">
					<Slider
						aria-label={t`Sidebar width`}
						min={10}
						max={50}
						step={0.01}
						value={[width]}
						className="flex-1"
						onValueChange={(value) =>
							updateResumeData(
								(draft) => {
									draft.metadata.layout.sidebarWidth = Array.isArray(value) ? (value[0] ?? width) : value;
								},
								{ coalesceKey: "design.sidebarWidth" },
							)
						}
					/>
				</div>
			</Field>
		</>
	);
}
