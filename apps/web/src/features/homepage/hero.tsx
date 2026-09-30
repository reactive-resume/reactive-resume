import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useEffect, useRef } from "react";
import { cn } from "@reactive-resume/utils/style";
import { prefersReducedMotion, SCENE } from "./scroll";
import { Sheet } from "./sheet";
import { CtaLink, Doodle, labelClass } from "./ui";

const fragmentKind = {
	display: "font-anybody leading-none",
	serif: "font-display leading-none",
	mono: "font-martian text-[12px] uppercase leading-none",
	pill: "rounded-full px-3.5 py-[9px] font-semibold font-ui text-[15px] leading-none",
};

// The field is dimmed to 78%, so the light pills take a deeper green to keep their text at 4.5:1.
const pillAccent = "bg-accent-soft text-[oklch(0.36_0.1_150)] dark:text-accent-text";

/**
 * The eighteen career fragments that converge into the page. Each starts at (x, y), drifts to (tx, ty) and scales
 * down as it lands; z is its depth, for the mouse parallax.
 */
const getFragments = () => [
	{
		text: t`Lead Product Designer`,
		at: ["-30vw", "-28vh", "-6vw", "-14vh", "-4deg", 1, 0.9],
		className: cn(fragmentKind.display, "text-[2.3vw] text-ink-2"),
	},
	{
		text: t`Design systems`,
		at: ["-39vw", "4vh", "-4vw", "2vh", "-8deg", 1.1, 1.2],
		className: cn(fragmentKind.pill, pillAccent),
	},
	{
		text: t`Lisbon`,
		at: ["41vw", "20vh", "6vw", "10vh", "-3deg", 1, 0.5],
		className: cn(fragmentKind.serif, "text-[2.8vw] text-ink-3"),
	},
	{
		text: t`+13 pts activation`,
		at: ["-17vw", "33vh", "-2vw", "12vh", "4deg", 1, 1],
		className: cn(fragmentKind.display, "text-[2.8vw] font-light text-accent-text font-stretch-[92%]"),
	},
	{
		text: t`Figma`,
		at: ["21vw", "37vh", "4vw", "14vh", "10deg", 1.1, 1.3],
		className: cn(fragmentKind.pill, "bg-raised text-ink shadow-e2"),
	},
	{
		text: t`WCAG 2.1 AA`,
		at: ["-44vw", "-12vh", "-7vw", "-4vh", "0deg", 1, 0.3],
		className: cn(fragmentKind.mono, "text-ink-3"),
	},
	{
		text: t`BA, Communication Design`,
		at: ["10vw", "-40vh", "1vw", "-11vh", "-2deg", 1, 0.6],
		className: cn(fragmentKind.serif, "text-[1.5vw] text-ink-2"),
	},
	{
		text: t`University of Porto`,
		at: ["-9vw", "-43vh", "-3vw", "-16vh", "2deg", 1, 0.35],
		className: cn(fragmentKind.mono, "text-ink-3"),
	},
	{
		text: t`Parcel & Co.`,
		at: ["39vw", "3vh", "5vw", "1vh", "-6deg", 1, 0.8],
		className: cn(fragmentKind.display, "text-[1.9vw] text-ink-2 font-stretch-[108%]"),
	},
	{
		text: t`Shipped checkout for iOS`,
		at: ["-27vw", "23vh", "-5vw", "8vh", "3deg", 1, 0.7],
		className: cn(fragmentKind.serif, "text-[1.7vw] text-ink-2 italic"),
	},
	{
		text: t`Prototyping`,
		at: ["6vw", "42vh", "0vw", "16vh", "-5deg", 1.1, 1.1],
		className: cn(fragmentKind.pill, pillAccent),
	},
	{
		text: "alex@morgan.design",
		at: ["25vw", "29vh", "4vw", "9vh", "2deg", 1, 0.4],
		className: cn(fragmentKind.mono, "text-ink-3"),
	},
	{
		text: t`Barista, 2012`,
		at: ["-44vw", "38vh", "-6vw", "15vh", "-7deg", 1, 0.8],
		className: cn(fragmentKind.serif, "text-[2.2vw] text-ink-3 italic"),
	},
	{
		text: t`40% faster reviews`,
		at: ["44vw", "38vh", "6vw", "13vh", "-4deg", 1, 1],
		className: cn(fragmentKind.display, "text-[2.4vw] font-light text-ink-2 font-stretch-[94%]"),
	},
	{
		text: t`Promoted to lead, 2021`,
		at: ["-38vw", "-38vh", "-5vw", "-13vh", "4deg", 1, 0.5],
		className: cn(fragmentKind.serif, "text-[1.7vw] text-ink-2"),
	},
	{
		text: t`Spanish, B2`,
		at: ["-26vw", "43vh", "-3vw", "16vh", "0deg", 1, 0.3],
		className: cn(fragmentKind.mono, "text-ink-3"),
	},
	{
		text: t`Six product teams`,
		at: ["30vw", "45vh", "5vw", "17vh", "-2deg", 1, 0.6],
		className: cn(fragmentKind.display, "text-[1.5vw] text-ink-3 font-stretch-[110%]"),
	},
	{
		text: t`Accessibility`,
		at: ["-13vw", "-33vh", "-2vw", "-10vh", "7deg", 1.1, 1.2],
		className: cn(fragmentKind.pill, pillAccent),
	},
];

