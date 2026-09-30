import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import type { FocusEvent, KeyboardEvent, PointerEvent } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useEffect, useId, useRef, useState } from "react";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Slider } from "@reactive-resume/ui/components/slider";
import { toast } from "@reactive-resume/ui/components/toast";
import { isRTL } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "../store";
import { useTemplateThumbnail } from "./thumbnails";
import { templates } from "@/dialogs/resume/template/data";
import { useResumeData, useResumeStore, useUpdateResumeData } from "@/features/resume/builder/draft";

type Filter = "all" | "one" | "two" | "ats";

const TEMPLATE_IDS = Object.keys(templates) as Template[];

const matchesFilter = (id: Template, filter: Filter) => {
	const layout = templateLayouts[id];
	if (filter === "one") return layout.columns === 1;
	if (filter === "two") return layout.columns === 2;
	if (filter === "ats") return layout.atsSafe;
	return true;
};

const layoutTags = (id: Template) => {
	const layout = templateLayouts[id];
	return [layout.columns === 1 ? t`One column` : t`Two columns`, layout.atsSafe ? t`ATS-safe` : null]
		.filter(Boolean)
		.join(" · ");
};

/** Applies a template with the page's cross-fade and an Undo toast. Font, size and colour carry across. */
function applyTemplate(template: Template) {
	const { resume, updateResumeData, undo } = useResumeStore.getState();
	useEditorStore.getState().setPreviewTemplate(null);
	if (!resume || resume.data.metadata.template === template) return;

	updateResumeData(
		(draft) => {
			draft.metadata.template = template;
		},
		{ newStep: true },
	);
	toast.add({
		description: t`Template changed to ${templates[template].name}`,
		actionProps: { children: t`Undo`, onClick: undo },
	});
}

// Touch has no hover: holding a card this long previews it instead.
const HOLD_TO_PREVIEW_MS = 400;

type TemplateGroupProps = {
	/** Phones: one horizontal strip of cards in the bottom sheet, instead of the two-column grid. */
	layout?: "grid" | "strip";
};

/**
 * Template: filter chips, then thumbnails drawn from the user's own content. Hovering or focusing one (holding
 * it, on touch) previews it on the page; leaving the cards or pressing Esc restores the page; a click applies it.
 */
export function TemplateGroup({ layout = "grid" }: TemplateGroupProps) {
	const data = useResumeData();
	const [filter, setFilter] = useState<Filter>("all");
	const setPreview = useEditorStore((state) => state.setPreviewTemplate);
	// Leaving Design (by shortcut, say) never leaves a preview on the page.
	useEffect(() => () => setPreview(null), [setPreview]);
	if (!data) return null;

	const current = data.metadata.template;
	const shown = TEMPLATE_IDS.filter((id) => matchesFilter(id, filter));
	const filters: { id: Filter; label: string }[] = [
		{ id: "all", label: t`All` },
		{ id: "one", label: t`One column` },
		{ id: "two", label: t`Two columns` },
		{ id: "ats", label: t`ATS-safe` },
	];

	const onGridBlur = (event: FocusEvent<HTMLDivElement>) => {
		if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPreview(null);
	};
	const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "Escape" || !useEditorStore.getState().previewTemplate) return;
		event.stopPropagation();
		setPreview(null);
	};

	return (
		<div className="grid gap-3">
			<RadioGroup
				aria-label={t`Show templates`}
				value={filter}
				onValueChange={(value) => setFilter(value as Filter)}
				className="flex flex-wrap items-center gap-1.5"
			>
				{filters.map((option) => (
					<Radio.Root
						key={option.id}
						value={option.id}
						className="flex h-7 cursor-pointer items-center rounded-full border border-line-2 px-3 text-[13px] text-ink-2 transition-colors duration-quick hover:bg-hover data-checked:border-accent data-checked:bg-accent-soft data-checked:font-medium data-checked:text-accent-text"
					>
						{option.label}
					</Radio.Root>
				))}
				<span className="ms-auto text-xs text-ink-3">
					<Trans>
						{shown.length} of {TEMPLATE_IDS.length} shown
					</Trans>
				</span>
			</RadioGroup>

			{/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- listens for Esc and pointer exit from the cards; each card is a button. */}
			<div
				className={
					layout === "grid"
						? "grid grid-cols-2 gap-3"
						: "-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 *:w-28 *:shrink-0 *:snap-start"
				}
				onPointerLeave={() => setPreview(null)}
				onBlur={onGridBlur}
				onKeyDown={onGridKeyDown}
			>
				{shown.map((id) => (
					<TemplateCard
						key={id}
						id={id}
						data={data}
						selected={id === current}
						onPreview={() => setPreview(id === current ? null : id)}
					/>
				))}
			</div>

			{templateLayouts[current].columns === 2 && <SidebarPanel data={data} template={current} />}
		</div>
	);
}

