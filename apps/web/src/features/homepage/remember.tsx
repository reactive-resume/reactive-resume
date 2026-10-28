import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { cn } from "@reactive-resume/utils/style";
import { SCENE } from "./scroll";
import { Doodle, labelClass } from "./ui";

/** The story's five parts: Situation, Task, Action, Result and Reflection. */
type Part = "s" | "t" | "a" | "r" | "f";
type Destination = "answer" | "opening" | "reply";
type Draft = { context: string; parts: Part[]; sentences: string[] };

function useStory() {
	return [
		{
			part: "s",
			letter: t`S`,
			label: t`Situation`,
			text: t`Most new teams at Northwind Labs stalled during setup and never reached activation.`,
		},
		{ part: "t", letter: t`T`, label: t`Task`, text: t`Find out why, and shorten setup without adding support work.` },
		{
			part: "a",
			letter: t`A`,
			label: t`Action`,
			text: t`Interviewed 14 customers, mapped three drop-off points and prototyped a shorter setup with engineering.`,
		},
		{ part: "r", letter: t`R`, label: t`Result`, text: t`Activation rose from 31% to 44% in one quarter.` },
		{
			part: "f",
			letter: t`R`,
			label: t`Reflection`,
			text: t`Next time, I’d agree how to measure success before the first prototype.`,
		},
	] satisfies { part: Part; letter: string; label: string; text: string }[];
}

/**
 * The same story, drafted for three places in an application's workspace. With the result's fact switched off, the
 * number isn't in what's sent, so the drafts leave the result out rather than guess it.
 */
function useDraft(destination: Destination, withResult: boolean): Draft {
	const drafts: Record<Destination, [Part, string][]> = {
		answer: [
			["s", t`At Northwind Labs, most new teams stalled before they finished setup.`],
			[
				"a",
				t`I interviewed 14 customers, mapped three drop-off points and prototyped a shorter setup with engineering.`,
			],
			["r", t`Activation rose from 31% to 44% in one quarter.`],
		],
		opening: [
			["s", t`New teams at Northwind were stalling in setup; most never got through.`],
			["t", t`My job was to find out why, without adding support work.`],
			[
				"a",
				t`So I talked to 14 customers, found the three places people dropped off, and we prototyped a shorter setup.`,
			],
			["r", t`Within a quarter, activation went from 31% to 44%.`],
			["f", t`If I did it again, I’d agree on the measure before the first prototype.`],
		],
		reply: [
			[
				"a",
				t`Thanks, Sam. Here’s one: at Northwind Labs I led the onboarding redesign, from 14 customer interviews to a shorter setup.`,
			],
			["r", t`Activation rose from 31% to 44% in one quarter.`],
			["a", t`Happy to walk you through it on our call.`],
		],
	};
	const contexts: Record<Destination, string> = {
		answer: t`Apply · Describe a product improvement you led.`,
		opening: t`Practice · Your opening, about 40 seconds aloud`,
		reply: t`Messages · Reply to Sam at Fieldnote`,
	};
	const kept = drafts[destination].filter(([part]) => withResult || part !== "r");

	return {
		context: contexts[destination],
		parts: [...new Set(kept.map(([part]) => part))],
		sentences: kept.map(([, sentence]) => sentence),
	};
}

/**
 * 07 Remember: Knowledge, and what the coach does with it, played with rather than scrolled. One story, written once
 * with the fact behind its result, becomes an application answer, an interview opening or a reply to a recruiter; the
 * parts each draft draws on light up on the card. Switch the fact off and every draft drops the number instead of
 * guessing it.
 */
