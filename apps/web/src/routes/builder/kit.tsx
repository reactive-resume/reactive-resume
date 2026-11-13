import type { ReactNode } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { Button } from "@reactive-resume/ui/components/button";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@reactive-resume/ui/components/dropdown-menu";
import { EmptyState } from "@reactive-resume/ui/components/empty-state";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Input } from "@reactive-resume/ui/components/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@reactive-resume/ui/components/input-group";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { Label } from "@reactive-resume/ui/components/label";
import {
	menuItemClassName,
	menuPopupClassName,
	menuSeparatorClassName,
} from "@reactive-resume/ui/components/menu-styles";
import { RadioGroup, RadioGroupItem } from "@reactive-resume/ui/components/radio-group";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Switch } from "@reactive-resume/ui/components/switch";
import { Tabs, TabsCount, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { CategoryStrip } from "@/components/calm/category-strip";
import { Crumb, CrumbLink } from "@/components/calm/crumb";
import {
	DataTable,
	DataTableBody,
	DataTableCell,
	DataTableHead,
	DataTableHeaderCell,
	DataTableRow,
} from "@/components/calm/data-table";
import { DocumentThumb } from "@/components/calm/document-thumb";
import { Chip, FilterBar, FilterField } from "@/components/calm/filter-bar";
import { HeroCard } from "@/components/calm/hero-card";
import {
	DateColumn,
	IconTile,
	List,
	ListRow,
	revealOnRowClassName,
	rowLinkClassName,
} from "@/components/calm/list-row";
import { Columns, Page, PageBody, PageHeader, RootHeader } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { SectionRail, SectionRailItem } from "@/components/calm/section-rail";
import { SelectionBar } from "@/components/calm/selection-bar";
import { SetUpAiLine } from "@/components/calm/set-up-ai-line";
import { StageDot, WarnDot } from "@/components/calm/stage-dot";
import { StageStepper } from "@/components/calm/stage-stepper";
import { Combobox } from "@/components/ui/combobox";
import { providerOptions } from "@/features/settings/ai/catalog";
import { useTheme } from "@/features/theme/provider";

/*
 * The Calm kit: every primitive and shared component on one page, in the order of the design bundle's Kit board.
 * Development only. Its words are specimens for developers, so they are plain strings, not translated messages.
 */
export const Route = createFileRoute("/builder/kit")({
	beforeLoad: () => {
		if (!import.meta.env.DEV) throw notFound();
	},
	component: KitPage,
	head: () => ({ meta: [{ title: "Kit" }, { name: "robots", content: "noindex, nofollow" }] }),
});

const STAGES = ["saved", "applied", "screening", "interview", "offer", "closed"] as const;

const TYPE: [className: string, sample: string, note: string][] = [
	["t-display", "7 of 10", "display 44/48"],
	["t-big-number", "58%", "big-number 40/44"],
	["t-root-title", "Documents", "root-title 34/40"],
	["t-page-title", "Lumen", "page-title 28/34"],
	["t-section-title", "Needs you", "section-title 22/28"],
	["t-heading", "Interview at Lumen", "heading 20/28"],
	["t-section-heading", "Experience", "section-heading 17/24"],
	["t-label", "Senior product designer", "label 15/22"],
	["t-row-title", "Follow up with Fieldnote", "row-title 15/22"],
	["t-body", "Edits save as you type.", "body 15/24"],
	["t-ui", "Duplicate · Rename", "ui 14/20"],
	["t-small text-ink-2", "Applied 28 Oct · follow-up due", "small 13/18"],
	["t-caption text-ink-2", "Draft", "caption 12/16"],
	["t-eyebrow text-ink-3", "Recent", "eyebrow 12/16"],
	["t-mono text-ink-2", "rxresu.me/alex/product-designer", "mono 12/16"],
];

const SWATCHES: [token: string, ink?: string][] = [
	["bg"],
	["surface"],
	["raised"],
	["sunken"],
	["paper", "ink"],
	["line"],
	["line-2"],
	["control-border", "bg"],
	["ink", "bg"],
	["ink-2", "bg"],
	["ink-3", "bg"],
	["accent", "on-accent"],
	["accent-soft", "accent-text"],
	["info-soft", "info-text"],
	["warn-soft", "warn-text"],
	["warn", "warn-ink"],
	["danger-soft", "danger-text"],
	["danger-fill", "paper"],
];

const ICONS = [
	"magnifying-glass",
	"plus",
	"dots-three",
	"caret-left",
	"caret-right",
	"x",
	"check",
	"lock",
	"globe-simple",
	"trash",
	"file-text",
	"briefcase",
	"compass",
	"gear-six",
	"keyboard",
	"calendar-plus",
	"download-simple",
	"clock-counter-clockwise",
] as const;

const FONTS = ["DM Serif Text", "Figtree", "IBM Plex Serif", "Instrument Serif", "Noto Serif"].map((value) => ({
	value,
	label: value,
}));

const SAVE_STATES: { note: string; tone?: string; icon?: "cloud-slash" | "cloud-warning" | "lock"; text: ReactNode }[] =
	[
		{ note: "saved · resting, no icon, no colour", text: "Saved · 1 page · Public" },
		{ note: "saving", text: "Saving…" },
		{ note: "offline", tone: "text-warn-text", icon: "cloud-slash", text: "Offline · saved on this device" },
		{
			note: "couldn't save",
			tone: "text-danger-text",
			icon: "cloud-warning",
			text: <StatusAction action="Retry">Not saved</StatusAction>,
		},
		{
			note: "session ended",
			tone: "text-danger-text",
			icon: "cloud-warning",
			text: <StatusAction action="Sign in to save">Not saved</StatusAction>,
		},
		{
			note: "changed somewhere else",
			tone: "text-warn-text",
			icon: "cloud-warning",
			text: <StatusAction action="Reload">Review saved version</StatusAction>,
		},
		{ note: "locked while open", tone: "text-warn-text", icon: "lock", text: "Locked · unlock to save" },
	];

function StatusAction({ action, children }: { action: string; children: ReactNode }) {
	return (
		<>
			{children} ·{" "}
			<button type="button" className="font-semibold underline underline-offset-2">
				{action}
			</button>
		</>
	);
}

/** One labelled specimen: the component's name at the start, its measurements in mono at the end. */
function Group({
	title,
	note,
	first = false,
	children,
}: {
	title: string;
	note?: string;
	first?: boolean;
	children: ReactNode;
}) {
	return (
		<section className="flex min-w-0 flex-col gap-2.5">
			<h2
				className={cn(
					"flex items-baseline justify-between gap-2 font-sans text-xs font-semibold text-ink-2",
					first ? "pt-0" : "pt-1.5",
				)}
			>
				{title}
				{note && <code className="shrink-0 font-mono text-[11px]/4 font-medium text-ink-3">{note}</code>}
			</h2>
			{children}
		</section>
	);
}

const Quiet = ({ children }: { children: ReactNode }) => <p className="t-small text-ink-3">{children}</p>;

const Frame = ({ className, children }: { className?: string; children: ReactNode }) => (
	<div className={cn("overflow-hidden rounded-lg border border-line", className)}>{children}</div>
);

const Row = ({ className, children }: { className?: string; children: ReactNode }) => (
	<div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>
);

function KitPage() {
	const { resolvedTheme } = useTheme();
	const [mode, setMode] = useState("write");
	const [font, setFont] = useState<string | null>("Figtree");
	const [selected, setSelected] = useState(2);
	const [category, setCategory] = useState<"template" | "layout" | "entries" | "typography" | "color" | "page" | "css">(
		"typography",
	);

	return (
		<div className="flow-root bg-sunken">
			<main className="m-10 flex min-h-[2492px] w-[1080px] max-w-[calc(100%-40px)] flex-col gap-7 rounded-lg bg-bg p-7 shadow-[0_0_0_1px_var(--line-2)]">
				<div className="grid items-start gap-7 lg:grid-cols-3">
					<div className="flex min-w-0 flex-col gap-2.5">
						<h1 className="flex items-center gap-2 t-section-title">
							<Icon name={resolvedTheme === "dark" ? "moon" : "sun"} />
							{resolvedTheme === "dark" ? "Dark theme" : "Light theme"}
						</h1>
						<Group title="Type" note="style · size/line">
							<div className="flex flex-col">
								{TYPE.map(([className, sample, note]) => (
									<div key={note} className="flex items-baseline justify-between gap-3 whitespace-nowrap">
										<span className={className}>{sample}</span>
										<code className="shrink-0 font-mono text-[11px]/4 font-medium text-ink-3">{note}</code>
									</div>
								))}
							</div>
						</Group>

						<Group title="Surfaces, inks and signals" note="color token">
							<div className="grid grid-cols-3 gap-1.5">
								{SWATCHES.map(([token, ink]) => (
									<div
										key={token}
										className="flex h-8 items-end rounded-sm px-1.5 py-[3px] font-mono text-[10px]/3 font-medium shadow-[inset_0_0_0_1px_var(--line)]"
										style={{
											background: `var(--${token})`,
											// Paper never inverts, so its label keeps the light theme's ink.
											color: token === "paper" ? "oklch(0.22 0.01 95)" : `var(--${ink ?? "ink"})`,
										}}
									>
										{token}
									</div>
								))}
							</div>
						</Group>

						<Group title="Stages" note="dot 8 + name, always">
							<Row className="gap-x-4 gap-y-1.5 t-small">
								{STAGES.map((status) => (
									<StageDot key={status} status={status} />
								))}
							</Row>
						</Group>

						<Group title="Badges" note="Badge 20 · radius 6">
							<Row className="gap-1.5">
								<Badge variant="accent">
									<Icon name="globe-simple" />
									Public
								</Badge>
								<Badge variant="neutral">
									<Icon name="lock" />
									Locked
								</Badge>
								<Badge variant="warn">3 to review</Badge>
								<Badge variant="info">New</Badge>
								<Badge variant="danger">Failed</Badge>
								<Badge variant="outline">Draft</Badge>
							</Row>
						</Group>

						<Group title="Icons" note="Phosphor regular 20">
							<Row className="gap-x-[11px] text-ink-2">
								{ICONS.map((name) => (
									<Icon key={name} name={name} size={20} />
								))}
								<Icon name="sparkle" size={20} className="text-accent-text" />
								<Icon name="house" size={20} filled className="text-accent-text" />
							</Row>
							<Quiet>Filled only for the selected sidebar item. Sparkle marks AI and nothing else.</Quiet>
						</Group>

						<Group title="Chat composer" note="ChatComposer · radius 16">
							<div
								data-design="composer"
								className="flex flex-col gap-2.5 rounded-xl bg-raised py-3 ps-3.5 pe-2.5 pb-2.5 shadow-[inset_0_0_0_1px_var(--control-border)]"
							>
								<Row className="gap-1.5">
									<Chip variant="ctx" onRemove={() => {}} removeLabel="Remove Product designer">
										<Icon name="file-text" size={14} />
										Product designer
									</Chip>
									<Chip variant="dash" className="h-[26px] text-xs leading-[18px]">
										<Icon name="plus" size={14} />
										Knowledge
									</Chip>
								</Row>
								<div className="t-body text-ink-3">Ask about this resume…</div>
								<Row>
									<Chip variant="ctx" render={<span />} className="px-2">
										<Icon name="sparkle" size={14} className="text-accent-text" />
										Work OpenAI · gpt-5-mini
									</Chip>
									<span className="flex-1" />
									<IconButton
										icon="arrow-up"
										label="Send"
										iconSize={18}
										size="icon-sm"
										variant="primary"
										className="size-8 bg-ink text-bg hover:bg-ink"
									/>
								</Row>
							</div>
							<Quiet>
								Send is ink in the builder, where Download PDF holds the accent. It is accent only on Career.
							</Quiet>
						</Group>

						<Group title="Combobox" note="Combobox 40 · closed, open">
							<Combobox caret="up-down" options={FONTS} value={font} onValueChange={setFont} />
							{/* The open state: the trigger keeps its focus ring while the list hangs under it. */}
							<Combobox
								caret="up-down"
								options={FONTS}
								value="Instrument Serif"
								onValueChange={() => {}}
								className="shadow-[inset_0_0_0_1px_var(--accent),0_0_0_3px_var(--accent-soft)]"
							/>
							<div role="presentation" data-design="menu" className={cn(menuPopupClassName, "z-0 -mt-1 w-[268px] p-0")}>
								<div className="flex h-11 items-center gap-2 border-b border-line ps-3 pe-1.5">
									<Icon name="magnifying-glass" size={18} className="text-ink-3" />
									<span className="flex-1">serif</span>
									<Icon name="x" size={16} className="me-1.5 text-ink-2" />
								</div>
								<div className="flex justify-between px-3.5 pt-2 pb-1 t-mono text-ink-3">
									<span>17 of 520 fonts</span>
									<span>A to Z</span>
								</div>
								<div className="px-1 pb-1">
									{["DM", "IBM Plex", "Instrument", "Noto"].map((family, index) => (
										<div
											key={family}
											{...(index === 0 ? { "data-highlighted": "" } : {})}
											className={cn(menuItemClassName, "min-h-[34px] justify-between", index === 2 && "font-medium")}
										>
											<span>
												{family} <b className="font-semibold">Serif</b>
												{index === 0 && " Text"}
											</span>
											{index === 0 && <Kbd>↵</Kbd>}
											{index === 2 && <Icon name="check" size={18} className="text-ink!" />}
										</div>
									))}
								</div>
							</div>
							<Quiet>One flat list, A to Z, with search. No groups and no curated subset.</Quiet>
						</Group>
					</div>

					<div className="flex min-w-0 flex-col gap-2.5">
						<Group first title="Buttons" note="Button 44 · 36 · 28">
							<Row>
								<Button size="lg">Sign in</Button>
								<Button size="lg" variant="secondary">
									Create account
								</Button>
							</Row>
							<Row className="gap-1.5">
								<Button>Save job</Button>
								<Button variant="secondary">Cancel</Button>
								<Button variant="ghost">Skip</Button>
								<Button variant="soft">Accept</Button>
							</Row>
							<Row>
								<Button variant="danger">Delete permanently</Button>
								<Button variant="danger-text">Move to Trash</Button>
							</Row>
							<Row>
								<Button size="sm" variant="secondary">
									<Icon name="plus" />
									Add
								</Button>
								<Button size="sm" variant="ghost" className="text-accent-text hover:text-accent-text">
									<Icon name="sparkle" />
									Improve
								</Button>
								<Button size="sm" variant="ghost">
									Undo
								</Button>
								<Button size="sm" variant="soft">
									Accept
								</Button>
							</Row>
						</Group>

						<Group title="Split accent" note="SplitButton 36 · builder bar">
							<Row>
								{/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a button group, not a form fieldset */}
								<div role="group" aria-label="Download" className="inline-flex gap-px">
									<Button className="rounded-e-none ps-3.5 pe-3">
										<Icon name="download-simple" />
										Download PDF
									</Button>
									<IconButton
										icon="caret-down"
										label="More download formats"
										variant="primary"
										iconSize={16}
										className="w-[34px] rounded-s-none"
									/>
								</div>
								<span className="t-small text-ink-3">Caret opens the other formats</span>
							</Row>
						</Group>

						<Group title="Disabled" note="whole control at 45%">
							<Row>
								<Button disabled>Save job</Button>
								<Button variant="secondary" disabled>
									Cancel
								</Button>
								<IconButton icon="arrow-clockwise" label="Redo" disabled />
								<Switch aria-label="On, disabled" checked disabled />
							</Row>
						</Group>

						<Group title="Icon buttons" note="IconButton 36 · 28 · label required">
							<Row className="gap-1.5">
								<IconButton icon="caret-left" label="Back" />
								<IconButton icon="arrow-counter-clockwise" label="Undo" shortcut="⌘Z" />
								<IconButton icon="clock-counter-clockwise" label="Version history" />
								<IconButton icon="sparkle" label="Assistant" aria-pressed />
								<IconButton icon="dots-three" label="More actions" variant="secondary" />
								<IconButton icon="x" label="Close" size="icon-xs" iconSize={16} />
								<span className="inline-flex h-7 items-center gap-1.5 rounded-sm bg-ink px-2.5 text-xs font-medium text-bg">
									Undo<Kbd className="bg-transparent text-inherit opacity-70">⌘Z</Kbd>
								</span>
							</Row>
						</Group>

						<Group title="Segmented" note="Segmented 36 · 2–4 options">
							<div>
								<SegmentedControl
									aria-label="Builder mode"
									value={mode}
									onValueChange={(value) => setMode(String(value))}
								>
									<SegmentedControlItem value="write">Write</SegmentedControlItem>
									<SegmentedControlItem value="design">Design</SegmentedControlItem>
									<SegmentedControlItem value="check">Check</SegmentedControlItem>
									<SegmentedControlItem value="share">Share</SegmentedControlItem>
								</SegmentedControl>
							</div>
						</Group>

						<Group title="Tabs" note="Tabs 40 · underline 2">
							<Tabs defaultValue="all">
								<TabsList variant="line" aria-label="Documents" className="w-full">
									<TabsTrigger value="all">
										All<TabsCount>5</TabsCount>
									</TabsTrigger>
									<TabsTrigger value="resumes">
										Resumes<TabsCount>3</TabsCount>
									</TabsTrigger>
									<TabsTrigger value="letters">
										Letters<TabsCount>2</TabsCount>
									</TabsTrigger>
								</TabsList>
							</Tabs>
						</Group>

						<Group title="Switch, checkbox, radio" note="22 · 18 · 18">
							<Row className="gap-3.5">
								<Switch aria-label="On" defaultChecked />
								<Switch aria-label="Off" />
								<Checkbox aria-label="Checked" defaultChecked />
								<Checkbox aria-label="Unchecked" />
								<RadioGroup aria-label="Radio" defaultValue="on" className="flex gap-3.5">
									<RadioGroupItem value="on" aria-label="Selected" />
									<RadioGroupItem value="off" aria-label="Not selected" />
								</RadioGroup>
							</Row>
						</Group>

						<Group title="Chips and keys" note="Chip 28 · Kbd 20">
							<Row className="gap-1.5">
								<Chip pressed={false}>Remote</Chip>
								<Chip pressed>Design systems</Chip>
								<Chip variant="dash">
									<Icon name="plus" size={16} />
									Tag
								</Chip>
								<Kbd>⌘K</Kbd>
								<Kbd>?</Kbd>
								<span className="t-mono text-ink-3">5</span>
							</Row>
						</Group>

						<Group title="Fields" note="Field · label 13 · input 40">
							<div className="flex flex-col gap-3.5">
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="kit-company">Company</Label>
									<Input id="kit-company" defaultValue="Lumen" />
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="kit-role">Role</Label>
									<Input
										id="kit-role"
										defaultValue="Senior product designer"
										className="border-accent shadow-[0_0_0_3px_var(--accent-soft)]"
									/>
								</div>
								<div className="flex flex-col gap-1.5">
									<Label htmlFor="kit-email">Email</Label>
									<Input id="kit-email" defaultValue="alex@morgan" aria-invalid aria-describedby="kit-email-error" />
									<p id="kit-email-error" className="flex items-center gap-1 text-xs text-danger-text">
										<Icon name="warning-circle" size={14} />
										Add the ending, like morgan.design
									</p>
								</div>
							</div>
						</Group>

						<Group title="Dates and level" note="DateRange 40 · LevelPips 24 × 8">
							<fieldset className="flex flex-col gap-1.5">
								<legend className="mb-1.5 text-[13px]/[18px] font-medium text-ink-2">Dates</legend>
								<Row className="flex-nowrap">
									<InputGroup>
										<InputGroupAddon>
											<Icon name="calendar-dots" />
										</InputGroupAddon>
										<InputGroupInput aria-label="Start" defaultValue="Mar 2022" />
									</InputGroup>
									<span aria-hidden="true" className="text-ink-3">
										–
									</span>
									{/* Present: the quiet field (`.inp.quiet`), sunken with no edge. */}
									<InputGroup className="border-transparent">
										<InputGroupAddon>
											<Icon name="calendar-dots" />
										</InputGroupAddon>
										<InputGroupInput aria-label="End" defaultValue="Present" disabled className="text-ink-2" />
									</InputGroup>
								</Row>
								<Row className="mt-0.5 gap-4 t-small text-ink-2">
									{/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the checkbox is nested */}
									<label className="flex items-center gap-2">
										<Checkbox defaultChecked className="size-4" />
										Present
									</label>
									{/* oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the checkbox is nested */}
									<label className="flex items-center gap-2">
										<Checkbox className="size-4" />
										Custom text
									</label>
								</Row>
							</fieldset>
							<div className="flex flex-col gap-1.5">
								<span className="text-[13px]/[18px] font-medium text-ink-2">Level</span>
								<Row className="min-h-6 gap-2.5">
									<span className="inline-flex items-center gap-1">
										{[1, 2, 3, 4, 5].map((pip) => (
											<span
												key={pip}
												className={cn(
													"block h-2 w-6 rounded-full",
													pip <= 4 ? "bg-ink" : "bg-sunken shadow-[inset_0_0_0_1px_var(--line-2)]",
												)}
											/>
										))}
									</span>
									<span className="t-mono text-ink-2">4 of 5</span>
									<span className="ms-auto text-xs text-ink-3">0 hides it</span>
								</Row>
							</div>
						</Group>

						<Group title="Menu" note="item 36 · submenu · disabled 45%">
							<div
								role="presentation"
								data-design="menu"
								className={cn(menuPopupClassName, "z-0 w-[232px] border border-line")}
							>
								<div data-highlighted="" className={menuItemClassName}>
									<Icon name="arrow-square-out" size={18} />
									Open<Kbd className="ms-auto">↵</Kbd>
								</div>
								<div className={menuItemClassName}>
									<Icon name="copy" size={18} />
									Duplicate<Kbd className="ms-auto">⌘D</Kbd>
								</div>
								<div data-disabled="" className={cn(menuItemClassName, "opacity-45")}>
									<Icon name="pencil-simple" size={18} />
									Rename
								</div>
								<div className={menuItemClassName}>
									<Icon name="arrow-right" size={18} />
									Move to
									<Icon name="caret-right" size={16} className="ms-auto text-ink-3!" />
								</div>
								<div className={menuSeparatorClassName} />
								<div data-variant="destructive" className={menuItemClassName}>
									<Icon name="trash" size={18} />
									Move to Trash
								</div>
							</div>
							<Quiet>A specimen: Rename is off on a locked document; Move to opens the stages of an application.</Quiet>
						</Group>

						<Group title="Side sheet" note="SideSheet 440 · radius 20 · title 22">
							<div
								data-design="sheet-r"
								className="flex h-28 flex-col rounded-t-2xl bg-raised shadow-[0_0_0_1px_var(--line)]"
							>
								<div className="flex items-center gap-2 ps-6 pe-4 pt-5 pb-3">
									<h3 className="flex-1 t-section-title">New schedule</h3>
									<IconButton icon="x" label="Close" />
								</div>
								<p className="px-6 text-xs text-ink-3">
									The header: title, then Close. The footer holds Cancel and the one accent button.
								</p>
							</div>
						</Group>
					</div>

					<div className="flex min-w-0 flex-col gap-2.5">
						<Group first title="Sidebar" note="SidebarNav 248 · item 40">
							<Frame className="w-[248px]">
								<nav
									data-design="side"
									aria-label="Main (specimen)"
									className="flex h-[476px] flex-col gap-1 bg-bg px-3 pt-4 pb-3"
								>
									<div className="mb-2 flex h-9 items-center gap-2.5 px-2 text-[15px]/5 font-semibold">
										<BrandIcon variant="icon" alt="" className="size-6 shrink-0" />
										Reactive Resume
									</div>
									<div
										data-design="srch"
										className="mb-3 flex h-9 items-center gap-2 rounded-md bg-sunken ps-2.5 pe-2 text-sm text-ink-3"
									>
										<Icon name="magnifying-glass" size={18} />
										Search or jump to…<Kbd className="ms-auto bg-bg">⌘K</Kbd>
									</div>
									<SidebarItem icon="house" current end={<SidebarBadge>2</SidebarBadge>}>
										Today
									</SidebarItem>
									<SidebarItem icon="file-text" end={<SidebarCount>5</SidebarCount>}>
										Documents
									</SidebarItem>
									<SidebarItem icon="briefcase" end={<SidebarCount>5</SidebarCount>}>
										Applications
									</SidebarItem>
									<SidebarItem icon="compass">Career</SidebarItem>
									<div className="flex-1" />
									<SidebarItem icon="trash" end={<SidebarCount>4</SidebarCount>}>
										Trash
									</SidebarItem>
									<SidebarItem icon="keyboard" end={<Kbd>?</Kbd>}>
										Shortcuts
									</SidebarItem>
									<div data-design="acct" className="mt-1 flex h-12 items-center gap-2.5 rounded-md px-2">
										<span className="flex size-8 items-center justify-center rounded-sm bg-accent-soft text-xs font-semibold text-accent-text">
											AM
										</span>
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="text-sm/[18px] font-medium">Alex Morgan</span>
											<span className="text-xs text-ink-3">Settings</span>
										</span>
										<Icon name="gear-six" size={18} className="text-ink-3" />
									</div>
								</nav>
							</Frame>
							<Quiet>
								The same items and counts on every dashboard page. An empty place shows no count, not a zero.
							</Quiet>
						</Group>

						<Group title="Section rail" note="SectionRail 200 · neutral selection">
							<Frame className="w-56 p-3">
								<SectionRail aria-label="Settings sections" className="max-lg:flex-col">
									<SectionRailItem to="/builder/kit" icon="user">
										Account
									</SectionRailItem>
									<SectionRailItem to="/dashboard/settings/profile" icon="identification-card">
										Application profile
									</SectionRailItem>
									<SectionRailItem to="/dashboard/settings/preferences" icon="sliders-horizontal">
										Preferences
									</SectionRailItem>
									<SectionRailItem to="/dashboard/settings/ai" icon="sparkle">
										AI
									</SectionRailItem>
									<SectionRailItem to="/dashboard/settings/ai" hash="developer" icon="code">
										Developer
									</SectionRailItem>
								</SectionRail>
							</Frame>
							<Quiet>Grey, never green. Settings and the workspace use it.</Quiet>
						</Group>

						<Group title="Root header" note="root-title 34 · one accent button">
							<Frame className="px-4 py-3.5">
								<RootHeader
									title="Documents"
									subtitle="3 resumes · 2 cover letters"
									actions={<Button>New document</Button>}
								/>
							</Frame>
						</Group>

						<Group title="Page header" note="path crumb · page-title 28 · one line">
							<Frame className="px-4 pt-3 pb-3.5">
								<PageHeader
									crumb={
										<Crumb>
											<CrumbLink to="/dashboard/applications">Applications</CrumbLink>
										</Crumb>
									}
									title="Lumen"
									subtitle="Senior product designer · Lisbon · Hybrid"
									actions={
										<Button variant="secondary" aria-label="Stage: Interview. Change stage">
											<StageDot status="interview" className="gap-2" />
											<Icon name="caret-down" className="text-ink-3" />
										</Button>
									}
								/>
							</Frame>
						</Group>

						<Group title="Section and rows" note="section-title 22 · ListRow 56">
							<Frame className="px-4 pt-2">
								<SectionHeading first note={2} action={<Link to="/dashboard">See all</Link>}>
									Needs you
								</SectionHeading>
								<List>
									<ListRow
										render={<Link to="/dashboard/career" />}
										leading={<StageDot status="offer">{null}</StageDot>}
										title="Reply to Parcel & Co."
										subtitle="Offer · by Friday 13 Nov"
										caret
									/>
									<ListRow
										render={<Link to="/dashboard" />}
										leading={<DocumentThumb />}
										title="Product designer"
										subtitle="Resume · 16 minutes ago"
										trailing={
											<Badge variant="accent">
												<Icon name="globe-simple" />
												Public
											</Badge>
										}
									/>
									<ListRow
										// oxlint-disable-next-line jsx-a11y/label-has-associated-control -- the switch is nested
										render={<label />}
										title="Public link"
										subtitle="Anyone with the link can view"
										trailing={<Switch defaultChecked />}
									/>
								</List>
							</Frame>
						</Group>

						<Group title="Hero" note="HeroCard · radius 16 · the one next step">
							<HeroCard
								className="p-5 sm:p-5 [&>div:last-child]:mt-2"
								kicker={<StageDot status="interview">Interview · Tue 10 Nov, 10:00</StageDot>}
								title="Technical interview at Lumen"
								actions={
									<>
										<Button size="lg">Open briefing</Button>
										<Button size="lg" variant="ghost">
											Add to calendar
										</Button>
									</>
								}
							/>
						</Group>
					</div>
				</div>

				<div className="grid items-start gap-7 lg:grid-cols-3">
					<div className="flex min-w-0 flex-col gap-2.5 lg:col-span-2">
						<Group first title="Set up AI line" note="first row under the title · one secondary button">
							<SetUpAiLine lead="A fit check needs AI." onSetUp={() => toast.add({ description: "Set up AI pressed" })}>
								The posting's terms, your resume and your Knowledge work without it.
							</SetUpAiLine>
							<Quiet>
								The words say what needs AI and what works without it. AI-only buttons are left out, not greyed. The
								button opens one dialog over the page.
							</Quiet>
						</Group>

						<Group title="Selection bar" note="SelectionBar · floats over the list · radius 16">
							<Row>
								{selected > 0 ? (
									<SelectionBar
										label="Selected documents"
										count={selected}
										total={5}
										onSelectAll={() => setSelected(5)}
										onClear={() => setSelected(0)}
										className="static translate-x-0"
									>
										<Button size="sm" variant="ghost">
											<Icon name="tag" />
											Tags…
										</Button>
										<Button size="sm" variant="ghost">
											<Icon name="globe-simple" />
											Sharing
											<Icon name="caret-down" size={14} />
										</Button>
										<Button size="sm" variant="danger-text">
											<Icon name="trash" />
											Move to Trash
										</Button>
									</SelectionBar>
								) : (
									<Button size="sm" variant="secondary" onClick={() => setSelected(2)}>
										Select 2 again
									</Button>
								)}
							</Row>
							<Quiet>Appears with the first tick and leaves with the last. The page header does not change.</Quiet>
						</Group>

						<Group title="Stage stepper" note="StageStepper · done, now, to come · always with words">
							<StageStepper aria-label="Stage" current="interview" className="max-w-[520px]" />
						</Group>

						<Group title="Toast" note="Toast · Undo and fuse">
							<Row>
								<div
									data-design="toast"
									className="relative flex min-w-[280px] items-center gap-4 overflow-hidden rounded-lg bg-ink py-2.5 ps-4 pe-2 text-sm text-bg shadow-e3"
								>
									<span>Moved to Trash</span>
									<span className="ms-auto flex h-7 items-center px-2 font-semibold">Undo</span>
									<span className="absolute start-0 bottom-0 h-0.5 w-[62%] bg-accent" />
								</div>
							</Row>
						</Group>
					</div>

					<div className="flex min-w-0 flex-col gap-2.5">
						<Group first title="Empty state" note="EmptyState · dashed line-2">
							<EmptyState
								className="px-[18px] py-6 [&_p]:text-[13px]/[18px]"
								title="Follow each job from saved to offer"
								description="Paste a job link. The posting is kept, so Check, the assistant and your letter can use it."
								action={
									<Button>
										<Icon name="plus" />
										Save a job
									</Button>
								}
								secondary={<Button variant="secondary">Import from CSV</Button>}
							/>
						</Group>

						<Group title="Placeholder row" note="sunken · final size · no shimmer">
							<Frame className="px-4">
								<List>
									{[
										["w-[46%]", "w-[68%]"],
										["w-[34%]", "w-[56%]"],
									].map(([title, subtitle]) => (
										<ListRow key={title} leading={<Skeleton className="size-10" />}>
											<span className="flex flex-1 flex-col gap-2">
												<Skeleton className={cn("h-3.5 rounded-sm", title)} />
												<Skeleton className={cn("h-3 rounded-sm", subtitle)} />
											</span>
											<Skeleton className="h-3 w-12 rounded-sm" />
										</ListRow>
									))}
								</List>
							</Frame>
							<Row className="text-sm text-ink-2">
								<Spinner decorative />
								Loading connection request…
							</Row>
							<Quiet>One loader, 14px, always beside words that say what is happening.</Quiet>
						</Group>
					</div>
				</div>

				<Group
					first
					title="Save status line"
					note="under the document name · a word first · colour only when you need to act"
				>
					<div className="grid gap-x-7 gap-y-3.5 lg:grid-cols-3">
						{SAVE_STATES.map(({ note, tone, icon, text }, index) => (
							<div key={note} className="flex flex-col gap-1.5">
								<code className="font-mono text-[11px]/4 font-medium text-ink-3">{note}</code>
								<div
									data-design="ebar"
									className="flex h-[50px] items-center gap-2 rounded-lg border border-line bg-bg px-3"
								>
									<span className="flex size-9 items-center justify-center text-ink-2">
										<Icon name="caret-left" />
									</span>
									<div className="flex min-w-0 flex-col px-1">
										<span className="flex items-center gap-1 text-[15px]/5 font-semibold">
											Product designer
											<Icon name="caret-down" size={14} className="text-ink-3" />
										</span>
										<span className={cn("flex items-center gap-1.5 text-xs", tone ?? "text-ink-3")}>
											{index === 1 && <Spinner decorative className="size-3" />}
											{icon && <Icon name={icon} size={14} />}
											<span>{text}</span>
										</span>
									</div>
								</div>
							</div>
						))}
						<p className="max-w-[520px] self-end t-small text-ink-3 lg:col-span-2">
							Amber when the work is safe but waiting on you or the network; red when a save did not happen. The action
							sits in the line itself. E3 draws each state with its cause, E4 the offline builder.
						</p>
					</div>
				</Group>
			</main>
			<section className="m-10 flex max-w-[1080px] flex-col gap-7">
				<h2 className="border-t border-line pt-7 t-section-title">Not on the Kit board</h2>
				<Group title="Two-column combobox">
					<Combobox
						columns={2}
						aria-label="Provider (two columns)"
						options={providerOptions}
						placeholder="Choose a provider"
					/>
				</Group>
				<Group title="Interactive menu and toast">
					<Row>
						<DropdownMenu>
							<DropdownMenuTrigger render={<Button variant="secondary" size="sm" />}>
								Open the real menu
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start">
								<DropdownMenuItem>
									<Icon name="arrow-square-out" />
									Open
								</DropdownMenuItem>
								<DropdownMenuItem>
									<Icon name="copy" />
									Duplicate
								</DropdownMenuItem>
								<DropdownMenuItem disabled>
									<Icon name="pencil-simple" />
									Rename
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem variant="destructive">
									<Icon name="trash" />
									Move to Trash
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<Button
							size="sm"
							variant="secondary"
							onClick={() => toast.add({ description: "Moved to Trash", actionProps: { children: "Undo" } })}
						>
							Show the real toast
						</Button>
					</Row>
				</Group>

				<Group title="Filter bar" note="FilterBar · field 260 × 36 · Chip 28">
					<FilterBar
						end={
							<>
								<Button variant="ghost" size="sm">
									<Icon name="arrows-down-up" />
									Last edited
								</Button>
								<SegmentedControl aria-label="View" defaultValue="grid">
									<SegmentedControlItem value="grid" aria-label="Grid">
										<Icon name="squares-four" size={18} />
									</SegmentedControlItem>
									<SegmentedControlItem value="list" aria-label="List">
										<Icon name="rows" size={18} />
									</SegmentedControlItem>
								</SegmentedControl>
							</>
						}
					>
						<FilterField label="Filter documents" shortcut="/" />
						<Chip pressed>Public</Chip>
						<Chip pressed={false}>Design systems</Chip>
						<Chip pressed={false}>Remote</Chip>
					</FilterBar>
				</Group>

				<Group title="Data table" note="DataTable · header 32 · row 56 · subgrid columns">
					<DataTable aria-label="Applications" columns="40px minmax(0,1.1fr) 108px minmax(0,1fr) max-content 28px">
						<DataTableHead>
							<DataTableRow variant="header">
								<DataTableHeaderCell>
									<span className="sr-only">Select</span>
								</DataTableHeaderCell>
								<DataTableHeaderCell>Company</DataTableHeaderCell>
								<DataTableHeaderCell>Stage</DataTableHeaderCell>
								<DataTableHeaderCell>Next step</DataTableHeaderCell>
								<DataTableHeaderCell sort="descending">Updated</DataTableHeaderCell>
								<DataTableHeaderCell>
									<span className="sr-only">Actions</span>
								</DataTableHeaderCell>
							</DataTableRow>
						</DataTableHead>
						<DataTableBody>
							<DataTableRow variant="group">
								<DataTableCell full>Interview</DataTableCell>
							</DataTableRow>
							{(
								[
									[
										"LU",
										"Lumen",
										"Senior product designer",
										"interview",
										"Technical interview · Tue 10 Nov",
										"2 days ago",
									],
									["PC", "Parcel & Co.", "Product designer", "offer", "Reply by Friday 13 Nov", "Yesterday"],
									["FN", "Fieldnote", "Design lead", "applied", "Follow up", "28 Oct"],
								] as const
							).map(([initials, company, role, status, next, updated], index) => (
								<DataTableRow key={company} selected={index === 1}>
									<DataTableCell>
										<IconTile>{initials}</IconTile>
									</DataTableCell>
									<DataTableCell header className="flex-col items-start gap-0">
										<Link to="/dashboard/applications" className={cn("t-row-title", rowLinkClassName)}>
											{company}
										</Link>
										<span className="t-small text-ink-3">{role}</span>
									</DataTableCell>
									<DataTableCell>
										<StageDot status={status} />
									</DataTableCell>
									<DataTableCell>{next}</DataTableCell>
									<DataTableCell className="t-small text-ink-3">{updated}</DataTableCell>
									<DataTableCell className={cn("relative z-10", revealOnRowClassName)}>
										<IconButton icon="dots-three" label={`More actions for ${company}`} size="icon-xs" iconSize={16} />
									</DataTableCell>
								</DataTableRow>
							))}
						</DataTableBody>
					</DataTable>
				</Group>

				<div className="grid items-start gap-7 lg:grid-cols-3">
					<Group title="Rows" note="selected · danger · dim · tight · actions on hover">
						<List cap>
							<ListRow
								leading={<DateColumn day="10" label="Nov" />}
								title={
									<Link to="/dashboard" className={rowLinkClassName}>
										Technical interview
									</Link>
								}
								subtitle="Lumen · 10:00"
								interactive
								actions={<IconButton icon="dots-three" label="More actions" size="icon-xs" iconSize={16} />}
							/>
							<ListRow
								leading={<IconTile accent>AM</IconTile>}
								title="Selected row"
								subtitle="On accent-soft"
								selected
							/>
							<ListRow
								leading={
									<IconTile>
										<Icon name="trash" />
									</IconTile>
								}
								title="Move to Trash"
								variant="danger"
								value="30 days"
							/>
							<ListRow title="Set aside" subtitle="Dim" variant="dim" />
						</List>
						<List tight>
							<ListRow title="Underline links" trailing={<Switch aria-label="Underline links" defaultChecked />} />
							<ListRow title="Show page numbers" trailing={<Switch aria-label="Show page numbers" />} />
						</List>
					</Group>

					<Group title="Category strip · thumbnails · marks" note="CategoryStrip 28 · DocumentThumb 32 × 44">
						<Row className="justify-between">
							<Crumb>
								<CrumbLink to="/builder/kit">Design</CrumbLink>
							</Crumb>
							<CategoryStrip current={category} onSelect={setCategory} />
						</Row>
						<Row className="gap-3">
							<DocumentThumb />
							<DocumentThumb kind="letter" />
							<span className="flex items-center gap-1.5 t-small text-ink-2">
								<WarnDot />3 things to review
							</span>
						</Row>
						<StageStepper
							aria-label="Stage, with dates"
							current="applied"
							steps={[
								{ status: "saved", date: "12 Oct" },
								{ status: "applied", date: "28 Oct" },
								{ status: "screening" },
								{ status: "interview" },
								{ status: "offer" },
							]}
						/>
					</Group>

					<Group title="Hero, wide" note="HeroCard wide · secondary action">
						<HeroCard wide title="Set up AI" actions={<Button variant="secondary">Set up AI</Button>}>
							Tailoring, Improve and the assistant need a connection.
						</HeroCard>
					</Group>
				</div>

				<Group title="Page frame" note="Page · PageBody 1040 · Columns main + 360">
					<Frame>
						<Page>
							<PageBody>
								<Columns
									aside={<div className="rounded-lg bg-sunken p-3 t-small text-ink-2">Aside, 360 from 1280</div>}
								>
									<div className="rounded-lg bg-sunken p-3 t-small text-ink-2">Main column</div>
								</Columns>
							</PageBody>
						</Page>
					</Frame>
				</Group>
			</section>
		</div>
	);
}

type SidebarItemProps = {
	icon: "house" | "file-text" | "briefcase" | "compass" | "trash" | "keyboard";
	current?: boolean;
	end?: ReactNode;
	children: ReactNode;
};

/** A drawing of the sidebar's item for this page only; the real sidebar lives in the app shell. */
function SidebarItem({ icon, current = false, end, children }: SidebarItemProps) {
	return (
		<div
			className={cn(
				"flex h-10 items-center gap-3 rounded-md px-2.5 text-sm font-medium",
				current ? "bg-accent-soft text-accent-text" : "text-ink-2",
			)}
		>
			<Icon name={icon} filled={current} />
			{children}
			{end}
		</div>
	);
}

const SidebarCount = ({ children }: { children: ReactNode }) => (
	<span className="ms-auto t-mono text-ink-3">{children}</span>
);

const SidebarBadge = ({ children }: { children: ReactNode }) => (
	<span className="ms-auto h-[18px] min-w-[18px] rounded-full bg-warn px-[5px] text-center font-mono text-[11px]/[18px] font-semibold text-warn-ink">
		{children}
	</span>
);
