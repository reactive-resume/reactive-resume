import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { prefersReducedMotion, SCENE } from "./scroll";
import { Sheet } from "./sheet";
import { CtaLink, Doodle } from "./ui";
import { authClient } from "@/libs/auth/client";
import { sessionQueryKey } from "@/libs/root-context";

const fragmentKind = {
	display: "font-anybody leading-none",
	serif: "font-display leading-none",
	mono: "font-martian text-[12px] leading-none",
	pill: "rounded-sm px-3.5 py-[9px] font-semibold font-ui text-[15px] leading-none",
};

// The field is dimmed to 78%, so the light pills take a deeper green to keep their text at 4.5:1.
const pillAccent = "bg-accent-soft text-[oklch(0.36_0.1_150)] dark:text-accent-text";

/** The four lines of the headline; the footer repeats them. Lines 2 and 4 are highlighted. */
export const getHeadline = () =>
	[
		t({
			message: "A free, open-source",
			comment: "Hero headline, line 1 of 4: A free, open-source / resume builder / and / career manager.",
		}),
		t({
			message: "resume builder",
			comment:
				"Hero headline, line 2 of 4: A free, open-source / resume builder / and / career manager. Lines 2 and 4 are highlighted: keep each a complete phrase.",
		}),
		t({
			message: "and",
			context: "hero headline",
			comment: "Hero headline, line 3 of 4: A free, open-source / resume builder / and / career manager.",
		}),
		t({
			message: "career manager.",
			comment:
				"Hero headline, line 4 of 4: A free, open-source / resume builder / and / career manager. Lines 2 and 4 are highlighted: keep each a complete phrase.",
		}),
	] as const;

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

	const headline = getHeadline();

	return (
		<section
			ref={ref}
			id="top"
			data-scene={SCENE.hero}
			data-pin
			aria-labelledby="hero-title"
			className="relative h-[170vh] min-[900px]:h-[220vh]"
		>
			{/* --pt is the page's centre. Below 900px it sits under the stacked headline (128px + three 10vw lines). */}
			<div className="min-[900px]:short:[--pw:min(24vw,40vh)] sticky top-0 h-svh overflow-clip [--e2:clamp(0,(var(--p)-.16)/.6,1)] [--e:clamp(0,(var(--p)-.03)/.5,1)] [--pt:calc(144px+30vw+var(--pw)*.647)] [--pw:min(46vw,30vh)] motion-reduce:[--ld:1] min-[900px]:[--pt:50%] min-[900px]:[--pw:min(24vw,46vh)]">
				<svg aria-hidden="true" width="0" height="0" className="absolute">
					<filter id="landing-pencil" x="-5%" y="-5%" width="110%" height="110%">
						<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={4} />
						<feDisplacementMap in="SourceGraphic" scale={3.5} />
					</filter>
				</svg>

				{/* Construction guides, drawn in pencil around where the page will land. */}
				<div
					aria-hidden="true"
					className="text-graphite pointer-events-none absolute inset-0 min-[900px]:[filter:url(#landing-pencil)]"
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
					sizes="12vw"
					className="start-[74vw] top-[max(15vh,110px)] w-[12vw] [transform:translate(calc(var(--mx,0)*-22px),calc(var(--my,0)*-14px))_rotate(calc(-22deg+var(--mx,0)*3deg))_translateY(calc(var(--p)*-20px))] [transition:mask-position_1.8s_var(--ease)_.9s,transform_.9s_var(--ease)]"
				/>
				<Doodle
					name="paperclip"
					eager
					wipe="var(--ld, 0)"
					sizes="(min-width: 900px) 6vw, 1px"
					className="start-[4vw] top-[61%] w-[6vw] [transform:translate(calc(var(--mx,0)*22px),calc(var(--my,0)*16px))_rotate(calc(16deg+var(--mx,0)*-4deg))_translateY(calc(var(--p)*-30px))] [transition:mask-position_1.4s_var(--ease)_1.3s,transform_1.1s_var(--ease)] max-[900px]:hidden"
				/>

				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,transparent_0,transparent_120px,#000_200px,#000_calc(100%-250px),transparent_calc(100%-170px))] opacity-78 max-[900px]:[mask-image:linear-gradient(to_bottom,transparent_0,transparent_260px,#000_330px,#000_calc(100%-250px),transparent_calc(100%-170px))]"
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

				<div className="hero-page absolute top-(--pt) left-1/2 aspect-[612/792] w-(--pw) rounded-sm shadow-paper">
					<Sheet />
				</div>

				<h1
					id="hero-title"
					className="absolute inset-x-(--gutter) top-32 font-display text-[8vw] leading-[1.05] font-light text-ink min-[900px]:sr-only"
				>
					{headline[0]} <br className="min-[900px]:hidden" />
					<em className="text-accent-text">{headline[1]}</em> <br className="min-[900px]:hidden" />
					{headline[2]} <em className="text-accent-text">{headline[3]}</em>
				</h1>

				{/* The headline, drawn as two halves either side of the page (below 900px, stacked above it). Both halves share one
				    size; a translation too long for its side wraps instead of running off screen. */}
				<div
					aria-hidden="true"
					className="hero-headline-start absolute end-[calc(50%+var(--pw)/2+2.6vw)] top-1/2 hidden max-w-[calc(50vw-var(--pw)/2-2.6vw-var(--gutter))] text-end text-[3.4vw] leading-none text-balance text-ink min-[900px]:block"
				>
					<span className="font-anybody block font-light tracking-[-.025em] [font-stretch:calc(112%-var(--e)*12%)]">
						{headline[0]}
					</span>
					<span className="block font-display tracking-[-.02em] text-accent-text italic">{headline[1]}</span>
				</div>
				<div
					aria-hidden="true"
					className="absolute start-[calc(50%+var(--pw)/2+2.6vw)] top-1/2 hidden max-w-[calc(50vw-var(--pw)/2-2.6vw-var(--gutter))] [transform:translate(calc(var(--dir)*(1-var(--e))*6vw),-50%)] text-[3.4vw] leading-none text-balance opacity-[clamp(0,(var(--e)-.5)*3,1)] [transition:transform_.45s_var(--ease)] min-[900px]:block"
				>
					<span className="font-anybody block tracking-[-.025em] text-ink">{headline[2]}</span>
					<span className="block font-display tracking-[-.02em] text-accent-text italic">{headline[3]}</span>
				</div>

				<div className="absolute inset-x-(--gutter) bottom-[clamp(20px,4vh,40px)] z-2 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
					<p className="max-w-full font-display text-base leading-[1.45] text-pretty text-ink-2 min-[900px]:max-w-[min(25em,calc(50vw-var(--pw)/2-5vw))] min-[900px]:text-[clamp(17px,1.3vw,20px)]">
						{t`Build a professional resume, download it as PDF or Word, and manage your job search in one place. Free templates, no ads, no paywall.`}
					</p>
					<div className="flex flex-col items-end gap-2">
						<CtaLink size="hero" />
						<GuestLink />
					</div>
				</div>
			</div>
		</section>
	);
}

/**
 * "Try it without an account", under the hero's call to action, where the server allows guests: a guest session opens
 * Documents, and signing up later keeps the work.
 */
function GuestLink() {
	const { flags, session } = useRouteContext({ strict: false });
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [pending, setPending] = useState(false);
	if (!flags?.allowGuestLogin || session) return null;

	const start = async () => {
		setPending(true);
		const { error } = await authClient.signIn.anonymous();
		if (error) {
			setPending(false);
			toast.add({ type: "error", description: error.message || t`Couldn't continue as a guest. Try again.` });
			return;
		}
		await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
		void navigate({ to: "/dashboard" });
	};

	return (
		<button
			type="button"
			disabled={pending}
			onClick={() => void start()}
			className="font-ui text-sm text-ink-2 underline underline-offset-3 transition-colors hover:text-ink disabled:opacity-60"
		>
			<Trans>Try it without an account</Trans>
		</button>
	);
}
