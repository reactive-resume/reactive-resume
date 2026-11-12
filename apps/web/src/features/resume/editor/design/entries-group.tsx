import type { EntryHeader } from "@reactive-resume/schema/resume/data";
import type { ReactNode } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { entryHeaderOf } from "@reactive-resume/schema/resume/data";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { cn } from "@reactive-resume/utils/style";
import { describeEntry } from "../write/model";
import { useDesign } from "./style-groups";
import { IconPicker } from "@/components/input/icon-picker";
import { LevelDisplay } from "@/components/level/display";
import { useResumeData } from "@/features/resume/builder/draft";

type BarProps = { tone?: "lead" | "accent"; className: string };

/** One line of text in a layout's wireframe: dark for the lead, light for the rest, accent for an eyebrow. */
function Bar({ tone, className }: BarProps) {
	return (
		<span
			className={cn(
				"block h-1 rounded-sm",
				tone === "lead" ? "bg-ink" : tone === "accent" ? "h-[3px] bg-accent" : "bg-line-2",
				className,
			)}
		/>
	);
}

const ROW = "flex items-center justify-between gap-0.5";

const LAYOUTS: { id: EntryHeader["layout"]; label: () => string; wireframe: ReactNode }[] = [
	{
		id: "stacked",
		label: () => t({ message: "Stacked", context: "Entry header layout" }),
		wireframe: (
			<>
				<span className={ROW}>
					<Bar tone="lead" className="w-[46%]" />
					<Bar className="w-[22%]" />
				</span>
				<span className={ROW}>
					<Bar className="w-[38%]" />
					<Bar className="w-[28%]" />
				</span>
			</>
		),
	},
	{
		id: "inline",
		label: () => t({ message: "One line", context: "Entry header layout" }),
		wireframe: (
			<span className={ROW}>
				<span className="flex w-[68%] gap-0.5">
					<Bar tone="lead" className="w-[45%]" />
					<Bar className="w-[30%]" />
					<Bar className="w-[18%]" />
				</span>
				<Bar className="w-[22%]" />
			</span>
		),
	},
	{
		id: "compact",
		label: () => t({ message: "Compact", context: "Entry header layout" }),
		wireframe: (
			<>
				<span className={ROW}>
					<Bar tone="lead" className="w-[52%]" />
					<Bar className="w-[26%]" />
				</span>
				<span className="flex gap-0.5">
					<Bar className="w-[30%]" />
					<Bar className="w-[16%]" />
				</span>
			</>
		),
	},
	{
		id: "date-column",
		label: () => t({ message: "Date column", context: "Entry header layout" }),
		wireframe: (
			<span className="flex items-center gap-1">
				<Bar className="w-[24%] shrink-0" />
				<span className="grid flex-1 gap-1">
					<Bar tone="lead" className="w-[80%]" />
					<Bar className="w-[58%]" />
				</span>
			</span>
		),
	},
	{
		id: "eyebrow",
		label: () => t({ message: "Eyebrow", context: "Entry header layout" }),
		wireframe: (
			<>
				<Bar tone="accent" className="w-[40%]" />
				<span className={ROW}>
					<Bar tone="lead" className="h-[5px] w-[58%]" />
					<Bar className="w-[24%]" />
				</span>
			</>
		),
	},
];

/**
 * Entries: how the header of each Experience, Education and Volunteer entry is laid out, which of its two rows
 * leads, and an accent around it. One setting for the whole resume.
 */
