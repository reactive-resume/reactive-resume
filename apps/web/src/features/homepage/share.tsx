import type { IconName } from "@reactive-resume/ui/components/icon";
import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { cn } from "@reactive-resume/utils/style";
import { SCENE, useLanding } from "./scroll";
import { Sheet } from "./sheet";
import { Doodle, labelClass, TypedText } from "./ui";

const ADDRESS = "rxresu.me/alex-morgan";
const SLUG_START = ADDRESS.indexOf("/") + 1;

/**
 * Colours that go from the day palette to the night sky's as --nt rises, so the text keeps its contrast however far
 * the night has faded in (and, under reduced motion, the scene rests at night).
 */
const byNight = (day: string, night: string) => `color-mix(in oklch, ${day}, ${night} calc(var(--nt) * 100%))`;
const nightPalette = {
	"--night-ink": byNight("var(--ink)", "oklch(0.95 0.01 95)"),
	"--night-ink-2": byNight("var(--ink-2)", "oklch(0.9 0.01 95)"),
	"--night-on-ink": byNight("var(--bg)", "oklch(0.18 0.02 265)"),
	"--night-accent": byNight("var(--accent-text)", "oklch(0.8 0.13 150)"),
	"--night-label": byNight("var(--accent-text)", "oklch(0.75 0.09 150)"),
	"--night-chip": byNight("var(--ink-2)", "oklch(0.9 0.05 150)"),
	"--night-chip-line": byNight("var(--line-2)", "oklch(0.8 0.12 150)"),
	"--night-line": byNight("var(--line)", "oklch(1 0 0 / .14)"),
	"--night-fill": byNight("var(--hover)", "oklch(1 0 0 / .08)"),
} as CSSProperties;

/** 46 stars, seeded so the server and the browser draw the same sky. */
const stars = (() => {
	let seed = 7;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	return Array.from({ length: 46 }, () => ({
		left: `${(random() * 100).toFixed(2)}%`,
		top: `${(random() * 100).toFixed(2)}%`,
		size: `${(1 + random() * 1.8).toFixed(1)}px`,
		opacity: Number((0.25 + random() * 0.6).toFixed(2)),
	}));
})();

const visibilityIcons: IconName[] = ["public", "lock", "visibility_off"];

/**
 * 05 Share, the night scene. The page flies off to the top corner on a green trail, the resume's address types out,
 * and the visibility and copy controls and the export formats appear.
 */