/**
 * 00 Hero, "Everything you've done, on one page." Career fragments float in, converge and become a page; the
 * headline splits to either side of it. The paragraph and CTA paint first, with no dependency on the scroll engine.
 */
export function Hero() {
	const { i18n } = useLingui();
	const ref = useRef<HTMLElement>(null);

	// The pencil guides draw in once, shortly after load.
	useEffect(() => {
		const section = ref.current;
		if (!section) return;
		if (prefersReducedMotion()) return void section.style.setProperty("--ld", "1");
		const timer = window.setTimeout(() => section.style.setProperty("--ld", "1"), 120);
		return () => window.clearTimeout(timer);
	}, []);

	const headline = [
		t({ message: "Everything", comment: "Hero headline, line 1 of 4: “Everything / you’ve done, / on one / page.”" }),
		t({ message: "you’ve done,", comment: "Hero headline, line 2 of 4: “Everything / you’ve done, / on one / page.”" }),
		t({ message: "on one", comment: "Hero headline, line 3 of 4: “Everything / you’ve done, / on one / page.”" }),
		t({ message: "page.", comment: "Hero headline, line 4 of 4: “Everything / you’ve done, / on one / page.”" }),
	] as const;

	return (
		<section
			ref={ref}
			id="top"
			data-scene={SCENE.hero}
			data-pin
			aria-labelledby="hero-title"
			className="relative h-[190vh] motion-reduce:h-svh min-[900px]:h-[260vh]"
		>
			{/* --pt is the page's centre. Below 900px it sits under the stacked headline (128px + three 10vw lines). */}
			<div className="min-[900px]:short:[--pw:min(24vw,40vh)] sticky top-0 h-svh overflow-hidden [--e2:clamp(0,(var(--p)-.14)/.36,1)] [--e:clamp(0,(var(--p)-.03)/.36,1)] [--pt:calc(144px+30vw+var(--pw)*.647)] [--pw:min(46vw,30vh)] motion-reduce:[--ld:1] min-[900px]:[--pt:50%] min-[900px]:[--pw:min(24vw,46vh)]">
				<svg aria-hidden="true" width="0" height="0" className="absolute">
					<filter id="landing-pencil" x="-5%" y="-5%" width="110%" height="110%">
						<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={4} />
						<feDisplacementMap in="SourceGraphic" scale={3.5} />
					</filter>
				</svg>

				{/* Construction guides, drawn in pencil around where the page will land. */}
				<div
					aria-hidden="true"
					className="text-graphite pointer-events-none absolute inset-0 [filter:url(#landing-pencil)]"
				>
					<span className="absolute top-[7vh] bottom-[7vh] left-[calc(50%-var(--pw)/2)] w-px [transform:scaleY(var(--ld,0))] bg-current [transition:transform_1.6s_var(--ease)_.2s]" />
					<span className="absolute top-[7vh] bottom-[7vh] left-[calc(50%+var(--pw)/2)] w-px [transform:scaleY(var(--ld,0))] bg-current [transition:transform_1.6s_var(--ease)_.35s]" />
					<span className="absolute inset-x-[3vw] top-[calc(var(--pt)-var(--pw)*.647)] h-px [transform:scaleX(var(--ld,0))] bg-current [transition:transform_1.8s_var(--ease)_.5s]" />
					<span className="absolute inset-x-[3vw] top-[calc(var(--pt)+var(--pw)*.647)] h-px [transform:scaleX(var(--ld,0))] bg-current [transition:transform_1.8s_var(--ease)_.65s]" />
					<span className="absolute top-(--pt) left-1/2 aspect-square w-[calc(var(--pw)*2.1)] [transform:translate(-50%,-50%)_scale(calc(.9+var(--ld,0)*.1))] rounded-full border border-current opacity-[calc(var(--ld,0)*.7)] [transition:opacity_2.4s_ease_1s,transform_2.4s_var(--ease)_1s]" />
				</div>

				{/* Outside the filtered layer: a filter makes the browser count this label as a screen-sized paint. */}
				<span
					aria-hidden="true"
					className="font-martian text-graphite pointer-events-none absolute top-[calc(var(--pt)-var(--pw)*.647-20px)] left-[calc(50%+var(--pw)/2+10px)] text-[10.5px] leading-none tracking-[.06em] opacity-[var(--ld,0)] transition-opacity delay-[1.4s] duration-1000"
				>
					{i18n.number(612)} × {i18n.number(792)}
				</span>

				<Doodle
					name="pencil"
					eager
					wipe="var(--ld, 0)"
					className="start-[74vw] top-[max(15vh,110px)] w-[12vw] [transform:translate(calc(var(--mx,0)*-22px),calc(var(--my,0)*-14px))_rotate(calc(-22deg+var(--mx,0)*3deg))_translateY(calc(var(--p)*-20px))] [transition:mask-position_1.8s_var(--ease)_.9s,transform_.9s_var(--ease)]"
				/>
				<Doodle
					name="paperclip"
					eager
					wipe="var(--ld, 0)"
					className="start-[4vw] top-[61%] w-[6vw] [transform:translate(calc(var(--mx,0)*22px),calc(var(--my,0)*16px))_rotate(calc(16deg+var(--mx,0)*-4deg))_translateY(calc(var(--p)*-30px))] [transition:mask-position_1.4s_var(--ease)_1.3s,transform_1.1s_var(--ease)] max-[900px]:hidden"
				/>

				<p className={cn(labelClass, "absolute inset-x-(--gutter) top-[92px] z-2 text-ink-3")}>
					{t`An open-source resume builder`}
				</p>

				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,transparent_0,transparent_120px,#000_200px,#000_calc(100%-250px),transparent_calc(100%-170px))] opacity-78"
				>
					{getFragments().map(({ text, at: [x, y, tx, ty, r, s, z], className }) => (
						<span
							key={text}
							className={cn("hero-fragment", className)}
							style={{ "--x": x, "--y": y, "--tx": tx, "--ty": ty, "--r": r, "--s": s, "--z": z } as CSSProperties}
						>
							{text}
						</span>
					))}
				</div>

				<div className="hero-page absolute top-(--pt) left-1/2 aspect-[612/792] w-(--pw) rounded-[2px] shadow-paper">
					<Sheet />
				</div>

				<h1 id="hero-title" className="sr-only">
					{t`Everything you’ve done, on one page.`}
				</h1>

				{/* The headline, drawn as two halves either side of the page (below 900px, stacked above it). */}
				<div
					aria-hidden="true"
					className="hero-headline-start absolute end-[calc(50%+var(--pw)/2+2.6vw)] top-1/2 hidden text-end text-[4.4vw] leading-none whitespace-nowrap text-ink min-[900px]:block"
				>
					<span className="font-anybody block font-light tracking-[-.025em] [font-stretch:calc(112%-var(--e)*12%)]">
						{headline[0]}
					</span>
					<span className="font-anybody block font-normal tracking-[-.025em] [font-stretch:calc(90%+var(--e)*10%)]">
						{headline[1]}
					</span>
				</div>
				<div
					aria-hidden="true"
					className="absolute start-[calc(50%+var(--pw)/2+2.6vw)] top-1/2 hidden [transform:translate(calc(var(--dir)*(1-var(--e))*6vw),-50%)] text-[4.4vw] leading-none whitespace-nowrap opacity-[clamp(0,(var(--e)-.5)*3,1)] [transition:transform_.45s_var(--ease)] min-[900px]:block"
				>
					<span className="block font-display tracking-[-.02em] text-accent-text italic">{headline[2]}</span>
					<span className="font-anybody block tracking-[-.025em] text-ink">{headline[3]}</span>
				</div>
				<div
					aria-hidden="true"
					className="absolute inset-x-(--gutter) top-32 text-[10vw] leading-none text-ink min-[900px]:hidden"
				>
					<span className="font-anybody block font-light [font-stretch:calc(110%-var(--e)*10%)]">{headline[0]}</span>
					<span className="font-anybody block font-stretch-[96%]">{headline[1]}</span>
					<span className="block font-display text-accent-text italic opacity-[clamp(0,(var(--e)-.4)*3,1)]">
						{headline[2]} {headline[3]}
					</span>
				</div>

				<div className="absolute inset-x-(--gutter) bottom-[clamp(20px,4vh,40px)] z-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
					<p className="max-w-full font-display text-base leading-[1.45] text-pretty text-ink-2 min-[900px]:max-w-[min(25em,calc(50vw-var(--pw)/2-5vw))] min-[900px]:text-[clamp(17px,1.3vw,20px)]">
						{t`Reactive Resume is a free, open-source resume builder. Write it, design it, check it and tailor it for every job.`}
					</p>
					<CtaLink size="hero" />
				</div>
			</div>
		</section>
	);
}