export function EntriesGroup() {
	const { metadata, write } = useDesign();
	const data = useResumeData();
	if (!metadata) return null;

	const entry = entryHeaderOf(metadata.design);
	// Old resumes have no entry settings: every change writes the whole object.
	const set = (value: Partial<EntryHeader>) =>
		write(
			"entry",
			(draft) => {
				draft.design.entry = { ...entryHeaderOf(draft.design), ...value };
			},
			true,
		);

	const descriptions = {
		stacked: t`Two rows: company, then position`,
		inline: t`Everything on one row`,
		compact: t`Company and dates on top, the rest below`,
		"date-column": t`Dates in a column on the left`,
		eyebrow: t`A small accent line above a larger company`,
	};
	const level = metadata.design.level;
	const levelOptions = [
		{ value: "hidden", label: t`Hidden` },
		{ value: "circle", label: t`Circle` },
		{ value: "square", label: t`Square` },
		{ value: "rectangle", label: t`Rectangle` },
		{ value: "rectangle-full", label: t`Full width` },
		{ value: "progress-bar", label: t`Progress bar` },
		{ value: "icon", label: t`Icon` },
	] as const;
	const first = data?.sections.experience.items.find((item) => !item.hidden);
	const preview = first ? describeEntry("experience", first) : null;
	return (
		<div className="grid gap-4 pt-1 pb-6">
			<p className="t-small text-ink-3">
				<Trans>One setting for every entry on the resume.</Trans>
			</p>
			<div className="grid gap-2">
				<div className="flex items-baseline justify-between gap-2">
					<span className="t-small font-medium">
						<Trans>Header layout</Trans>
					</span>
					<span className="t-caption text-ink-3">
						<Trans>Experience, Education and more</Trans>
					</span>
				</div>
				<RadioGroup
					aria-label={t`Header layout`}
					value={entry.layout}
					onValueChange={(value) => set({ layout: value as EntryHeader["layout"] })}
					className="border-y border-line"
				>
					{LAYOUTS.map((option) => (
						<Radio.Root
							key={option.id}
							value={option.id}
							className="group/layout flex min-h-[46px] cursor-pointer items-center gap-3 border-b border-line text-start last:border-0"
						>
							<span className="grid size-4 shrink-0 place-items-center rounded-full border border-control-border group-data-checked/layout:border-accent">
								{entry.layout === option.id && <span className="size-2 rounded-full bg-accent" />}
							</span>
							<span
								aria-hidden="true"
								className="flex h-[30px] w-16 shrink-0 flex-col justify-center gap-1 rounded-xs border border-line-2 bg-raised px-2 group-data-checked/layout:border-accent"
							>
								{option.wireframe}
							</span>
							<span className="grid">
								<span className="t-ui font-medium">{option.label()}</span>
								<span className="t-caption text-ink-3">{descriptions[option.id]}</span>
							</span>
						</Radio.Root>
					))}
				</RadioGroup>
			</div>
			<div className="grid gap-2">
				<span className="t-small font-medium">
					<Trans>Row order</Trans>
				</span>
				<SegmentedControl
					aria-label={t`Row order`}
					value={entry.lead}
					onValueChange={(value) => set({ lead: value as EntryHeader["lead"] })}
					className="w-full"
				>
					<SegmentedControlItem value="organization">
						<Trans>Company first</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="role">
						<Trans>Position first</Trans>
					</SegmentedControlItem>
				</SegmentedControl>
				{preview && (
					<div className="grid gap-1 t-caption">
						<div className="rounded-sm bg-sunken px-2.5 py-1.5 font-semibold">
							{entry.lead === "organization" ? first?.company : first?.position}
						</div>
						<div className="rounded-sm bg-sunken px-2.5 py-1.5 text-ink-3">
							{entry.lead === "organization" ? first?.position : first?.company}
							{first?.location ? ` · ${first.location}` : ""}
						</div>
					</div>
				)}
				<p className="t-caption text-ink-3">
					<Trans>Education swaps school and field of study the same way.</Trans>
				</p>
			</div>
			<div className="grid gap-2">
				<span className="t-small font-medium">
					<Trans>Accent</Trans>
				</span>
				<SegmentedControl
					aria-label={t`Accent`}
					value={entry.accent}
					onValueChange={(value) => set({ accent: value as EntryHeader["accent"] })}
					className="w-full"
				>
					<SegmentedControlItem value="none">
						<Trans context="Entry header accent">None</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="rule">
						<Trans context="Entry header accent: a line under the header">Rule</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="bar">
						<Trans context="Entry header accent: a bar beside the header">Bar</Trans>
					</SegmentedControlItem>
					<SegmentedControlItem value="band">
						<Trans context="Entry header accent: a tinted background behind the header">Band</Trans>
					</SegmentedControlItem>
				</SegmentedControl>
				<p className="t-caption text-ink-3">
					<Trans>A line under each header, a bar beside it, or a tint behind it.</Trans>
				</p>
			</div>
			<section>
				<h3 className="mb-2 flex items-baseline gap-3 t-section-title">
					<Trans>Levels</Trans>
					<span className="t-caption text-ink-3">
						<Trans>How a skill or language level is drawn</Trans>
					</span>
				</h3>
				<RadioGroup
					aria-label={t`Level style`}
					value={level.type}
					onValueChange={(value) =>
						write(
							"level.type",
							(draft) => {
								draft.design.level.type = value as typeof level.type;
							},
							true,
						)
					}
					className="grid grid-cols-2 gap-x-4"
				>
					{levelOptions.map((option) => (
						<Radio.Root
							key={option.value}
							value={option.value}
							className="flex min-h-9 cursor-pointer items-center gap-2 border-b border-line text-start t-small"
						>
							<Icon
								name={level.type === option.value ? "check-circle" : "circle"}
								size={16}
								className={level.type === option.value ? "text-accent-text" : "text-ink-3"}
							/>
							{option.label}
							<span aria-hidden="true" className="ms-auto w-[52px] [--page-primary-color:var(--ink-2)]">
								<LevelDisplay level={3} type={option.value} icon={level.icon} decorationSizePx={8} iconSizePx={10} />
							</span>
						</Radio.Root>
					))}
					<span className="flex items-center t-caption text-ink-3">
						<Trans>Samples show 3 of 5</Trans>
					</span>
				</RadioGroup>
				{level.type === "icon" && (
					<div className="mt-3 flex items-center gap-3 t-small">
						<Trans>Icon</Trans>
						<IconPicker
							value={level.icon}
							onChange={(value) =>
								write(
									"level.icon",
									(draft) => {
										draft.design.level.icon = value;
									},
									true,
								)
							}
						/>
					</div>
				)}
			</section>
		</div>
	);
}