export function Remember() {
	const story = useStory();
	const [destination, setDestination] = useState<Destination>("answer");
	const [withResult, setWithResult] = useState(true);
	// The first draft settles in with the scroll; after that, every change settles in on its own.
	const [changed, setChanged] = useState(false);
	// The pencilled hint by the switch stays until the switch has been tried.
	const [switched, setSwitched] = useState(false);
	const draft = useDraft(destination, withResult);
	const remember = t`Remember`;

	// Phones get the short names; the sheet's first line says where each draft goes.
	const destinations: { value: Destination; label: string; short: string }[] = [
		{ value: "answer", label: t`Application answer`, short: t`Answer` },
		{ value: "opening", label: t`Interview opening`, short: t`Opening` },
		{ value: "reply", label: t`Recruiter reply`, short: t`Reply` },
	];

	return (
		<section
			id="remember"
			data-scene={SCENE.remember}
			aria-labelledby="remember-title"
			className="relative mx-auto max-w-[1440px] px-(--gutter) pt-[14vh] pb-[4vh] [--rin:clamp(0,(var(--p)-.1)/.45,1)]"
		>
			<div className="flex flex-wrap items-end justify-between gap-x-16 gap-y-6">
				<div className="flex flex-col gap-3">
					<span className={cn(labelClass, "text-accent-text")}>07 / {remember}</span>
					<h2
						id="remember-title"
						className="font-anybody text-[15vw] leading-[.9] font-light tracking-[-.03em] text-ink [font-stretch:calc(86%+var(--rin)*14%)] [transition:font-stretch_.3s] min-[900px]:text-[clamp(72px,9vw,160px)]"
					>
						{remember}
						<span className="text-accent">.</span>
					</h2>
				</div>
				<div className="flex max-w-[30em] flex-col gap-3 pb-[1vw]">
					<p className="font-display text-[clamp(26px,2.6vw,42px)] leading-[1.1] tracking-[-.01em] text-accent-text italic">
						{t`Same you. Less starting over.`}
					</p>
					<p className="font-display text-[clamp(17px,1.35vw,20px)] leading-[1.45] text-pretty text-ink-2">
						{t`Write a story once, with the facts behind it, and the coach uses it in 3 places. Switch a fact off and nothing leans on it.`}
					</p>
				</div>
			</div>

			<div className="mt-[7vh] grid items-start gap-x-[5vw] gap-y-12 min-[1000px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
				{/* Knowledge: the story on an index card, with its result's fact clipped to it. */}
				<div className="relative flex [transform:translateY(calc((1-var(--rin))*8vh))_rotate(calc(-1.2deg-(1-var(--rin))*3deg))] flex-col opacity-[clamp(0,var(--rin)*3,1)] [transition:transform_.5s_var(--ease)]">
					<span className={cn(labelClass, "mb-3 text-ink-3")}>{t`Knowledge`}</span>
					<div className="on-paper rounded-md bg-paper px-[clamp(18px,2vw,30px)] py-[clamp(18px,2vw,26px)] shadow-paper">
						<span className="font-martian flex items-center gap-2 text-xs font-medium text-accent-text">
							<Icon name="book-open" size={15} />
							{t`Story · 5 of 5 parts`}
						</span>
						<h3 className="mt-2 font-display text-[clamp(20px,1.7vw,26px)] leading-[1.15] font-medium text-pretty text-ink">
							{t`Fixing onboarding drop-off at Northwind Labs`}
						</h3>
						{/* Below 1000px only the five tiles show, so the switch and the draft it changes share the screen. */}
						<ul className="mt-4 flex flex-col divide-y divide-line font-ui text-[14px] leading-[1.5] max-[999px]:mt-3 max-[999px]:flex-row max-[999px]:gap-1.5 max-[999px]:divide-y-0">
							{story.map((part) => {
								const missing = part.part === "r" && !withResult;
								const used = draft.parts.includes(part.part);
								return (
									<li
										key={part.part}
										className={cn(
											"flex gap-3 py-2.5 transition-opacity duration-300 max-[999px]:py-0",
											!used && !missing && "opacity-55",
										)}
									>
										<span
											aria-hidden="true"
											className={cn(
												"grid size-6 shrink-0 place-items-center rounded-md border text-[12px] font-bold transition-[background-color,border-color,color] duration-300",
												missing
													? "border-dashed border-line-2 text-ink-3"
													: used
														? "border-transparent bg-accent-soft text-accent-text"
														: "border-line-2 text-ink-3",
											)}
										>
											{part.letter}
										</span>
										<span className="flex min-w-0 flex-col max-[999px]:hidden">
											<span className="flex flex-wrap items-center gap-x-2 text-[12px] font-semibold text-ink-2">
												{part.label}
												{missing && (
													<span className="inline-flex items-center gap-1 rounded-lg bg-warn-soft px-1.5 text-[11px] font-medium text-warn-text">
														<Icon name="question" size={12} />
														{t`No evidence yet`}
													</span>
												)}
											</span>
											<span className={cn("text-ink transition-opacity duration-300", missing && "opacity-50")}>
												{part.text}
											</span>
										</span>
									</li>
								);
							})}
						</ul>
					</div>

					<div className="relative ms-[8%] -mt-2 rotate-[1.4deg]">
						<Doodle
							name="paperclip"
							wipe="clamp(0, (var(--p) - .3) / .2, 1)"
							sizes="64px"
							className="end-[10%] -top-[46px] z-2 w-[64px] rotate-[78deg]"
						/>
						<div
							className={cn(
								"on-paper rounded-md bg-paper px-5 py-4 ring-2 shadow-paper transition-shadow duration-500",
								withResult ? "ring-transparent" : "ring-[oklch(0.75_0.09_70/.6)]",
							)}
						>
							<span className="font-martian flex items-center gap-2 text-xs font-medium text-ink-3">
								{t`Fact · Accomplishment`}
							</span>
							<p className="mt-1.5 font-ui text-[14px] leading-[1.5] text-ink">
								{t`Activation rose from 31% to 44% in one quarter, measured across new teams.`}
							</p>
							<SwitchRow
								checked={withResult}
								onCheckedChange={(checked) => {
									setWithResult(checked);
									setChanged(true);
									setSwitched(true);
								}}
								label={t`Used in coaching`}
								description={withResult ? undefined : t`Off: the coach won’t see it or claim it.`}
								className="mt-2 border-t border-line pt-2.5"
							/>
						</div>
						<span
							aria-hidden="true"
							className={cn(
								"pointer-events-none absolute start-[calc(100%+12px)] bottom-[6px] hidden items-end gap-1 text-ink-2 transition-opacity duration-500 min-[1000px]:flex",
								switched && "opacity-0",
							)}
						>
							<svg viewBox="0 0 64 40" className="w-14 shrink-0 overflow-visible rtl:-scale-x-100">
								<path
									d="M62 6C46 2 26 6 16 20S6 34 4 34M4 34L12 30M4 34L7 25"
									pathLength={1}
									fill="none"
									stroke="currentColor"
									strokeWidth="1.6"
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeDasharray="1 2"
									className="[filter:url(#landing-pencil)] [stroke-dashoffset:calc(1-clamp(0,(var(--p)-.55)/.25,1))] [transition:stroke-dashoffset_.8s_var(--ease)]"
								/>
							</svg>
							<span className="mb-6 -rotate-3 font-display text-[19px] whitespace-nowrap italic opacity-[clamp(0,(var(--p)-.6)*6,1)]">
								{t`Switch it off`}
							</span>
						</span>
					</div>
				</div>

				{/* The draft, on its own sheet, for the place you choose. */}
				<div className="flex [transform:translateY(calc((1-var(--rin))*12vh))] flex-col gap-4 opacity-[clamp(0,var(--rin)*2.5-.3,1)] [transition:transform_.6s_var(--ease)]">
					<SegmentedControl
						aria-label={t`Draft it as`}
						value={destination}
						onValueChange={(value) => {
							setDestination(value as Destination);
							setChanged(true);
						}}
						className="h-auto max-w-full [scrollbar-width:none] self-start overflow-x-auto rounded-sm border border-line bg-[color-mix(in_oklch,var(--surface)_85%,transparent)] p-1"
					>
						{destinations.map((item) => (
							<SegmentedControlItem
								key={item.value}
								value={item.value}
								className="h-9 flex-none rounded-sm px-3.5 font-ui text-[13.5px] duration-300 data-checked:bg-ink data-checked:text-bg data-checked:shadow-none"
							>
								<span className="max-[520px]:hidden">{item.label}</span>
								<span className="min-[521px]:hidden">{item.short}</span>
							</SegmentedControlItem>
						))}
					</SegmentedControl>

					<div className="on-paper relative rotate-[.5deg] rounded-md bg-paper px-[clamp(20px,3.4vw,52px)] py-[clamp(22px,3vw,44px)] shadow-paper">
						<span className="font-martian text-xs font-medium text-accent-text">{draft.context}</span>
						<p
							key={`${destination}-${withResult}`}
							aria-live="polite"
							className="mt-4 min-h-[8em] font-display text-[clamp(19px,1.65vw,26px)] leading-[1.55] text-pretty text-ink"
						>
							{draft.sentences.map((sentence, index) => (
								<span key={sentence}>
									<span
										className={cn(changed && "remember-settle")}
										style={
											{
												"--i": index,
												// The first time, the sentences come in one after another as the section scrolls in.
												opacity: changed ? undefined : `clamp(0, (var(--p) - ${0.35 + index * 0.06}) * 8, 1)`,
											} as CSSProperties
										}
									>
										{sentence}
									</span>{" "}
								</span>
							))}
						</p>
						{!withResult && (
							<p className="remember-settle mt-3 inline-flex items-start gap-2 rounded-md border border-dashed border-[oklch(0.75_0.09_70)] px-3 py-2 font-ui text-[13.5px] text-warn-text">
								<Icon name="question" size={16} className="mt-0.5 shrink-0" />
								{t`Result left out: no fact backs it. Switch it on, or add one, and it comes back.`}
							</p>
						)}

						<div className="mt-6 flex flex-col gap-3 border-t border-line pt-4 font-ui text-[13px] text-ink-3">
							<span className="flex flex-wrap items-center gap-1.5">
								{t`Backed by`}
								<span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-ink-2">
									<Icon name="book-open" size={14} />
									{t`Onboarding story`}
								</span>
								{withResult && (
									<span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line px-2 text-ink-2">
										<Icon name="link-simple-horizontal" size={14} />
										{t`Activation rose from 31%…`}
									</span>
								)}
							</span>
							<span className="flex items-start gap-1.5">
								<Icon name="lock" size={15} className="mt-px shrink-0" />
								{t`Sends this story and the facts switched on to your AI connection. Without one, nothing is sent.`}
							</span>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
