import type { EntryHeader } from "@reactive-resume/schema/resume/data";
import type { ReactNode } from "react";
import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { entryHeaderOf } from "@reactive-resume/schema/resume/data";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { cn } from "@reactive-resume/utils/style";
import { DesignHeading, Field, Help, Lede } from "./fields";
import { useDesign } from "./style-groups";
import { IconPicker } from "@/components/input/icon-picker";
import { useResumeData } from "@/features/resume/builder/draft";

type BarProps = { tone?: "lead" | "accent"; className: string };

/** One line of text in a layout's wireframe: dark for the lead, light for the rest, accent for an eyebrow. */
function Bar({ tone, className }: BarProps) {
	return (
		<span
			className={cn(
				"block h-[3px] rounded-[1px]",
				tone === "lead" ? "bg-ink" : tone === "accent" ? "bg-accent" : "bg-line-2",
				className,
			)}
		/>
	);
}

const ROW = "flex items-center justify-between gap-[3px]";

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
				<span className="flex w-[68%] gap-[3px]">
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
				<span className="flex gap-[3px]">
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
			<span className="flex items-center gap-[5px]">
				<Bar className="w-[24%] shrink-0" />
				<span className="flex flex-1 flex-col gap-1">
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
					<Bar tone="lead" className="h-1 w-[58%]" />
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
	const samples: Record<(typeof levelOptions)[number]["value"], ReactNode> = {
		hidden: null,
		circle: <Dots className="size-2 rounded-full" />,
		square: <Dots className="size-2 rounded-[1px]" />,
		rectangle: <Dots className="h-[5px] w-[9px] rounded-[1px]" />,
		"rectangle-full": <Dots className="h-[5px] flex-1 rounded-[1px]" />,
		"progress-bar": (
			<span className="block h-[5px] flex-1 overflow-hidden rounded-[3px] bg-line-2">
				<i className="block h-[5px] w-3/5 bg-ink-2" />
			</span>
		),
		icon: [0, 1, 2, 3, 4].map((index) => (
			<i
				key={index}
				className={cn(
					"ph shrink-0 text-[10px] not-italic",
					`ph-${level.icon}`,
					index < 3 ? "text-ink-2" : "text-line-2",
				)}
			/>
		)),
	};
	return (
		<div className="flex flex-col pb-6">
			<Lede>
				<Trans>One setting for every entry on the resume.</Trans>
			</Lede>
			<Field
				className="mt-3.5"
				label={<Trans>Header layout</Trans>}
				help={<Trans>Experience, Education and more</Trans>}
			>
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
							className="group/layout flex h-[46px] cursor-pointer items-center gap-3 border-b border-line text-start last:border-0"
						>
							<RadioDot />
							<span
								aria-hidden="true"
								className="flex h-[30px] w-16 shrink-0 flex-col justify-center gap-1 rounded-xs bg-raised px-[7px] shadow-[inset_0_0_0_1px_var(--line-2)] group-data-checked/layout:shadow-[inset_0_0_0_1.5px_var(--accent)]"
							>
								{option.wireframe}
							</span>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="text-sm/[18px] font-medium">{option.label()}</span>
								<span className="t-caption font-normal text-ink-3">{descriptions[option.id]}</span>
							</span>
						</Radio.Root>
					))}
				</RadioGroup>
			</Field>
			<Field className="mt-4" label={<Trans>Row order</Trans>}>
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
				{first && (
					<div aria-label={t`The two header rows as they print`} className="mt-2 flex flex-col gap-1">
						<div className={PREVIEW_ROW}>
							<b className="font-semibold text-ink">{entry.lead === "organization" ? first.company : first.position}</b>
							{first.period && <span>{first.period}</span>}
						</div>
						<div className={PREVIEW_ROW}>
							<span>
								{entry.lead === "organization" ? first.position : first.company}
								{first.location ? ` · ${first.location}` : ""}
							</span>
						</div>
					</div>
				)}
				<Help>
					<Trans>Education swaps school and field of study the same way.</Trans>
				</Help>
			</Field>
			<Field className="mt-4" label={<Trans>Accent</Trans>} help={<Trans>Uses the accent color</Trans>}>
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
				<Help>
					<Trans>A line under each header, a bar beside it, or a tint behind it.</Trans>
				</Help>
			</Field>
			<DesignHeading className="pt-[22px]" note={<Trans>how a skill or language level is drawn</Trans>}>
				<Trans>Levels</Trans>
			</DesignHeading>
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
						className="group/layout flex h-9 cursor-pointer items-center gap-2.5 border-b border-line text-start text-[13px]/[18px] text-ink-2 data-checked:font-medium data-checked:text-ink"
					>
						<RadioDot className="size-4 group-data-checked/layout:after:inset-1" />
						{option.label}
						<span aria-hidden="true" className="ms-auto flex w-[52px] shrink-0 items-center gap-0.5">
							{samples[option.value]}
						</span>
					</Radio.Root>
				))}
				<span className="flex h-9 items-center text-xs/[18px] text-ink-3">
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
		</div>
	);
}

const PREVIEW_ROW =
	"flex h-7 items-center justify-between gap-2 rounded-sm bg-sunken px-2.5 t-caption font-normal text-ink-3";

/** The radio mark of a row that is itself the radio (`.rad`): an 18px ring, filled while checked. */
function RadioDot({ className }: { className?: string }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"relative size-[18px] shrink-0 rounded-full bg-raised shadow-[inset_0_0_0_1.5px_var(--control-border)] group-data-checked/layout:shadow-[inset_0_0_0_1.5px_var(--accent)] group-data-checked/layout:after:absolute group-data-checked/layout:after:inset-[5px] group-data-checked/layout:after:rounded-full group-data-checked/layout:after:bg-accent",
				className,
			)}
		/>
	);
}

/** Five marks, three filled: how a level of 3 of 5 is drawn. */
function Dots({ className }: { className: string }) {
	return [0, 1, 2, 3, 4].map((index) => (
		<i key={index} className={cn("block shrink-0", index < 3 ? "bg-ink-2" : "bg-line-2", className)} />
	));
}
