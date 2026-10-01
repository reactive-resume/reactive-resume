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

/** What the Check lens reveals: the page as a parser sees it, fields and sections, flagging the mixed dates. */
function ParsedText() {
	const { i18n } = useLingui();
	const section = (name: string, count?: number) => (
		<span className={field}>
			[section] <span className="uppercase">{name}</span>
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
				<span className="text-[oklch(0.85_0.13_85)]">
					{t`06/2017 – 2021`} ⚠ {t`mixed format`}
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
 * 03 Check. A scan line turns "Check." from display type into monospace while the score climbs and the checklist
 * ticks off. A lens drifts down the page, showing what hiring software reads; with a mouse, it follows the cursor.
 */
export function Check() {
	const { i18n } = useLingui();
	const progress = useLanding((state) => state.checkProgress);
	const sectionRef = useRef<HTMLElement>(null);
	const check = t`Check`;
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
			className="relative h-[260vh] motion-reduce:h-svh min-[900px]:h-[320vh]"
		>
			<div className="sticky top-0 h-svh overflow-hidden [--chk:var(--sp)] [--dw:calc(clamp(0,(var(--sp)-.42)*20,1)*(1-clamp(0,(var(--sp)-.7)*20,1)))] [--lo:clamp(0,(var(--p)-.04)*10,1)] [--pw:48vw] [--sp:clamp(0,(var(--p)-.06)/.8,1)] [--sv:clamp(0,var(--p)/.24,1)] min-[900px]:[--pw:min(28vw,58vh)]">
				<Doodle
					name="magnifier"
					wipe="clamp(0, (var(--p) - .04) / .2, 1)"
					className="start-[46vw] top-[62vh] w-[10vw] translate-y-[calc(var(--p)*-50px)] rotate-[-16deg] max-[900px]:hidden"
				/>

				<h2
					id="check-title"
					className="absolute start-(--gutter) top-[10vh] text-[16vw] leading-[.82] font-normal whitespace-nowrap text-ink min-[900px]:top-[11vh] min-[900px]:text-[clamp(72px,9vw,160px)]"
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

				<div className="absolute start-(--gutter) top-[calc(10vh+18vw)] bottom-[clamp(20px,5vh,44px)] flex w-[40vw] flex-col justify-between gap-6 min-[900px]:top-[calc(11vh+clamp(72px,9vw,160px)*.95+4vh)] min-[900px]:w-[min(34em,36vw)]">
					<div className="flex flex-col gap-3.5">
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
										name={item.done ? "check_circle" : item.warning ? "error" : "radio_button_unchecked"}
										className={cn(
											"transition-colors duration-300",
											item.done ? "text-accent" : item.warning ? "text-[oklch(0.72_0.14_80)]" : "text-line-2",
										)}
									/>
									{item.label}
								</li>
							))}
						</ul>
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
								<Icon name="arrow_forward" size={19} />
							</Link>
						}
					>
						{t`Check reads your resume the way hiring software does and explains what to fix in plain words. It runs in your browser, so the file stays with you.`}
					</SceneCaption>
				</div>

				<div
					onPointerMove={moveLens}
					onPointerLeave={releaseLens}
					className="@container absolute end-[5vw] top-[60%] aspect-[612/792] w-(--pw) [transform:translateY(-50%)_rotate(1deg)] cursor-crosshair rounded-[2px] shadow-paper min-[900px]:end-[10vw] min-[900px]:top-[52%]"
				>
					<Sheet />
					<div
						aria-hidden="true"
						className="check-lens font-martian absolute inset-0 flex flex-col gap-[2.4cqw] overflow-hidden rounded-[2px] p-[8cqw] text-[1.55cqw] leading-[1.75] text-[oklch(0.88_0.09_150)] opacity-(--lo)"
					>
						<ParsedText />
					</div>
					<div
						aria-hidden="true"
						className="pointer-events-none absolute top-[var(--ly,16%)] left-[var(--lx,50%)] aspect-square w-[32cqw] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[oklch(0.62_0.13_150)] opacity-(--lo) shadow-[inset_0_0_0_1px_oklch(1_0_0/.35),0_20px_50px_-12px_oklch(0_0_0/.5)]"
					>
						<span className="font-martian absolute -top-2.5 left-1/2 -translate-x-1/2 -translate-y-full rounded-full bg-[oklch(0.2_0.03_160)] px-[9px] py-[5px] text-[10px] leading-none font-medium tracking-[.08em] whitespace-nowrap text-[oklch(0.88_0.09_150)] uppercase">
							{t`What software reads`}
						</span>
					</div>
				</div>
			</div>
		</section>
	);
}