type TemplateCardProps = { id: Template; data: ResumeData; selected: boolean; onPreview: () => void };

function TemplateCard({ id, data, selected, onPreview }: TemplateCardProps) {
	const { data: thumbnail } = useTemplateThumbnail(id, data, true);
	const metadata = templates[id];
	const hold = useRef<{ timer?: number; previewing: boolean }>({ previewing: false });

	const endHold = () => {
		window.clearTimeout(hold.current.timer);
		if (hold.current.previewing) useEditorStore.getState().setPreviewTemplate(null);
	};

	return (
		<button
			type="button"
			aria-pressed={selected}
			onPointerEnter={(event: PointerEvent) => {
				if (event.pointerType !== "touch") onPreview();
			}}
			onPointerDown={(event: PointerEvent) => {
				if (event.pointerType !== "touch") return;
				hold.current.previewing = false;
				hold.current.timer = window.setTimeout(() => {
					hold.current.previewing = true;
					onPreview();
				}, HOLD_TO_PREVIEW_MS);
			}}
			onPointerUp={endHold}
			onPointerCancel={endHold}
			// A long press shows the preview; it doesn't open the system menu or apply the template.
			onContextMenu={(event) => event.preventDefault()}
			onFocus={onPreview}
			onClick={() => {
				if (hold.current.previewing) {
					hold.current.previewing = false;
					return;
				}
				applyTemplate(id);
			}}
			className="group/card grid gap-1.5 rounded-lg text-start"
		>
			<span
				className={cn(
					"relative block aspect-page overflow-hidden rounded-md border border-line bg-white shadow-e1 transition-[translate,scale,box-shadow] duration-quick ease-enter group-hover/card:-translate-y-0.5 group-hover/card:shadow-e2 group-active/card:scale-[0.98]",
					selected && "ring-2 ring-accent ring-offset-2 ring-offset-surface",
				)}
			>
				<img src={thumbnail ?? metadata.imageUrl} alt="" className="size-full object-cover object-top" />
				{selected && (
					<span className="absolute end-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-accent text-on-accent">
						<Icon name="check" size={14} />
					</span>
				)}
			</span>
			<span className="text-sm leading-4 font-medium">{metadata.name}</span>
			<span className="text-xs leading-4 text-ink-3">{layoutTags(id)}</span>
		</button>
	);
}

type SidebarPanelProps = { data: ResumeData; template: Template };

/** Two-column templates: the sidebar's side and width. Write moves sections between columns. */
function SidebarPanel({ data, template }: SidebarPanelProps) {
	const updateResumeData = useUpdateResumeData();
	// The side the page shows now: the chosen one, else the template's own (mirrored on right-to-left pages).
	const ownSide = templateLayouts[template].sidebarSide ?? "left";
	const shownOwnSide = isRTL(data.metadata.page.locale) ? (ownSide === "left" ? "right" : "left") : ownSide;
	const side = data.metadata.layout.sidebarSide ?? shownOwnSide;
	const width = data.metadata.layout.sidebarWidth;
	const titleId = useId();
	const widthId = useId();

	return (
		<div className="grid gap-3 rounded-lg border border-line bg-bg p-3">
			<p id={titleId} className="text-sm font-medium">
				<Trans>Sidebar</Trans>
			</p>
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
			<div className="grid gap-2">
				<div className="flex items-center justify-between text-[13px]">
					<span id={widthId}>
						<Trans>Width</Trans>
					</span>
					<span className="font-mono text-xs text-ink-2">{width}%</span>
				</div>
				<Slider
					aria-labelledby={`${titleId} ${widthId}`}
					min={10}
					max={50}
					step={1}
					value={[width]}
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
		</div>
	);
}
