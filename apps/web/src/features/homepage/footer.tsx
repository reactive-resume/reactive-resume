import type { CSSProperties, ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { cn } from "@reactive-resume/utils/style";
import { getHeadline } from "./hero";
import { SCENE } from "./scroll";
import { labelClass } from "./ui";
import { useTheme } from "@/features/theme/provider";

const githubUrl = "https://github.com/reactive-resume/reactive-resume";
const licenseUrl = `${githubUrl}/blob/main/LICENSE`;
const linkClass = "text-ink transition-colors hover:text-accent-text";

type FooterLink =
	| { label: string; href: string }
	| { label: string; to: "/ats-checker" | "/auth/register" | "/resume-templates" };

const getColumns = (): { id: string; title: string; links: FooterLink[] }[] => [
	{
		id: "product",
		title: t`Product`,
		links: [
			{ label: t`Templates`, to: "/resume-templates" },
			{ label: t`Features`, href: "#write" },
			{ label: t`ATS checker`, to: "/ats-checker" },
			{ label: t`Get started`, to: "/auth/register" },
		],
	},
	{
		id: "resources",
		title: t`Resources`,
		links: [
			{ label: t`About`, href: "https://docs.rxresu.me/getting-started" },
			{ label: t`Documentation`, href: "https://docs.rxresu.me" },
			{ label: t`Changelog`, href: "https://docs.rxresu.me/changelog" },
			{ label: t`Source code`, href: githubUrl },
			{ label: t`Self-hosting`, href: "https://docs.rxresu.me/self-hosting/docker" },
		],
	},
	{
		id: "community",
		title: t`Community`,
		links: [
			{ label: t`Join Discord`, href: "https://discord.gg/jSVSJyWd2k" },
			{ label: t`Subreddit`, href: "https://reddit.com/r/reactiveresume" },
			{ label: t`Translations`, href: "https://crowdin.com/project/reactive-resume" },
			{ label: t`Contact`, href: "mailto:amruth@rxresu.me" },
			{ label: "LinkedIn", href: "https://www.linkedin.com/company/reactive-resume" },
			{ label: "Amruth Pillai · X", href: "https://x.com/KingOKings" },
			{ label: t`Report a bug`, href: `${githubUrl}/issues` },
		],
	},
	{
		id: "legal",
		title: t`Legal`,
		links: [
			{ label: t`Privacy policy`, href: "https://docs.rxresu.me/legal/privacy-policy" },
			{ label: t`MIT License`, href: licenseUrl },
		],
	},
];

function FooterLinkItem({ link }: { link: FooterLink }): ReactNode {
	if ("to" in link) {
		return (
			<Link to={link.to} className={linkClass}>
				{link.label}
			</Link>
		);
	}
	return (
		<a href={link.href} className={linkClass}>
			{link.label}
		</a>
	);
}

/**
 * 13 Footer: the promise once more, the links, then the desk the story was written at. Its objects lead back into
 * the page (the resume to Write, the glasses to Check, the letters to Share, the calendar to Prepare, the window to
 * Remember), and its lamp switches the theme.
 */
export function LandingFooter() {
	const headline = getHeadline();

	return (
		<footer data-scene={SCENE.footer} className="relative overflow-hidden border-t border-line">
			<div className="relative z-1 mx-auto grid max-w-[1440px] gap-x-12 gap-y-14 px-(--gutter) pt-20 min-[1000px]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
				<div className="flex min-w-0 flex-col items-start gap-5">
					<img
						loading="lazy"
						src="/logo/light.svg"
						alt="Reactive Resume"
						width={140}
						height={140}
						className="-ms-[18px] -mt-[22px] -mb-[22px] size-[140px] dark:hidden"
					/>
					<img
						loading="lazy"
						src="/logo/dark.svg"
						alt="Reactive Resume"
						width={140}
						height={140}
						className="-ms-[18px] -mt-[22px] -mb-[22px] hidden size-[140px] dark:block"
					/>
					<p className="font-display text-[clamp(30px,3vw,46px)] leading-[1.06] tracking-[-.01em] text-balance text-ink">
						<span className="block">{headline[0]}</span>
						<em className="block text-accent-text">{headline[1]}</em>
						<span className="block">
							{headline[2]} <em className="text-accent-text">{headline[3]}</em>
						</span>
					</p>
				</div>

				<div className="grid grid-cols-2 gap-x-8 gap-y-10 min-[640px]:grid-cols-4">
					{getColumns().map((column) => (
						<nav
							key={column.id}
							aria-labelledby={`footer-${column.id}`}
							className="flex min-w-0 flex-col gap-2.5 font-ui text-sm"
						>
							<h2 id={`footer-${column.id}`} className={cn(labelClass, "mb-1 text-ink-3")}>
								{column.title}
							</h2>
							<ul className="flex flex-col gap-2.5">
								{column.links.map((link) => (
									<li key={link.label}>
										<FooterLinkItem link={link} />
									</li>
								))}
							</ul>
						</nav>
					))}
				</div>
			</div>

			<div className="relative z-1 mx-auto mt-16 flex max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-(--gutter) font-ui text-[13px] leading-normal text-ink-3">
				{/* Narrow enough to wrap into two balanced lines in any language, without splitting the translation. */}
				<p className="max-w-[20ch] text-balance">{t`By the community, for the community.`}</p>
				<p className="flex flex-wrap items-center gap-x-4 gap-y-1">
					<span>
						<Trans>
							Licensed under{" "}
							<a
								href={licenseUrl}
								className="text-accent-text underline underline-offset-[3px] transition-colors hover:text-accent-hover"
							>
								MIT
							</a>
						</Trans>
					</span>
					<span className="font-mono text-xs">v{__APP_VERSION__}</span>
				</p>
			</div>

			<FooterDesk />
		</footer>
	);
}

type DeskSpot = {
	/** Its box over the drawing, in percent of the drawing's width and height: left, top, width, height. */
	box: [number, number, number, number];
	number: string;
	label: string;
	href: string;
};

const getDeskSpots = (): DeskSpot[] => [
	{ box: [38.2, 71, 18.8, 24], number: "01", label: t`Write`, href: "#write" },
	{ box: [77.6, 72, 10.2, 12], number: "03", label: t`Check`, href: "#check" },
	{ box: [1.2, 60, 18.4, 26], number: "05", label: t`Share`, href: "#share" },
	{ box: [19.8, 56, 9.4, 26], number: "06", label: t`Prepare`, href: "#prepare" },
	{ box: [30.3, 15, 36.9, 53], number: "07", label: t`Remember`, href: "#remember" },
];

const spotStyle = ([left, top, width, height]: DeskSpot["box"]): CSSProperties => ({
	left: `${left}%`,
	top: `${top}%`,
	width: `${width}%`,
	height: `${height}%`,
});

const spotClass = "group/spot absolute rounded-lg outline-none max-[700px]:hidden";
const spotWashClass =
	"absolute inset-0 rounded-lg outline-[1.5px] outline-transparent transition-[background-color,outline-color] duration-standard outline-solid group-hover/spot:bg-[oklch(0.5_0.1_150/0.08)] group-hover/spot:outline-accent group-focus-visible/spot:bg-[oklch(0.5_0.1_150/0.08)] group-focus-visible/spot:outline-accent";
const spotLabelClass =
	"pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 flex -translate-x-1/2 translate-y-1 items-center gap-1.5 rounded-sm bg-ink px-2 py-1 font-ui text-xs font-medium whitespace-nowrap text-bg opacity-0 shadow-e2 transition-[opacity,translate] duration-standard ease-enter group-hover/spot:translate-y-0 group-hover/spot:opacity-100 group-focus-visible/spot:translate-y-0 group-focus-visible/spot:opacity-100";

// Phones crop the 3:1 drawing to a 16:10 box (object-fit: cover), so it renders at 1.875× the viewport width there.
const deskSizes = "(max-width: 699px) 188vw, (min-width: 1800px) 1800px, 100vw";

/**
 * The desk at the end of the page: a resume, letters, a calendar, glasses and a lamp in front of an open window. Day
 * in the light theme, night in the dark one. Each drawing is blended into the page (white vanishes into the light
 * page, black into the dark one), so the desk seems to stand on the footer itself.
 */
function FooterDesk() {
	const { resolvedTheme, toggleTheme } = useTheme();
	const lampLabel = resolvedTheme === "dark" ? t`Switch to light mode` : t`Switch to dark mode`;

	return (
		<div className="footer-desk">
			<div aria-hidden="true" className="footer-dawn" />
			<img
				src="/illustrations/footer-desk-light.webp"
				srcSet="/illustrations/footer-desk-light-1600.webp 1600w, /illustrations/footer-desk-light-2400.webp 2400w, /illustrations/footer-desk-light.webp 3200w"
				sizes={deskSizes}
				alt=""
				width={2172}
				height={724}
				loading="lazy"
				decoding="async"
				draggable={false}
				className="footer-desk-art mix-blend-multiply dark:hidden"
			/>
			<img
				src="/illustrations/footer-desk-dark.webp"
				srcSet="/illustrations/footer-desk-dark-1600.webp 1600w, /illustrations/footer-desk-dark-2400.webp 2400w, /illustrations/footer-desk-dark.webp 3200w"
				sizes={deskSizes}
				alt=""
				width={2172}
				height={724}
				loading="lazy"
				decoding="async"
				draggable={false}
				className="footer-desk-art hidden mix-blend-lighten dark:block"
			/>

			{getDeskSpots().map((spot) => (
				<a key={spot.href} href={spot.href} className={spotClass} style={spotStyle(spot.box)}>
					<span aria-hidden="true" className={spotWashClass} />
					<span className={spotLabelClass}>
						<span aria-hidden="true" className="font-mono text-[10px] opacity-60">
							{spot.number}
						</span>
						{spot.label}
					</span>
				</a>
			))}

			<button
				type="button"
				onClick={() => toggleTheme()}
				aria-label={lampLabel}
				className={spotClass}
				style={spotStyle([88, 30, 10, 51])}
			>
				<span aria-hidden="true" className={spotWashClass} />
				<span aria-hidden="true" className={spotLabelClass}>
					{lampLabel}
				</span>
			</button>
		</div>
	);
}