export function Share() {
	const active = useLanding((state) => state.activeScene === SCENE.share);
	const ready = useLanding((state) => state.shareReady);
	const [visibility, setVisibility] = useState(0);
	const [copied, setCopied] = useState(false);
	const copiedTimer = useRef(0);
	const share = t`Share`;
	const isPrivate = visibility === 2;

	useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

	const copy = () => {
		setCopied(true);
		window.clearTimeout(copiedTimer.current);
		copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
	};

	const formats = [
		{ icon: "picture_as_pdf", label: "PDF" },
		{ icon: "description", label: t`Word` },
		{ icon: "data_object", label: "JSON" },
	] as const;

	return (
		<section
			id="share"
			data-scene={SCENE.share}
			data-pin
			aria-labelledby="share-title"
			className="relative h-[240vh] motion-reduce:h-svh min-[900px]:h-[300vh]"
		>
			<div
				className="sticky top-0 h-svh overflow-hidden [--f1:clamp(0,(var(--p)-.62)*14,1)] [--f2:clamp(0,(var(--p)-.68)*14,1)] [--f3:clamp(0,(var(--p)-.74)*14,1)] [--fl:clamp(0,(var(--p)-.1)/.34,1)] [--nt:calc(clamp(0,var(--p)*7,1)*(1-clamp(0,(var(--p)-.9)*12,1)))] [--pw:min(40vw,26vh)] [--tu:clamp(0,(var(--p)-.34)/.22,1)] [--ui:clamp(0,(var(--p)-.58)*8,1)] motion-reduce:[--nt:1] min-[900px]:[--pw:min(22vw,42vh)]"
				style={nightPalette}
			>
				<div
					aria-hidden="true"
					className="absolute inset-0 bg-[radial-gradient(120%_90%_at_70%_0%,oklch(0.24_0.03_265),oklch(0.15_0.02_265)_60%)] opacity-(--nt)"
				/>
				<div aria-hidden="true" className="absolute inset-0 [transform:translateY(calc(var(--p)*-8vh))] opacity-(--nt)">
					{stars.map((star) => (
						<span
							key={`${star.left}${star.top}`}
							className="absolute size-(--size) rounded-full bg-[oklch(0.95_0.02_95)]"
							style={{ left: star.left, top: star.top, opacity: star.opacity, "--size": star.size } as CSSProperties}
						/>
					))}
				</div>

				<Doodle
					name="plane"
					wipe="clamp(0, (var(--p) - .12) / .2, 1)"
					className="start-[7vw] top-[max(13vh,120px)] w-[14vw] translate-y-[calc(var(--p)*-30px)] rotate-[-8deg] opacity-[calc(var(--nt)*.6)]! [filter:invert(1)]!"
				/>

				<svg
					aria-hidden="true"
					viewBox="0 0 100 100"
					preserveAspectRatio="none"
					className="absolute inset-0 size-full opacity-[calc(var(--nt)*.7)] rtl:-scale-x-100"
				>
					<path
						d="M50 50 Q73 50 96 -20"
						pathLength={1}
						fill="none"
						stroke="oklch(0.8 0.12 150)"
						// Not non-scaling: that measures the dash in screen pixels, which breaks the pathLength-based draw.
						strokeWidth={0.1}
						strokeDasharray={1}
						style={{ strokeDashoffset: "calc(1 - var(--fl))" }}
					/>
				</svg>

				<div className="absolute top-1/2 left-1/2 aspect-[612/792] w-(--pw) [transform:translate(-50%,-50%)_translate(calc(var(--dir)*var(--fl)*46vw),calc(var(--fl)*var(--fl)*-70vh))_rotate(calc(var(--dir)*var(--fl)*26deg))_scale(calc(1-var(--fl)*.78))] rounded-[2px] opacity-[calc(1-clamp(0,(var(--fl)-.82)*6,1))] shadow-paper [transition:transform_.35s_var(--ease)]">
					<Sheet />
				</div>

				<div className="absolute inset-x-(--gutter) top-1/2 flex -translate-y-1/2 flex-col items-center gap-[26px] text-center">
					{/* The heading reads "Your resume, live at rxresu.me/…"; this label is its visible first half. */}
					<span
						aria-hidden="true"
						className={cn(labelClass, "tracking-[.1em] text-(--night-label) opacity-[clamp(0,var(--tu)*20,1)]")}
					>
						{t`Your resume, live at`}
					</span>
					<h2
						id="share-title"
						dir="ltr"
						className={cn(
							"font-anybody flex flex-wrap items-center justify-center text-[8vw] leading-[1.1] font-light tracking-[-.025em] text-(--night-ink) transition-opacity duration-300 min-[900px]:text-[clamp(34px,4.6vw,88px)]",
							isPrivate && "opacity-40",
						)}
					>
						<span className="sr-only">{t`Your resume, live at`} </span>
						<Icon
							name={visibilityIcons[visibility] ?? "public"}
							className="me-[.2em] text-(--night-accent) opacity-[clamp(0,var(--tu)*20,1)]"
							style={{ fontSize: ".6em" }}
						/>
						<TypedText
							text={ADDRESS}
							progress="--tu"
							rate={60}
							className={cn("[overflow-wrap:anywhere]", isPrivate && "line-through")}
							charStyle={(index) => (index >= SLUG_START ? { color: "var(--night-accent)" } : undefined)}
						/>
						<span
							aria-hidden="true"
							className="ms-[.05em] h-[.82em] w-[.07em] bg-(--night-accent) opacity-[clamp(0,var(--tu)*20,1)]"
						/>
					</h2>

					<div
						inert={!ready}
						className={cn(
							"flex [transform:translateY(calc((1-var(--ui))*16px))] flex-wrap justify-center gap-3 opacity-(--ui)",
							!active && "pointer-events-none",
						)}
					>
						<SegmentedControl
							aria-label={t`Visibility`}
							value={visibility}
							onValueChange={(value) => setVisibility(value as number)}
							className="h-auto rounded-full border border-(--night-line) bg-(--night-fill) p-1"
						>
							{[t`Public`, t`Password`, t`Private`].map((label, index) => (
								<SegmentedControlItem
									key={label}
									value={index}
									className="h-[34px] flex-none rounded-full px-3.5 font-ui text-(--night-ink-2) duration-300 hover:text-(--night-ink) data-checked:bg-(--night-ink) data-checked:text-(--night-on-ink) data-checked:shadow-none"
								>
									<Icon name={visibilityIcons[index] ?? "public"} size={17} />
									{label}
								</SegmentedControlItem>
							))}
						</SegmentedControl>
						<button
							type="button"
							onClick={copy}
							className={cn(
								"flex h-11 items-center gap-1.5 rounded-full px-[18px] font-ui text-sm font-semibold text-(--night-on-ink) transition-colors duration-standard",
								copied ? "bg-(--night-accent)" : "bg-(--night-ink)",
							)}
						>
							<Icon name={copied ? "check" : "link"} size={18} />
							{copied ? t`Copied` : t`Copy link`}
						</button>
					</div>

					<ul className="flex flex-wrap justify-center gap-2.5">
						{formats.map((format, index) => (
							<li
								key={format.icon}
								className="font-martian flex h-9 [transform:translateY(calc((1-var(--f))*10px))] items-center gap-2 rounded-md border border-[color-mix(in_oklch,var(--night-chip-line)_calc(var(--f)*100%),transparent)] px-3.5 text-[11.5px] leading-none font-medium tracking-[.08em] text-(--night-chip) uppercase opacity-(--f)"
								style={{ "--f": `var(--f${index + 1})` } as CSSProperties}
							>
								<Icon name={format.icon} size={18} />
								{format.label}
							</li>
						))}
					</ul>
				</div>

				<div className="absolute start-(--gutter) bottom-[clamp(20px,5vh,44px)] flex max-w-[90vw] flex-col gap-2.5 opacity-[clamp(0,(var(--p)-.2)*6,1)] min-[900px]:max-w-[min(28em,34vw)]">
					<span className={cn(labelClass, "text-(--night-label)")}>05 / {share}</span>
					<p className="min-[900px]:short:hidden font-display text-base leading-[1.45] text-pretty text-(--night-ink) min-[900px]:text-[clamp(17px,1.35vw,20px)]">
						{t`Share a public link, add a password or keep it private. Export to PDF or Word, or take all your data with you as JSON.`}
					</p>
				</div>
			</div>
		</section>
	);
}
