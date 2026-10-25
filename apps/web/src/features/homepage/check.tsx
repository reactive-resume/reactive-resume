import type { PointerEvent } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { prefersReducedMotion, SCENE, useLanding } from "./scroll";
import { designSystemBullet, ProfileSummary, Sheet } from "./sheet";
import { Doodle, labelClass, SceneCaption } from "./ui";

const field = "text-[oklch(0.62_0.08_150)]";

/**
 * What the Check lens reveals: the page as a parser sees it, fields and sections, flagging the mixed dates until the
 * fix lands. The date line is where the lens comes to rest (`data-park`).
 */
function ParsedText({ fixed }: { fixed: boolean }) {
	const { i18n } = useLingui();
	const section = (name: string, count?: number) => (
		<span className={field}>
			[section] <span className="">{name}</span>
			{count !== undefined && ` · ${i18n.number(count)}`}
		</span>
	);

	return (
		<>
			<div>
				<span className={field}>name</span> <span className="text-[2.6cqw]">{t`Alex Morgan`}</span>
				<br />
				<span className={field}>title</span> {t`Senior Product Designer`}
				<br />
				<span className={field}>email</span> alex@morgan.design <span className={field}>loc</span> {t`Lisbon, Portugal`}{" "}
				<span className={field}>url</span> morgan.design
			</div>
			<div>
				{section(t`Profile`)}
				<br />
				<ProfileSummary />
			</div>
			<div>
				{section(t`Experience`, 2)}
				<br />
				<span className={field}>role</span> {t`Lead Product Designer`} <span className={field}>org</span>{" "}
				{t`Northwind Labs`}
				<br />
				<span className={field}>dates</span> {t`2021 – Present`}
				<span className="block truncate">· {designSystemBullet()}</span>
				<span className={field}>role</span> {t`Product Designer`} <span className={field}>org</span> {t`Parcel & Co.`}
				<br />
				<span className={field}>dates</span>{" "}
				<span data-park className={fixed ? "text-[oklch(0.86_0.12_150)]" : "text-[oklch(0.85_0.13_85)]"}>
					{fixed ? `${t`2017 – 2021`} ✓ ${t`one format`}` : `${t`06/2017 – 2021`} ⚠ ${t`mixed format`}`}
				</span>
			</div>
			<div>
				{section(t`Education`, 1)}
				<br />
				{t`BA, Communication Design`} · {t`University of Porto`} · {t`2013 – 2017`}
			</div>
			<div>
				{section(t`Skills`, 6)}
				<br />
				<span className="lowercase">
					{[t`Design systems`, t`User research`, t`Accessibility`, t`Prototyping`, t`Figma, HTML and CSS`].join(", ")}
				</span>
			</div>
			<div>
				{section(t`Languages`, 3)}
				<br />
				<span className="lowercase">{[t`English (native)`, t`Portuguese (native)`, t`Spanish (B2)`].join(", ")}</span>
			</div>
		</>
	);
}

/**
 * The score and the checklist. They follow the scan in 40 steps, so they subscribe on their own: the rest of the scene,
 * the demo page included, doesn't re-render as the score climbs.
 */
function ScanResult() {
	const { i18n } = useLingui();
	const progress = useLanding((state) => state.checkProgress);
	const score = Math.round(58 + 36 * progress);

	const items = [
		{ label: t`Contact details found`, done: progress > 0.08, warning: false },
		{ label: t`Text is selectable`, done: progress > 0.2, warning: false },
		{ label: t`Standard section headings`, done: progress > 0.36, warning: false },
		{
			label: progress > 0.72 ? t`Dates use one format` : t`Two date formats found`,
			done: progress > 0.72,
			warning: progress > 0.42,
		},
	];

	return (
		<>
			<span className={cn(labelClass, "text-ink-3")}>{t`ATS readability`}</span>
			<p className="flex items-baseline gap-2.5">
				<span className="font-anybody text-[48px] leading-[.9] font-light tracking-[-.03em] text-ink tabular-nums min-[900px]:text-[clamp(52px,5vw,92px)]">
					{i18n.number(score)}
				</span>
				<span className="font-martian text-[13px] text-ink-3">/ {i18n.number(100)}</span>
			</p>
			<ul className="flex flex-col gap-2 font-ui text-sm leading-[1.3] font-medium">
				{items.map((item, index) => (
					<li
						key={index}
						className={cn(
							"flex items-center gap-[9px] transition-colors duration-300",
							item.done || item.warning ? "text-ink" : "text-ink-3",
						)}
					>
						<Icon
							filled
							size={18}
							name={item.done ? "check-circle" : item.warning ? "warning-circle" : "circle"}
							className={cn(
								"transition-colors duration-300",
								item.done ? "text-accent" : item.warning ? "text-[oklch(0.72_0.14_80)]" : "text-line-2",
							)}
						/>
						{item.label}
					</li>
				))}
			</ul>
		</>
	);
}

/** The parsed text under the lens, fixed once the date formats are made consistent. */
function ParsedTextLive() {
	const fixed = useLanding((state) => state.checkProgress > 0.72);
	return <ParsedText fixed={fixed} />;
}

/**
 * 03 Check. A scan line turns "Check." from display type into monospace while the score climbs and the checklist
 * ticks off. A lens drifts down the page, showing what hiring software reads; with a mouse, it follows the cursor.
 */
