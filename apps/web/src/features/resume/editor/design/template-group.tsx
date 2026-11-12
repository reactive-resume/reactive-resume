import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useInView } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { templateLayouts } from "@reactive-resume/schema/templates";
import { Button } from "@reactive-resume/ui/components/button";
import { InputGroup, InputGroupAddon, InputGroupText } from "@reactive-resume/ui/components/input-group";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Slider } from "@reactive-resume/ui/components/slider";
import { isRTL } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "../store";
import { useTemplateThumbnail } from "./thumbnails";
import { Chip, FilterField } from "@/components/calm/filter-bar";
import { NumberInput } from "@/components/input/number-input";
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

type TemplateGroupProps = { layout?: "grid" | "strip"; onUse?: () => void };
export function TemplateGroup({ layout = "grid", onUse }: TemplateGroupProps) {
	const data = useResumeData();
	const [filter, setFilter] = useState<Filter>("all");
	const [query, setQuery] = useState("");
	const preview = useEditorStore((state) => state.previewTemplate);
	useEffect(() => () => useEditorStore.setState({ previewTemplate: null }), []);
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
	return (
		<div
			role="group"
			aria-label={t`Template preview`}
			className="flex min-h-0 grow flex-col gap-2 pt-3 pb-5"
			onKeyDown={(event) => {
				if (event.key === "Escape" && preview) {
					event.stopPropagation();
					cancel();
				}
			}}
		>
			<div className="flex flex-wrap items-center gap-1.5 min-[1280px]:ms-[212px] min-[1280px]:-mt-[42px]">
				{filters.map((option) => (
					<Chip key={option.id} pressed={filter === option.id} onClick={() => setFilter(option.id)}>
						{option.label}{" "}
						<span className="t-caption">{TEMPLATE_IDS.filter((id) => matchesFilter(id, option.id)).length}</span>
					</Chip>
				))}
				<FilterField
					label={t`Filter templates`}
					icon="funnel"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					className="min-w-40 flex-1"
				/>
			</div>
			<div
				aria-label={t`Templates`}
				className={
					layout === "strip"
						? "flex gap-3 overflow-x-auto *:w-32 *:shrink-0"
						: "grid grid-cols-2 gap-x-4 gap-y-4 min-[1280px]:grid-cols-6"
				}
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
			<div
				className="mt-auto flex flex-wrap items-center gap-3 border-t border-line pt-3 min-[1280px]:fixed min-[1280px]:end-6 min-[1280px]:bottom-5 min-[1280px]:z-20 min-[1280px]:w-[456px] min-[1280px]:rounded-xl min-[1280px]:border min-[1280px]:bg-raised min-[1280px]:p-4 min-[1280px]:shadow-e2"
				role="status"
			>
				<div className="min-w-0 flex-1">
					<h3 className="t-section-title">
						{templates[chosen].name}{" "}
						<span className="t-caption text-ink-3">{preview ? t`Previewing` : t`Current`}</span>
					</h3>
					<p className="t-small text-ink-2">{i18n._(templates[chosen].description)}</p>
					{!templateLayouts[chosen].atsSafe && (
						<p className="mt-1 t-caption text-warn-text">
							<Trans>Not ATS-safe: two columns can be read out of order.</Trans>
						</p>
					)}
				</div>
				<Button variant="secondary" onClick={cancel}>
					<Trans>Keep {templates[current].name}</Trans>
				</Button>
				<Button
					variant="secondary"
					disabled={!preview}
					onClick={() => {
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
					}}
				>
					<Trans>Use this template</Trans>
				</Button>
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
			className="grid content-start gap-1.5 text-start"
		>
			<span
				className={cn(
					"relative block aspect-page overflow-hidden rounded-paper border border-line bg-paper shadow-e1",
					previewing && "ring-2 ring-accent ring-offset-2 ring-offset-bg",
				)}
			>
				<img src={thumbnail ?? templates[id].imageUrl} alt="" className="size-full object-cover object-top" />
			</span>
			<span className="flex flex-wrap items-center gap-1 t-ui font-medium">
				{templates[id].name}
				{(current || previewing) && (
					<span
						className={cn(
							"rounded-xs px-1 t-caption",
							previewing ? "bg-accent-soft text-accent-text" : "bg-sunken text-ink-2",
						)}
					>
						{previewing ? t`Previewing` : t`Current`}
					</span>
				)}
			</span>
			<span className="t-caption text-ink-3">{layoutTags(id)}</span>
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
	const widthId = useId();

	return (
		<div className="grid gap-3 pt-2">
			<p className="t-small font-medium">
				<Trans>Side</Trans>
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
					<InputGroup className="h-8 w-20">
						<NumberInput
							aria-label={t`Sidebar width`}
							value={width}
							min={10}
							max={50}
							step={0.1}
							className="text-end font-mono text-xs"
							onValueChange={(value) =>
								updateResumeData(
									(draft) => {
										draft.metadata.layout.sidebarWidth = value;
									},
									{ coalesceKey: "design.sidebarWidth" },
								)
							}
						/>
						<InputGroupAddon align="inline-end">
							<InputGroupText>%</InputGroupText>
						</InputGroupAddon>
					</InputGroup>
				</div>
				<Slider
					aria-label={t`Sidebar width`}
					min={10}
					max={50}
					step={0.01}
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
