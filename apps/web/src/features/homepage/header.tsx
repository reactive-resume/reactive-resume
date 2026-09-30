import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { goToScene, prefersReducedMotion, SCENE, useLanding } from "./scroll";
import { CtaLink } from "./ui";
import { useTheme } from "@/features/theme/provider";
import { orpc } from "@/libs/orpc/client";

const githubUrl = "https://github.com/reactive-resume/reactive-resume";

/** Header ink during Share's night scene, whatever the theme. */
const nightInk = "text-[oklch(0.95_0.01_95)]";

const getStoryScenes = () => [
	{ scene: SCENE.write, label: t`Write` },
	{ scene: SCENE.design, label: t`Design` },
	{ scene: SCENE.check, label: t`Check` },
	{ scene: SCENE.tailor, label: t`Tailor` },
	{ scene: SCENE.share, label: t`Share` },
];

export function LandingHeader() {
	const scrolled = useLanding((state) => state.scrolled);
	const night = useLanding((state) => state.night);
	const activeScene = useLanding((state) => state.activeScene);

	return (
		<header
			className={cn(
				"fixed inset-x-0 top-0 z-70 flex h-16 items-center gap-7 ps-(--gutter) pe-[calc(var(--gutter)+30px)] whitespace-nowrap transition-colors duration-[.4s]",
				night ? nightInk : "text-ink",
			)}
		>
			<div
				aria-hidden="true"
				className={cn(
					"header-taper pointer-events-none absolute inset-x-0 top-0 -z-1 h-28 transition-opacity duration-[.4s]",
					scrolled && !night ? "opacity-100" : "opacity-0",
				)}
			/>

			<a href="#top" className="flex items-center gap-2.5 rounded-md">
				<img
					src="/icon/light.svg"
					alt=""
					width={30}
					height={30}
					className={cn("size-[30px] dark:hidden", night && "hidden")}
				/>
				<img
					src="/icon/dark.svg"
					alt=""
					width={30}
					height={30}
					className={cn("hidden size-[30px] dark:block", night && "block")}
				/>
				{/* The wordmark stays in the DOM for screen readers and crawlers; the logomark is what shows. */}
				<span className="sr-only">Reactive Resume</span>
			</a>

			<nav aria-label={t`Story`} className="mx-auto hidden items-center gap-0.5 min-[1240px]:flex">
				{getStoryScenes().map(({ scene, label }) => {
					const active = activeScene === scene;
					return (
						<button
							key={scene}
							type="button"
							aria-current={active ? "step" : undefined}
							onClick={() => goToScene(scene, 0.04)}
							className={cn(
								"font-martian flex h-[34px] items-center gap-[7px] rounded-full px-[11px] text-[11px] leading-none font-medium tracking-[.08em] uppercase font-stretch-[87.5%] transition-colors duration-300",
								night
									? active
										? nightInk
										: "text-[oklch(0.95_0.01_95/.72)] hover:text-[oklch(0.95_0.01_95)]"
									: active
										? "text-ink"
										: "text-ink-3 hover:text-ink",
							)}
						>
							<span
								aria-hidden="true"
								className={cn("size-1.5 rounded-full transition-colors duration-300", active && "bg-accent")}
							/>
							{label}
						</button>
					);
				})}
			</nav>

			<div className="ms-auto flex items-center gap-2">
				<GithubLink />
				<CtaLink size="header" />
			</div>
		</header>
	);
}