export function Check() {
	const sectionRef = useRef<HTMLElement>(null);
	const check = t`Check your resume’s ATS readability`;

	// The pointer steers the lens while it's over the page; on leaving, the scroll engine takes it back.
	const moveLens = (event: PointerEvent<HTMLDivElement>) => {
		const section = sectionRef.current;
		if (!section || event.pointerType !== "mouse" || prefersReducedMotion()) return;
		const rect = event.currentTarget.getBoundingClientRect();
		section.dataset.lensHover = "";
		section.style.setProperty("--lx", `${(((event.clientX - rect.left) / rect.width) * 100).toFixed(2)}%`);
		section.style.setProperty("--ly", `${(((event.clientY - rect.top) / rect.height) * 100).toFixed(2)}%`);
	};
	const releaseLens = () => {
		if (sectionRef.current) delete sectionRef.current.dataset.lensHover;
		window.dispatchEvent(new Event("scroll"));
	};

	return (
		<section
			ref={sectionRef}
			id="check"
			data-scene={SCENE.check}
			data-pin
			aria-labelledby="check-title"
			className="relative h-[245vh] motion-reduce:h-svh min-[900px]:h-[295vh]"
		>
			<div className="sticky top-0 h-svh overflow-clip [--chk:var(--sp)] [--dw:calc(clamp(0,(var(--sp)-.42)*20,1)*(1-clamp(0,(var(--sp)-.7)*20,1)))] [--lo:clamp(0,(var(--p)-.04)*10,1)] [--pw:min(62vw,40vh)] [--sp:clamp(0,(var(--p)-.06)/.8,1)] [--sv:clamp(0,var(--p)/.24,1)] min-[900px]:[--pw:min(28vw,58vh)]">
				<h2
					id="check-title"
					className="absolute start-(--gutter) top-[10vh] max-w-[90vw] text-[9vw] leading-[1.05] font-normal text-balance text-ink min-[900px]:top-[11vh] min-[900px]:max-w-[45vw] min-[900px]:text-[clamp(40px,4vw,72px)]"
				>
					<span className="font-anybody block font-light tracking-[-.03em] [clip-path:inset(calc(var(--sv)*120%-20%)_0_-20%_0)]">
						{check}
						<span className="text-accent">.</span>
					</span>
					<span
						aria-hidden="true"
						data-text={`${check}.`}
						className="font-martian absolute start-0 top-0 block font-light tracking-[-.05em] text-accent-text [clip-path:inset(-20%_0_calc((1-var(--sv))*120%)_0)] before:content-[attr(data-text)]"
					/>
					<span
						aria-hidden="true"
						className="absolute inset-x-0 top-[calc(var(--sv)*120%-20%)] h-0.5 bg-accent opacity-[calc(clamp(0,var(--sv)*30,1)*clamp(0,(1-var(--sv))*30,1))] shadow-[0_0_18px_2px_oklch(0.6_0.12_150/.5)]"
					/>
				</h2>

				<div className="absolute inset-x-(--gutter) top-[calc(10vh+24vw)] flex flex-col justify-between gap-6 min-[900px]:end-auto min-[900px]:top-[calc(11vh+clamp(72px,9vw,160px)*.95+4vh)] min-[900px]:bottom-[clamp(20px,5vh,44px)] min-[900px]:w-[min(34em,36vw)]">
					<div className="flex flex-col gap-3.5">
						<ScanResult />
					</div>

					<SceneCaption
						number="03"
						title={check}
						className="min-[900px]:short:hidden hidden min-[900px]:flex"
						action={
							<Link
								to="/ats-checker"
								className="flex items-center gap-1.5 self-start font-ui text-[15px] font-semibold text-accent-text transition-colors hover:text-accent-hover"
							>
								{t`Check any PDF, no account needed`}
								<Icon name="arrow-right" size={19} />
							</Link>
						}
					>
						{t`Check reads your resume the way hiring software does and explains what to fix in plain words. It runs in your browser, so the file stays with you: 0 uploads.`}
					</SceneCaption>
				</div>

				<div
					onPointerMove={moveLens}
					onPointerLeave={releaseLens}
					data-lens-page
					className="@container absolute end-[calc(50%-var(--pw)/2)] bottom-[3vh] aspect-[612/792] w-(--pw) [transform:rotate(1deg)] cursor-crosshair rounded-sm opacity-[clamp(0,var(--p)*20,1)] shadow-paper min-[900px]:end-[10vw] min-[900px]:top-[52%] min-[900px]:bottom-auto min-[900px]:[transform:translateY(-50%)_rotate(1deg)]"
				>
					<Sheet />
					<div
						aria-hidden="true"
						className="check-lens font-martian absolute inset-0 flex flex-col gap-[2.2cqw] overflow-hidden rounded-sm p-[7cqw] text-[2.15cqw] leading-[1.7] text-[oklch(0.9_0.09_150)] opacity-(--lo)"
					>
						<ParsedTextLive />
					</div>
					{/* The magnifier is the lens: its glass sits over the clipped circle and the glass itself is masked out. */}
					<Doodle
						name="magnifier"
						wipe="1"
						className="top-[calc(var(--ly,16%)-15.9cqw)] left-[calc(var(--lx,50%)-17.4cqw)] w-[48.3cqw] max-w-none [mask-image:radial-gradient(circle_11cqw_at_36.1%_32.9%,transparent_97%,#000_100%)]! [mask-size:100%_100%]! [mask-position:0_0]! opacity-(--lo)!"
					/>
					<span
						aria-hidden="true"
						className="font-martian pointer-events-none absolute top-[calc(var(--ly,16%)-14.5cqw)] left-(--lx,50%) -translate-x-1/2 -translate-y-full rounded-sm bg-[oklch(0.2_0.03_160)] px-[9px] py-[5px] text-xs leading-none font-medium whitespace-nowrap text-[oklch(0.88_0.09_150)] opacity-(--lo)"
					>
						{t`What software reads`}
					</span>
				</div>
			</div>
		</section>
	);
}
