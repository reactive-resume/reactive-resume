import type { CSSProperties, ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { goToScene, INTERVIEW_AT, SCENE, useLanding } from "./scroll";
import { Doodle, labelClass, SceneCaption, Stamp, TypedText } from "./ui";

/** Prepare's steps, as `prepareStep` counts them. */
const STEP = { messages: 0, fit: 1, plan: 2, practise: 3, interview: 4, debrief: 5 } as const;

/** Where each tab scrolls the scene to: just after its last change lands. */
const TAB_AT: Record<number, number> = {
	[STEP.messages]: 0.165,
	[STEP.fit]: 0.345,
	[STEP.plan]: 0.52,
	[STEP.practise]: 0.69,
	[STEP.debrief]: 0.99,
};

/** The interview's day, for the clock's readout. Only the weekday and time are shown. */
const interviewDay = (minutes: number) => new Date(2026, 9, 8, Math.floor(minutes / 60), minutes % 60);

/** "17:30" (or "5:30 PM"), in the reader's locale. */
function useTime(minutes: number) {
	const { i18n } = useLingui();
	return i18n.date(interviewDay(minutes), { hour: "numeric", minute: "2-digit" });
}

/** The day's marks on the dial, at the time each part of it comes round. */
const dialMarks = [
	{ step: STEP.fit, minutes: 10 * 60 },
	{ step: STEP.plan, minutes: 13 * 60 },
	{ step: STEP.practise, minutes: 15 * 60 + 30 },
	{ step: STEP.interview, minutes: INTERVIEW_AT },
	{ step: STEP.debrief, minutes: 19 * 60 },
].map((mark) => {
	const angle = ((mark.minutes % 720) / 720) * 2 * Math.PI;
	return { ...mark, angle, x: Math.sin(angle), y: -Math.cos(angle) };
});

/**
 * The pencil clock the scroll winds, and the scene's map: the engine writes the time, in minutes, as --t; the hands
 * turn from it, a band shrinks from the hour hand to the interview, and the day's marks sit round the rim. During the
 * interview the minutes stop and only a second hand moves.
 */
function Clock() {
	const hand = (degreesPerMinute: number): CSSProperties => ({
		transformOrigin: "100px 100px",
		transform: `rotate(calc(var(--t, 540) * ${degreesPerMinute}deg))`,
	});

	return (
		<svg aria-hidden="true" viewBox="0 0 200 200" className="size-full overflow-visible">
			<g fill="none" stroke="currentColor" className="text-graphite [filter:url(#landing-pencil)]">
				<circle cx="100" cy="100" r="93" strokeWidth="1.6" />
				<circle cx="100" cy="100" r="97" strokeWidth=".7" />
				{Array.from({ length: 12 }, (_, tick) => (
					<line
						key={tick}
						x1="100"
						y1={tick % 3 === 0 ? 12 : 16}
						x2="100"
						y2="24"
						strokeWidth={tick % 3 === 0 ? 2.4 : 1.3}
						transform={`rotate(${tick * 30} 100 100)`}
					/>
				))}
			</g>
			{dialMarks.map((mark) => (
				<circle
					key={mark.step}
					cx={100 + mark.x * 93}
					cy={100 + mark.y * 93}
					r={mark.step === STEP.interview ? 4.5 : 3}
					fill="var(--accent)"
				/>
			))}
			<circle
				cx="100"
				cy="100"
				r="70"
				pathLength={1}
				fill="none"
				stroke="var(--accent)"
				strokeWidth="14"
				strokeLinecap="round"
				strokeDasharray="1 1"
				style={{
					transformOrigin: "100px 100px",
					transform: "rotate(calc(var(--t, 540) * .5deg - 90deg))",
					strokeDashoffset: `calc(1 - max(0, (${INTERVIEW_AT} - var(--t, 540)) / 720))`,
					// The band thins out over its last half hour rather than ending in a stub.
					opacity: `calc(.2 * clamp(0, (${INTERVIEW_AT} - var(--t, 540)) / 30, 1))`,
				}}
			/>
			{/* Tapered graphite hands, roughened by the same pencil filter as the dial. */}
			<g fill="var(--ink)" className="[filter:url(#landing-pencil)]">
				<path d="M96.5 104 L99 55 Q100 52 101 55 L103.5 104 Z" style={hand(0.5)} />
				<path d="M98 112 L99.4 28 Q100 25 100.6 28 L102 112 Z" style={hand(6)} />
			</g>
			<line
				x1="100"
				y1="118"
				x2="100"
				y2="20"
				stroke="var(--accent)"
				strokeWidth="1.4"
				strokeLinecap="round"
				opacity="var(--nw)"
				className="origin-[100px_100px] [transform:rotate(calc(clamp(0,(var(--p)-.7)/.13,1)*1080deg))]"
			/>
			<circle cx="100" cy="100" r="5.5" fill="var(--accent)" />
		</svg>
	);
}

/** "Thu 14:10 · Interview in 3h 20m", following the clock to the nearest five minutes. */
function ClockReadout({ step }: { step: number }) {
	const { i18n } = useLingui();
	const clock = useLanding((state) => state.prepareClock);
	const left = INTERVIEW_AT - clock;
	const hours = Math.floor(left / 60);
	const minutes = left % 60;
	const duration = [
		hours > 0 && i18n.number(hours, { style: "unit", unit: "hour", unitDisplay: "narrow" }),
		minutes > 0 && i18n.number(minutes, { style: "unit", unit: "minute", unitDisplay: "narrow" }),
	]
		.filter(Boolean)
		.join(" ");
	const status = step >= STEP.debrief ? t`Interview done` : left <= 0 ? t`Interview now` : t`Interview in ${duration}`;

	return (
		<p className={cn(labelClass, "text-ink-2 tabular-nums")}>
			<span className="text-accent-text">
				{i18n.date(interviewDay(clock), { weekday: "short", hour: "numeric", minute: "2-digit" })}
			</span>{" "}
			· {status}
		</p>
	);
}

/** Paper drawn on in either theme: the light theme's tokens, so the product's own colours read the same. */
const sheet = "on-paper relative h-full overflow-hidden rounded-md bg-paper shadow-paper";
const note = "font-ui text-[.86em] text-ink-3";

/** A pencil tick in a pencil box, drawn as `tick` goes from 0 to 1. */
function PencilTick({ tick }: { tick: string }) {
	return (
		<svg aria-hidden="true" viewBox="0 0 24 24" className="mt-[.1em] size-[1.35em] shrink-0 overflow-visible">
			<rect
				x="3"
				y="4"
				width="17"
				height="17"
				rx="2"
				fill="none"
				stroke="oklch(0.45 0.01 95 / .55)"
				strokeWidth="1.3"
			/>
			<path
				d="M6 12.5 L10.5 17 L22 2"
				pathLength={1}
				fill="none"
				stroke="oklch(0.42 0.1 150)"
				strokeWidth="2.6"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeDasharray="1 2"
				className="[filter:url(#landing-pencil)]"
				style={{ strokeDashoffset: `calc(1 - var(${tick}))` }}
			/>
		</svg>
	);
}

/** 0 Messages: Sam's confirmation, pasted in and read for you, with the stage change it proposes. */
function MessagesPanel() {
	const time = useTime(INTERVIEW_AT);
	return (
		<div className={cn(sheet, "flex flex-col gap-[1em] p-[1.8em]")}>
			<span className="font-martian text-[.74em] font-medium text-ink-3">{t`Messages · Pasted from your email`}</span>
			<div className="flex flex-col gap-[.15em] border-b border-line pb-[.7em] text-[.92em] text-ink-2">
				<span>
					<b className="font-semibold text-ink">{t`From`}</b> {t`Sam, Fieldnote`}
				</span>
				<span>
					<b className="font-semibold text-ink">{t`Subject`}</b> {t`Re: Senior Product Designer`}
				</span>
			</div>
			<p className="font-display text-[1.25em] leading-[1.45] text-pretty text-ink">
				{t`Hi Alex, great to confirm: you’ll meet our design team today at ${time}, by video. Could you bring an example of your onboarding work?`}
				<span className="mt-[.3em] block italic">{t`Sam`}</span>
			</p>

			<div className="flex [transform:translateY(calc((1-var(--mr))*10px))] flex-col gap-[.7em] rounded-sm border border-line bg-raised p-[1.1em] opacity-(--mr) shadow-e2 [transition:transform_.4s_var(--ease)]">
				<span className="flex items-center gap-[.45em] text-[.86em] font-medium text-ink-2">
					<Icon name="sparkle" size={15} className="text-accent-text" />
					{t`Read it for me`}
				</span>
				<b className="text-[1.08em] font-semibold text-ink">{t`They’ve confirmed your interview for today`}</b>
				<span className="flex items-start gap-[.5em] text-ink-2">
					<Icon name="check" size={17} className="mt-[.1em] shrink-0 text-accent-text" />
					{t`Confirms ${time} today, by video.`}
				</span>
				<span className="flex items-start gap-[.5em] text-ink-2">
					<Icon name="check" size={17} className="mt-[.1em] shrink-0 text-accent-text" />
					{t`Asks for an example of your onboarding work.`}
				</span>
				<div className="mt-[.2em] flex flex-wrap items-center justify-between gap-[.6em] rounded-sm border border-accent bg-surface px-[.9em] py-[.7em]">
					<span className="flex items-center gap-[.6em] font-medium text-ink">
						<span className="relative grid size-[1.25em] place-items-center rounded-sm border border-line-2">
							<span className="absolute inset-[-1px] grid place-items-center rounded-sm bg-accent text-on-accent opacity-(--mc)">
								<Icon name="check" size={13} />
							</span>
						</span>
						{t`Move to Interview`}
					</span>
					<span className="grid h-[2.3em] place-items-center rounded-sm bg-accent px-[1em] font-semibold text-on-accent">
						<span className="col-start-1 row-start-1 opacity-[calc(1-var(--mc))]">{t`Apply 1 change`}</span>
						<span className="col-start-1 row-start-1 flex items-center gap-[.4em] opacity-(--mc)">
							<Icon name="check" size={16} />
							{t({ message: "Applied", context: "A proposed change has been applied" })}
						</span>
					</span>
				</div>
			</div>
		</div>
	);
}

/** 1 Fit: each requirement in the posting, stamped with what your own facts say about it. */
function FitPanel() {
	const rows = [
		{
			requirement: t`Own and evolve a design system`,
			tone: "supported",
			label: t`Supported`,
			evidence: t`Built a shared design system used by six product teams.`,
		},
		{
			requirement: t`Run research with customers`,
			tone: "supported",
			label: t`Supported`,
			evidence: t`Led research for the onboarding redesign; activation rose from 31% to 44%.`,
		},
		{
			requirement: t`A high bar for accessibility`,
			tone: "supported",
			label: t`Supported`,
			evidence: t`Shipped checkout flows that meet WCAG 2.1 AA.`,
		},
		{
			requirement: t`Lead across functions`,
			tone: "partial",
			label: t`Partly supported`,
			evidence: t`You partnered with engineering. How you led the work isn’t described yet.`,
		},
		{
			requirement: t`Mentor other designers`,
			tone: "missing",
			label: t`No evidence yet`,
			evidence: t`Knowledge doesn’t mention mentoring.`,
		},
	] as const;

	return (
		<div className={cn(sheet, "flex flex-col gap-[.9em] p-[1.8em]")}>
			<div className="flex flex-wrap items-end justify-between gap-x-[1.5em] gap-y-[.4em]">
				<h3 className="max-w-[17em] font-display text-[1.55em] leading-[1.15] text-ink">
					{t`A strong match, with one question to resolve`}
				</h3>
				<span className="font-martian text-[.74em] text-ink-3">{t`3 supported · 1 partly · 1 missing`}</span>
			</div>
			<ul className="flex flex-col divide-y divide-line border-y border-line">
				{rows.map((row, index) => (
					<li key={row.requirement} className="flex items-center justify-between gap-[1em] py-[.75em]">
						<span className="flex min-w-0 flex-col gap-[.15em]">
							<b className="font-semibold text-ink">{row.requirement}</b>
							<span className="hidden text-[.92em] text-ink-2 @min-[520px]:block">{row.evidence}</span>
						</span>
						<Stamp tone={row.tone} stamp={`--s${index + 1}`}>
							{row.label}
						</Stamp>
					</li>
				))}
			</ul>
			<span className={note}>{t`Missing evidence means your notes don’t show it yet, not that you lack it.`}</span>
		</div>
	);
}

/** 2 Prepare: a 30-minute plan on a notepad, built from the posting and your stories, ticked off through the afternoon. */
function PlanPanel() {
	const { i18n } = useLingui();
	const rows = [
		{
			minutes: 10,
			title: t`Your onboarding story`,
			detail: t`Name the problem, what you led and how activation was measured.`,
		},
		{
			minutes: 10,
			title: t`Design system trade-offs`,
			detail: t`Rehearse one disagreement with engineering and how it ended.`,
		},
		{
			minutes: 5,
			title: t`Questions to ask`,
			detail: t`Who owns the design system today? What does success look like in 90 days?`,
		},
		{ minutes: 5, title: t`Say it aloud`, detail: t`Practice your introduction once. Keep it to about 90 seconds.` },
	];

	return (
		<div
			className={cn(
				sheet,
				"flex flex-col gap-[.8em] bg-paper bg-[linear-gradient(to_right,transparent_2.6em,oklch(0.75_0.1_25/.45)_2.6em,oklch(0.75_0.1_25/.45)_calc(2.6em+1px),transparent_calc(2.6em+1px)),repeating-linear-gradient(to_bottom,transparent_0,transparent_calc(2em-1px),oklch(0.85_0.03_240/.55)_calc(2em-1px),oklch(0.85_0.03_240/.55)_2em)] py-[1.6em] ps-[3.6em] pe-[1.8em] rtl:bg-[linear-gradient(to_left,transparent_2.6em,oklch(0.75_0.1_25/.45)_2.6em,oklch(0.75_0.1_25/.45)_calc(2.6em+1px),transparent_calc(2.6em+1px)),repeating-linear-gradient(to_bottom,transparent_0,transparent_calc(2em-1px),oklch(0.85_0.03_240/.55)_calc(2em-1px),oklch(0.85_0.03_240/.55)_2em)]",
			)}
		>
			<h3 className="font-display text-[1.55em] leading-[1.15] text-ink">{t`A focused 30-minute plan`}</h3>
			<span className="text-ink-2">{t`Built from the posting, Sam’s message and your two strongest stories.`}</span>
			<div aria-hidden="true" className="h-[.3em] overflow-hidden rounded-sm bg-[oklch(0.93_0.006_95)]">
				<div className="h-full origin-left [transform:scaleX(calc((var(--k1)*10+var(--k2)*10+var(--k3)*5+var(--k4)*5)/30))] rounded-sm bg-[oklch(0.5_0.1_150)] rtl:origin-right" />
			</div>
			<ul className="flex flex-col gap-[.35em]">
				{rows.map((row, index) => (
					<li key={row.title} className="flex items-start gap-[.8em] py-[.4em]">
						<PencilTick tick={`--k${index + 1}`} />
						<span className="font-martian w-[4.4em] shrink-0 pt-[.2em] text-[.76em] text-ink-3">
							{t`${i18n.number(row.minutes)} min`}
						</span>
						<span className="flex min-w-0 flex-1 flex-col gap-[.15em]">
							<b
								className="font-semibold text-ink [text-decoration-line:line-through] [text-decoration-color:color-mix(in_oklch,oklch(0.4_0.01_95/.8)_calc(var(--k)*100%),transparent)] [text-decoration-thickness:1.5px]"
								style={{ "--k": `var(--k${index + 1})` } as CSSProperties}
							>
								{row.title}
							</b>
							<span className="text-ink-2">{row.detail}</span>
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * 3 Practise: an index card with the question, read aloud on request by the browser's own voice, an answer typed in,
 * and how this attempt compares with the morning's.
 */
function PractisePanel({ active }: { active: boolean }) {
	const { i18n } = useLingui();
	const earlier = useTime(9 * 60 + 40);
	const now = useTime(15 * 60 + 20);
	const question = t`Tell me about a product improvement you led. What was your contribution, and how did you measure success?`;
	const [speaking, setSpeaking] = useState(false);

	// Leaving the tab, or the page, stops the voice.
	useEffect(() => {
		if (!active && speaking) window.speechSynthesis.cancel();
	}, [active, speaking]);
	useEffect(() => () => window.speechSynthesis?.cancel(), []);

	const hear = () => {
		const synthesis = window.speechSynthesis;
		if (!synthesis) return;
		synthesis.cancel();
		if (speaking) return setSpeaking(false);
		const utterance = new SpeechSynthesisUtterance(question);
		utterance.lang = i18n.locale;
		utterance.rate = 0.98;
		utterance.onend = () => setSpeaking(false);
		utterance.onerror = () => setSpeaking(false);
		synthesis.speak(utterance);
		setSpeaking(true);
	};

	return (
		<div className={cn(sheet, "flex flex-col gap-[.9em] border-t-[.35em] border-[oklch(0.7_0.12_25/.55)] p-[1.8em]")}>
			<div className="flex flex-wrap items-center justify-between gap-[1em]">
				<span className="font-martian text-[.74em] text-ink-3">{t`Question 1 of 4 · Practice`}</span>
				<button
					type="button"
					onClick={hear}
					aria-pressed={speaking}
					title={t`Uses your browser’s voice`}
					className="-me-[.5em] inline-flex h-[2.2em] items-center gap-[.4em] rounded-sm px-[.6em] font-medium text-ink transition-colors hover:bg-hover"
				>
					<Icon name={speaking ? "stop" : "speaker-high"} size={17} />
					{speaking ? t`Stop` : t`Hear it`}
				</button>
			</div>
			<p className="font-display text-[1.4em] leading-[1.25] text-pretty text-ink">{question}</p>
			<p className="min-h-[5.6em] rounded-sm border border-line-2 px-[.9em] py-[.7em] leading-[1.55] text-ink">
				<TypedText
					text={t`At Northwind Labs I led research for our onboarding redesign. I interviewed 14 customers, found three drop-off points, and we shipped a shorter setup. Activation rose from 31% to 44%.`}
					progress="--ty"
					rate={120}
				/>
			</p>
			<div className="flex flex-col gap-[.35em] border-t border-line pt-[.8em]">
				<span className="font-semibold text-ink">{t`Your attempts`}</span>
				<span className="flex flex-wrap gap-x-[.5em]">
					<span className="text-ink-3">{t`${earlier} · typed`}</span>
					<span className="text-[oklch(0.5_0.11_70)]">{t`Contribution unclear`}</span>
				</span>
				<span className="flex flex-wrap gap-x-[.5em] opacity-(--fb)">
					<span className="text-ink-3">{t`${now} · typed`}</span>
					<span className="font-medium text-accent-text">{t`Contribution clear`}</span>
				</span>
			</div>
			<span className={cn(note, "mt-auto")}>{t`Practice questions are simulated, not from Fieldnote.`}</span>
		</div>
	);
}

/** 5 Debrief: what they asked, how it landed, and which parts your evidence backs. */
function DebriefPanel() {
	const outcomes = [t`Went well`, t`Mixed`, t`Didn’t land`];

	return (
		<div className={cn(sheet, "flex flex-col gap-[.9em] p-[1.8em]")}>
			<div className="flex flex-wrap items-baseline justify-between gap-x-[1em]">
				<b className="text-[1.08em] font-semibold text-ink">{t`After the interview · Today`}</b>
				<span className="text-[.86em] text-ink-3">{t`Write it down while it’s fresh`}</span>
			</div>
			<div className="flex flex-col gap-[.3em]">
				<span className="text-[.86em] text-ink-2">{t`What did they ask?`}</span>
				<span className="font-display text-[1.3em] leading-[1.3] text-ink italic">
					{t`“How did you measure the onboarding redesign?”`}
				</span>
			</div>
			<div className="flex flex-col gap-[.45em]">
				<span className="text-[.86em] text-ink-2">{t`How did it land?`}</span>
				<span className="flex flex-wrap gap-[.4em]">
					{outcomes.map((outcome, index) => (
						<span
							key={outcome}
							className={cn(
								"inline-flex h-[2.1em] items-center rounded-sm border border-line-2 px-[.85em] text-[.92em] font-medium text-ink",
								index === 1 &&
									"bg-[color-mix(in_oklch,var(--ink)_calc(var(--db1)*100%),transparent)] text-[color-mix(in_oklch,white_calc(var(--db1)*100%),var(--ink))]",
							)}
						>
							{outcome}
						</span>
					))}
				</span>
			</div>
			<div className="flex flex-col gap-[.6em] border-t border-line pt-[.8em]">
				<b className="font-semibold text-ink">{t`Keep the evidence precise`}</b>
				<p className="flex items-start gap-[.6em] text-ink opacity-(--db2)">
					<span className="font-martian mt-[.1em] shrink-0 rounded-sm bg-accent-soft px-[.45em] py-[.15em] text-[.74em] text-accent-text">
						{t`Supported`}
					</span>
					{t`The 13-point activation lift. Knowledge has the before and after.`}
				</p>
				<p className="flex items-start gap-[.6em] text-ink opacity-(--db3)">
					<span className="font-martian mt-[.1em] shrink-0 rounded-sm bg-warn-soft px-[.45em] py-[.15em] text-[.74em] text-warn-text">
						{t`Observation`}
					</span>
					{t`Fewer support tickets isn’t backed by a number yet. Say it as something you noticed.`}
				</p>
				<p className="text-ink opacity-(--db4)">
					<b className="font-semibold">{t`Practice priority:`}</b>{" "}
					{t`explain one limit of the measurement clearly, without underselling the work.`}
				</p>
			</div>
			<span className={cn(note, "mt-auto")}>
				{t`Practice priorities, not conclusions about why an employer decided anything.`}
			</span>
		</div>
	);
}

/**
 * The Prepare tab's badge: time to the interview, to the hour (to five minutes in the last hour). It subscribes on its
 * own so the scene doesn't re-render while the clock winds.
 */
function Countdown() {
	const { i18n } = useLingui();
	const left = useLanding((state) => {
		const remaining = INTERVIEW_AT - state.prepareClock;
		return remaining >= 60 ? Math.floor(remaining / 60) * 60 : Math.max(0, remaining);
	});
	if (left <= 0) return t`Now`;
	return left >= 60
		? i18n.number(left / 60, { style: "unit", unit: "hour", unitDisplay: "narrow" })
		: i18n.number(left, { style: "unit", unit: "minute", unitDisplay: "narrow" });
}

/**
 * 06 Prepare. The resume Share sent off comes back as a reply: Fieldnote confirms an interview today at half past
 * five. The scroll winds a pencil clock through the day while the application's folder moves from tab to tab: the
 * message read, the fit stamped, a plan ticked off, an answer practised. At the interview everything but the clock
 * steps back for a breath, then the debrief comes in as the light goes. The tabs jump to each part of the day.
 */
export function Prepare() {
	const { i18n } = useLingui();
	const scrolledStep = useLanding((state) => state.prepareStep);
	const active = useLanding((state) => state.activeScene === SCENE.prepare);
	const reducedMotion = useLanding((state) => state.reducedMotion);
	// Reduced motion rests the scene at its end, so there the tabs switch sheets in place instead of scrolling.
	const [chosen, setChosen] = useState<number>(STEP.debrief);
	const step = reducedMotion ? chosen : scrolledStep;
	const time = useTime(INTERVIEW_AT);
	const tabsRef = useRef<HTMLDivElement>(null);
	const prepare = t`Prepare`;

	// The product's tabs in its own order; Apply and Saved aren't part of this day, so they're labels, not buttons.
	const tabs: { label: string; step?: number; badge?: ReactNode }[] = [
		{
			label: t({ message: "Fit", context: "Application workspace tab: how well a job fits your experience" }),
			step: STEP.fit,
		},
		{ label: t`Apply` },
		{ label: prepare, step: STEP.plan, badge: step >= STEP.debrief ? null : <Countdown /> },
		{ label: t`Practice`, step: STEP.practise },
		{ label: t`Debrief`, step: STEP.debrief },
		{ label: t`Messages`, step: STEP.messages, badge: step > STEP.messages ? i18n.number(1) : null },
		{ label: t({ message: "Saved", context: "Application workspace tab: earlier results kept for this job" }) },
	];
	// The interview itself has no tab: Practise stays in front beneath the pause.
	const frontStep = step === STEP.interview ? STEP.practise : step;
	const dialLabels: Record<number, string> = {
		[STEP.fit]: t({ message: "Fit", context: "Application workspace tab: how well a job fits your experience" }),
		[STEP.plan]: prepare,
		[STEP.practise]: t`Practice`,
		[STEP.interview]: t`Interview`,
		[STEP.debrief]: t`Debrief`,
	};

	// On narrow screens the tab row scrolls; keep the tab in front in view.
	useEffect(() => {
		const row = tabsRef.current;
		const front = row?.querySelector<HTMLElement>("[data-front]");
		if (!row || !front || row.scrollWidth <= row.clientWidth) return;
		row.scrollTo({ left: front.offsetLeft - row.clientWidth / 2 + front.offsetWidth / 2, behavior: "smooth" });
	}, [frontStep]);

	// Each sheet slides up out of the folder over the one before; the earlier sheets stay beneath, edges showing.
	const panels = [
		[STEP.messages, "1", "-1.6deg", <MessagesPanel key="messages" />],
		[STEP.fit, "var(--e1)", ".5deg", <FitPanel key="fit" />],
		[STEP.plan, "var(--e2)", "-.4deg", <PlanPanel key="plan" />],
		[STEP.practise, "var(--e3)", ".7deg", <PractisePanel key="practise" active={active && step === STEP.practise} />],
		[STEP.debrief, "var(--e4)", "-.6deg", <DebriefPanel key="debrief" />],
	] as const;

	return (
		<section
			id="prepare"
			data-scene={SCENE.prepare}
			data-pin
			aria-labelledby="prepare-title"
			className="relative h-[310vh] motion-reduce:h-svh min-[900px]:h-[330vh]"
		>
			<div className="sticky top-0 h-svh overflow-clip [--db1:clamp(0,(var(--p)-.88)*30,1)] [--db2:clamp(0,(var(--p)-.9)*30,1)] [--db3:clamp(0,(var(--p)-.93)*30,1)] [--db4:clamp(0,(var(--p)-.96)*30,1)] [--e1:clamp(0,(var(--p)-.19)*30,1)] [--e2:clamp(0,(var(--p)-.36)*30,1)] [--e3:clamp(0,(var(--p)-.53)*30,1)] [--e4:clamp(0,(var(--p)-.84)*30,1)] [--fb:clamp(0,(var(--p)-.655)*30,1)] [--in:clamp(0,var(--p)/.06,1)] [--k1:clamp(0,(var(--p)-.4)*40,1)] [--k2:clamp(0,(var(--p)-.43)*40,1)] [--k3:clamp(0,(var(--p)-.46)*40,1)] [--k4:clamp(0,(var(--p)-.49)*40,1)] [--mc:clamp(0,(var(--p)-.13)*30,1)] [--mr:clamp(0,(var(--p)-.085)*25,1)] [--nw:calc(clamp(0,(var(--p)-.69)*20,1)*(1-clamp(0,(var(--p)-.83)*20,1)))] [--pl:clamp(0,var(--p)/.1,1)] [--s1:clamp(0,(var(--p)-.215)*40,1)] [--s2:clamp(0,(var(--p)-.24)*40,1)] [--s3:clamp(0,(var(--p)-.265)*40,1)] [--s4:clamp(0,(var(--p)-.29)*40,1)] [--s5:clamp(0,(var(--p)-.315)*40,1)] [--ty:clamp(0,(var(--p)-.56)/.08,1)]">
				{/* The day's light through the window: high and cool in the morning, long and warm by late afternoon, gone at dusk. */}
				<div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden dark:hidden">
					<div className="absolute inset-0 opacity-[calc(1-clamp(0,(var(--p)-.8)/.14,1))] [background:radial-gradient(55%_60%_at_calc(84%-var(--p)*34%)_calc(8%+var(--p)*46%),color-mix(in_oklch,oklch(0.96_0.025_235/.7),oklch(0.92_0.1_68/.75)_calc(clamp(0,(var(--p)-.2)/.5,1)*100%)),transparent_70%)]" />
					<div className="window-shadow absolute start-[28%] -top-[20%] h-[140%] w-[78%] [transform:skewX(calc(-6deg-var(--p)*30deg))_rotate(calc(-3deg-var(--p)*9deg))_translateX(calc(var(--p)*-12vw))]! opacity-[calc(1-clamp(0,(var(--p)-.78)/.14,1))]" />
					<div className="absolute inset-0 bg-[linear-gradient(to_bottom,oklch(0.6_0.06_280/.12),transparent_70%)] opacity-[clamp(0,(var(--p)-.8)/.14,1)]" />
				</div>

				<h2
					id="prepare-title"
					className="font-anybody absolute start-(--gutter) top-[10vh] text-[16vw] leading-[.9] font-light tracking-[-.03em] whitespace-nowrap text-ink min-[900px]:top-[11vh] min-[900px]:text-[clamp(72px,9vw,160px)]"
				>
					{prepare}
					<span className="text-accent">.</span>
				</h2>

				{/* Below 900px the clock sits small beside the headline; above, it fills the column under it with its marks. */}
				<div className="absolute end-(--gutter) top-[calc(10vh+1vw)] [transition:transform_.5s_var(--ease)] min-[900px]:start-[calc(var(--gutter)+44px)] min-[900px]:end-auto min-[900px]:top-[calc(11vh+clamp(72px,9vw,160px)+6vh)] min-[900px]:[transform:translateX(calc(var(--dir)*var(--nw)*8vw))_scale(calc(1+var(--nw)*.06))]">
					<div className="relative size-[72px] [transform:scale(calc(.94+var(--in)*.06))_rotate(calc((1-var(--in))*-8deg))] opacity-(--in) [transition:transform_.5s_var(--ease)] min-[900px]:size-[min(17vw,30vh)]">
						<Clock />
						{dialMarks.map((mark) => (
							<span
								key={mark.step}
								aria-hidden="true"
								className={cn(
									"font-martian absolute hidden -translate-x-1/2 -translate-y-1/2 text-xs font-medium whitespace-nowrap transition-colors duration-300 min-[900px]:block",
									mark.step === step ? "text-accent-text" : mark.step < step ? "text-ink-3" : "text-ink-3/60",
								)}
								style={{ left: `${50 + mark.x * 66}%`, top: `${50 + mark.y * 62}%` }}
							>
								{dialLabels[mark.step]}
							</span>
						))}
					</div>
					<div className="mt-12 hidden min-[900px]:block">
						<ClockReadout step={step} />
					</div>
				</div>

				<div className="absolute start-(--gutter) top-[calc(10vh+16vw+12px)] min-[900px]:hidden">
					<ClockReadout step={step} />
				</div>

				<SceneCaption
					number="06"
					title={prepare}
					className="min-[900px]:short:hidden absolute start-(--gutter) bottom-[clamp(20px,5vh,44px)] hidden max-w-[min(25em,30vw)] opacity-(--in) min-[900px]:flex"
				>
					{t`Get a plan for the interview, built from the posting and your own stories. Practice out loud, then write down how it went.`}
				</SceneCaption>

				{/* The application's folder. Its sheets share one cell; the one in front is the tab in front. */}
				<div className="@container absolute inset-x-(--gutter) top-[calc(10vh+16vw+44px)] bottom-[3vh] flex [transform:translateY(calc((1-var(--in))*12vh+var(--nw)*3vh))_scale(calc(1-var(--nw)*.03))] flex-col font-ui text-[13px] leading-[1.45] opacity-[calc((1-var(--nw))*clamp(0,var(--p)*20,1))] [transition:transform_.5s_var(--ease)] min-[900px]:start-auto min-[900px]:end-[4vw] min-[900px]:top-[14vh] min-[900px]:bottom-auto min-[900px]:h-[min(600px,74vh)] min-[900px]:w-[min(54vw,820px)] min-[900px]:text-[clamp(13px,1.06vw,16px)]">
					<div className="relative z-1 -mb-px flex shrink-0 items-end">
						<div
							ref={tabsRef}
							role="group"
							aria-label={t`Application tabs`}
							className={cn(
								"flex min-w-0 flex-1 [scrollbar-width:none] items-end gap-[.25em] overflow-x-auto [mask-image:linear-gradient(to_right,transparent,#000_1em,#000_calc(100%-1em),transparent)] ps-[1.2em] pe-[1.2em]",
								!active && "pointer-events-none",
							)}
						>
							{tabs.map((tab) => {
								const front = tab.step === frontStep;
								const content = (
									<>
										{tab.label}
										{tab.badge && (
											<span className="rounded-sm bg-[oklch(0.42_0.1_150)] px-[.5em] py-[.15em] text-[.92em] leading-none text-white tabular-nums">
												{tab.badge}
											</span>
										)}
									</>
								);
								const tabClass = cn(
									"font-martian flex h-[2.6em] shrink-0 items-center gap-[.5em] rounded-t-sm px-[1em] text-[.74em] font-medium whitespace-nowrap transition-[transform,background-color,color] duration-300",
									front
										? "bg-[oklch(0.87_0.05_80)] text-[oklch(0.25_0.03_70)] dark:bg-[oklch(0.62_0.045_78)] dark:text-[oklch(0.16_0.02_70)]"
										: "translate-y-[.4em] bg-[oklch(0.8_0.05_74)] text-[oklch(0.38_0.03_70)] dark:bg-[oklch(0.5_0.04_72)] dark:text-[oklch(0.14_0.02_70)]",
								);
								return tab.step === undefined ? (
									<span key={tab.label} aria-hidden="true" className={tabClass}>
										{content}
									</span>
								) : (
									<button
										key={tab.label}
										type="button"
										data-front={front || undefined}
										tabIndex={active ? 0 : -1}
										aria-current={front ? "step" : undefined}
										onClick={() =>
											reducedMotion
												? setChosen(tab.step as number)
												: goToScene(SCENE.prepare, TAB_AT[tab.step as number] ?? 0)
										}
										className={cn(tabClass, !front && "hover:translate-y-[.15em]")}
									>
										{content}
									</button>
								);
							})}
						</div>
						{/* The folder's label: the same Fieldnote role Tailor applied to, its stage moving on when the change is applied. */}
						<span className="me-[.6em] mb-[.45em] hidden shrink-0 -rotate-1 items-center gap-[.5em] rounded-sm bg-paper py-[.3em] ps-[.35em] pe-[.7em] text-[.8em] font-medium text-[oklch(0.3_0.01_95)] shadow-e1 @min-[640px]:flex">
							<span className="font-anybody grid size-[1.6em] place-items-center rounded-sm bg-[oklch(0.22_0.01_95)] text-[1.05em] leading-none text-white">
								F
							</span>
							{t`Fieldnote`}
							<span className="grid">
								<span className="col-start-1 row-start-1 flex items-center gap-[.35em] opacity-[calc(1-var(--mc))]">
									<span className="size-[.5em] rounded-sm bg-stage-applied" />
									{t`Applied`}
								</span>
								<span className="col-start-1 row-start-1 flex items-center gap-[.35em] opacity-(--mc)">
									<span className="size-[.5em] rounded-sm bg-stage-interview" />
									{t`Interview`}
								</span>
							</span>
						</span>
					</div>

					<div className="grid min-h-0 flex-1 overflow-hidden rounded-lg bg-[linear-gradient(165deg,oklch(0.87_0.05_80),oklch(0.81_0.055_72))] p-[clamp(10px,1.6vw,22px)] shadow-paper dark:bg-[linear-gradient(165deg,oklch(0.62_0.045_78),oklch(0.55_0.05_70))]">
						{panels.map(([panelStep, entry, rotation, panel]) => (
							<div
								key={panelStep}
								inert={panelStep !== step}
								className="col-start-1 row-start-1 min-h-0 [transform:translateY(calc((1-var(--e))*112%))_rotate(var(--r))] [transition:transform_.35s_var(--ease)]"
								style={
									{
										"--e": reducedMotion ? Number(panelStep <= step) : entry,
										"--r": rotation,
									} as CSSProperties
								}
							>
								{panel}
							</div>
						))}
					</div>
				</div>

				{/* The paper plane from Share, coming back with the reply and landing on the Messages tab. */}
				<Doodle
					name="plane"
					wipe="1"
					sizes="9vw"
					className="end-[21vw] top-[6vh] z-4 w-[9vw] [transform:translate(calc(var(--dir)*(1-var(--pl))*30vw),calc((1-var(--pl))*-30vh))_scaleX(calc(var(--dir)*-1))_rotate(calc(-18deg+var(--pl)*14deg))] opacity-[calc(.8*(1-clamp(0,(var(--p)-.12)*12,1)))]! [transition:transform_.4s_var(--ease)] max-[900px]:hidden"
				/>

				{/* The interview: the folder is put away and the line sits on the empty desk beside the clock. */}
				<div
					aria-hidden={step !== STEP.interview}
					className="pointer-events-none absolute inset-x-(--gutter) top-[calc(10vh+16vw+44px)] bottom-[3vh] flex flex-col items-center justify-center gap-4 text-center opacity-(--nw) min-[900px]:start-auto min-[900px]:end-[4vw] min-[900px]:top-[14vh] min-[900px]:bottom-auto min-[900px]:h-[min(600px,74vh)] min-[900px]:w-[min(54vw,820px)]"
				>
					<p className="[transform:scale(calc(.94+var(--nw)*.06))] font-display text-[clamp(44px,6vw,108px)] leading-none tracking-[-.02em] text-accent-text italic">
						{t`Deep breath.`}
					</p>
					<p className={cn(labelClass, "text-ink-3")}>{t`${time} · Video call · 45 min`}</p>
				</div>
			</div>
		</section>
	);
}