/** The repository's live star count, counted up from zero once it arrives. */
function GithubLink() {
	const { i18n } = useLingui();
	const { data: stars } = useQuery(orpc.statistics.github.getStarCount.queryOptions());
	const countRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const element = countRef.current;
		if (!element || stars == null) return;
		const compact = new Intl.NumberFormat(i18n.locale, { notation: "compact", maximumFractionDigits: 1 });

		if (prefersReducedMotion()) {
			element.textContent = compact.format(stars);
			return;
		}

		let frame = 0;
		const start = performance.now();
		const step = (now: number) => {
			const progress = Math.min(1, (now - start) / 1600);
			element.textContent = compact.format(Math.round(stars * (1 - (1 - progress) ** 3)));
			if (progress < 1) frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	}, [stars, i18n.locale]);

	const count = stars == null ? null : i18n.number(stars);
	const label = count ? t`Star Reactive Resume on GitHub, ${count} stars` : t`Star Reactive Resume on GitHub`;

	return (
		<a
			href={githubUrl}
			aria-label={label}
			className="font-martian hidden h-[38px] items-center gap-2 rounded-md px-2.5 text-[12px] leading-none font-medium font-stretch-[87.5%] tabular-nums transition-colors hover:bg-hover lg:flex"
		>
			<svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
				<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
			</svg>
			<span className="flex items-center gap-1">
				<Icon name="star" filled size={15} className="text-[oklch(0.72_0.14_80)]" />
				<span ref={countRef} className="min-w-[4ch]" />
			</span>
		</a>
	);
}

/**
 * The only theme switch: a pull cord with a line-drawn bulb, hanging at the top corner. It sways every few seconds
 * until it's first pulled, and the bulb lights up in dark mode.
 */
export function ThemeCord() {
	const { resolvedTheme, toggleTheme } = useTheme();
	const night = useLanding((state) => state.night);
	const [pulling, setPulling] = useState(false);
	const [pulledOnce, setPulledOnce] = useState(false);
	const timeout = useRef(0);

	useEffect(() => () => window.clearTimeout(timeout.current), []);

	const pull = () => {
		setPulling(true);
		setPulledOnce(true);
		window.clearTimeout(timeout.current);
		// The theme changes as the cord reaches the bottom of its pull.
		timeout.current = window.setTimeout(() => {
			setPulling(false);
			toggleTheme();
		}, 170);
	};

	const label = resolvedTheme === "dark" ? t`Switch to light mode` : t`Switch to dark mode`;

	return (
		<button
			type="button"
			onClick={pull}
			aria-label={label}
			title={label}
			className={cn(
				"fixed end-[clamp(8px,1.2vw,18px)] top-0 z-72 flex w-[30px] origin-top flex-col items-center [transition:height_.45s_cubic-bezier(.3,1.7,.5,1),color_.4s]",
				pulling ? "h-[124px]" : "h-[92px] hover:h-[112px]",
				!pulledOnce && "motion-safe:animate-swing",
				night ? nightInk : "text-ink",
			)}
		>
			<span aria-hidden="true" className="w-[1.5px] flex-1 bg-current opacity-50" />
			<svg aria-hidden="true" width="30" height="40" viewBox="0 0 30 40" className="flex-none overflow-visible">
				<circle
					cx="15"
					cy="22"
					r="16"
					className="dark:motion-safe:animate-flicker fill-[oklch(0.9_0.14_90)] opacity-0 blur-[6px] transition-opacity duration-500 dark:opacity-35"
				/>
				<rect x="11.5" y="2" width="7" height="6" rx="1.2" fill="currentColor" opacity="0.75" />
				<path d="M11.8 5h6.4M11.8 7h6.4" strokeWidth="0.8" opacity="0.6" className="stroke-bg" />
				<path
					d="M11.5 8 C11.5 12 5 15 5 22 a10 10 0 0 0 20 0 C25 15 18.5 12 18.5 8 Z"
					stroke="currentColor"
					strokeWidth="1.3"
					className="fill-[color-mix(in_oklch,var(--bg)_60%,transparent)] transition-[fill] duration-[.4s] dark:fill-[oklch(0.95_0.11_92)]"
				/>
				<path
					d="M12.5 10 V16 M17.5 10 V16 M12.5 16 c0 3 1 4 1.25 5 c.25-1 .5-2 1.25-2 c.75 0 1 1 1.25 2 c.25-1 1.25-2 1.25-5"
					fill="none"
					strokeWidth="1"
					strokeLinecap="round"
					className="stroke-current opacity-55 dark:stroke-[oklch(0.7_0.16_60)] dark:opacity-100"
				/>
			</svg>
		</button>
	);
}
