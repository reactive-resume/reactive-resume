import type { Template } from "@reactive-resume/schema/templates";
import type { ReactNode } from "react";
import type { SculptureTemplate } from "./resume-sculpture";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ArrowDownIcon, ArrowRightIcon, ArrowUpRightIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useInView } from "motion/react";
import { lazy, Suspense, useRef, useState } from "react";
import { cn } from "@reactive-resume/utils/style";
import { GithubStarsButton } from "@/components/input/github-stars-button";
import { section, sectionHeading, sectionText, sectionTitle, textLink, wrap } from "./classes";
import { CommunityStats } from "./community-stats";
import { FeatureExplorer } from "./feature-explorer";
import LanguagesShowcase from "./languages-showcase";
import { PageBackground } from "./page-background";
import { ResumeSculpture } from "./resume-sculpture";
import { SiteFooter } from "./site-footer";
import { TemplateShelf } from "./template-shelf";
import "./styles.css";

const ExportPlayground = lazy(() => import("./export-playground"));
const AtsPlayground = lazy(() => import("./ats-playground"));
const githubUrl = "https://github.com/reactive-resume/reactive-resume";
const buttonClass =
	"inline-flex min-h-[52px] items-center justify-center gap-3 rounded-[4px] border border-[#f1f0eb] bg-[#f1f0eb] px-[19px] py-[14px] text-[14px] font-[550] text-[#151516] [transition:background-color_150ms_ease,transform_150ms_var(--ease-out-strong)] hover:bg-[#d9d8d2] active:transform-[scale(0.97)] max-[540px]:min-h-[49px] max-[540px]:gap-[18px] max-[540px]:px-[15px] max-[540px]:py-3 max-[540px]:text-[13px]";
const brandClass = "inline-flex shrink-0 items-center gap-[11px] font-[550] tracking-[-0.04em] max-[540px]:gap-2";
const paperLinkClass =
	"group/link flex min-h-[65px] items-center gap-[14px] border-t border-[#2d2e3038] text-[14px] [transition:background-color_160ms_ease] focus-visible:outline-[#37383a]";
const paperArrowClass =
	"ml-auto [transition:transform_180ms_var(--ease-out-strong)] group-hover/link:transform-[translate(2px,-2px)]";
const contributeLinkClass =
	"inline-flex min-h-11 items-center gap-2 text-(--home-ink) underline-offset-4 hover:underline";
type DeferredDemoProps = { children: ReactNode };

function DeferredDemo({ children }: DeferredDemoProps) {
	const ref = useRef<HTMLDivElement>(null);
	const visible = useInView(ref, { once: true, margin: "300px" });
	return (
		<div ref={ref} className="min-h-[460px]">
			{visible && (
				<Suspense
					fallback={
						<p className="py-[140px] text-center text-(--home-muted)">
							<Trans>Loading the playground…</Trans>
						</p>
					}
				>
					{children}
				</Suspense>
			)}
		</div>
	);
}

export function Homepage() {
	const [name, setName] = useState("Alex Morgan");
	const [accent, setAccent] = useState("#735c9a");
	const [typeface, setTypeface] = useState<"sans" | "serif">("sans");
	const [template, setTemplate] = useState<Template>("ditgar");
	const [heroTemplate, setHeroTemplate] = useState<SculptureTemplate>("ditgar");
	return (
		<div className="homepage scheme-dark relative isolate overflow-clip bg-(--home-bg) font-[IBM_Plex_Sans_Variable,IBM_Plex_Sans,sans-serif] text-(--home-ink) text-[16px] leading-[1.5] [--home-accent:#c4a68c] [--home-bg:#101011] [--home-ink:#f1f0eb] [--home-line:#323235] [--home-muted:#a5a5ab] [--home-panel:#19191b] selection:bg-[#d5c2df] selection:text-[#101011]">
			<PageBackground />
			<a
				href="#main-content"
				className="fixed top-3 left-5 z-100 -translate-y-[150%] rounded-[4px] bg-(--home-ink) px-[18px] py-3 text-(--home-bg) focus:translate-y-0"
			>
				<Trans>Skip to main content</Trans>
			</a>
			<header
				className={cn(
					wrap,
					"relative z-1 flex h-[104px] items-center justify-between gap-3 max-[540px]:h-20 max-[900px]:h-[88px]",
				)}
			>
				<Link
					to="/"
					className={`${brandClass} text-[17px] max-[360px]:gap-[6px] max-[360px]:text-[13px] max-[540px]:text-[15px]`}
					aria-label="Reactive Resume"
				>
					<img src="/icon/dark.svg" alt="" width="34" height="34" className="block max-[540px]:size-[29px]" />
				</Link>
				<nav
					className="ml-auto flex gap-[30px] text-(--home-muted) text-[14px] max-[1100px]:gap-5"
					aria-label={t`Main navigation`}
				>
					<a
						href="https://docs.rxresu.me"
						className="inline-flex min-h-[38px] items-center gap-[5px] [transition:color_150ms_ease] hover:text-(--home-ink) max-[900px]:hidden"
					>
						<Trans>Docs</Trans>
					</a>
					<div className="[&>a]:hover:[&_svg:last-child]:transform-[rotate(20deg)_scale(1.15)] [&>a>span]:min-w-[6ch] [&>a>span]:border-s [&>a>span]:border-s-[#3d444d] [&>a>span]:ps-2 [&>a>span]:text-center [&>a>span]:font-semibold max-[540px]:[&>a>span]:min-w-0 max-[540px]:[&>a>span]:ps-[6px] [&>a]:inline-flex [&>a]:min-h-[38px] [&>a]:min-w-[128px] [&>a]:items-center [&>a]:gap-2 [&>a]:rounded-[4px] [&>a]:border [&>a]:border-[#3d444d] [&>a]:bg-[#161b22] [&>a]:px-[11px] [&>a]:py-0 [&>a]:text-[#f0f6fc] [&>a]:text-[13px] [&>a]:tabular-nums [&>a]:shadow-[inset_0_1px_0_#ffffff0d,0_3px_0_#09090966] [&>a]:[transition:background-color_180ms_ease,border-color_180ms_ease,box-shadow_180ms_ease] [&>a]:hover:border-[#6e7681] [&>a]:hover:bg-[#21262d] [&>a]:hover:text-(--home-ink) [&>a]:hover:shadow-[inset_0_1px_0_#ffffff14,0_3px_0_#09090966,0_0_18px_#ffffff08] [&>a]:focus-visible:border-[#3d444d] [&>a]:focus-visible:ring-0 max-[540px]:[&>a]:min-w-24 max-[540px]:[&>a]:gap-[5px] max-[540px]:[&>a]:px-[6px] max-[540px]:[&>a]:text-[11px] [&_svg:last-child]:text-[#f0f6fc] [&_svg:last-child]:[transition:transform_220ms_var(--ease-out-strong)] max-[540px]:[&_svg:not([class*='size-'])]:size-[14px]">
						<GithubStarsButton />
					</div>
				</nav>
			</header>
			<main id="main-content" className="relative z-1">
				<section
					className={cn(
						wrap,
						"grid min-h-[710px] grid-cols-[1fr_1.12fr] items-center gap-[6px] pt-[34px] pb-[62px] max-[1100px]:min-h-[655px] max-[1100px]:grid-cols-[1fr_1.1fr] max-[900px]:grid-cols-1 max-[540px]:gap-[21px] max-[900px]:gap-[30px] max-[540px]:pt-[30px] max-[900px]:pt-10 max-[540px]:pb-8 min-[1500px]:min-h-[750px]",
					)}
					aria-labelledby="hero-title"
				>
					<div className="relative z-1 pb-[22px] max-[900px]:max-w-[590px]">
						<h1
							id="hero-title"
							className="font-[Manrope_Variable,sans-serif] font-semibold text-[clamp(52px,5.85vw,82px)] leading-[1.035] tracking-[-0.064em] max-[1100px]:text-[64px] max-[540px]:text-[clamp(48px,11.65vw,63px)] max-[900px]:text-[clamp(55px,10vw,77px)]"
						>
							<Trans>
								Make yourself <br className="max-[540px]:block max-[900px]:hidden" />
								look good
								<br />
								<span className="text-[#b7b6b8]">on paper.</span>
							</Trans>
						</h1>
						<p className="mt-7 max-w-[356px] text-(--home-muted) text-[17px] leading-[1.65] max-[540px]:mt-6 max-[540px]:max-w-[330px] max-[900px]:max-w-[410px] max-[540px]:text-[15px]">
							<Trans>
								A free, open-source resume builder. Put your experience on the page, without fighting the formatting.
							</Trans>
						</p>
						<div className="mt-[30px] flex flex-wrap items-center gap-9 max-[540px]:mt-[25px] max-[1100px]:gap-7 max-[540px]:gap-7 max-[900px]:gap-9">
							<Link to="/dashboard" className={buttonClass}>
								<Trans>Get Started</Trans>
								<ArrowRightIcon size={20} aria-hidden="true" />
							</Link>
							<a
								href="#templates"
								className={cn(textLink, "max-[540px]:gap-[6px] max-[1100px]:text-[13px] max-[540px]:text-[12px]")}
							>
								<Trans>Explore templates</Trans>
								<ArrowDownIcon size={16} aria-hidden="true" />
							</a>
						</div>
						<p className="mt-[17px] text-[#a5a5ab] text-[12px] leading-[1.9] max-[540px]:mt-[15px] max-[540px]:text-[11px]">
							<Trans>
								<strong className="font-medium text-[#d4d3cf]">Free forever and open source.</strong>
								<br />
								No ads, paywalls, or tracking.
							</Trans>
						</p>
					</div>
					<ResumeSculpture
						template={heroTemplate}
						onTemplateChange={(next) => {
							setHeroTemplate(next);
							setTemplate(next);
						}}
						name={name}
						onNameChange={setName}
						accent={accent}
						onAccentChange={setAccent}
						typeface={typeface}
						onTypefaceChange={setTypeface}
					/>
				</section>
				<CommunityStats />
				<section className={cn(section, "bg-[rgb(23_23_24/55%)]")} id="templates" aria-labelledby="templates-title">
					<div className={wrap}>
						<div className={sectionHeading}>
							<h2 id="templates-title" className={sectionTitle}>
								<Trans>
									Same story.
									<br />A different look.
								</Trans>
							</h2>
							<p className={sectionText}>
								<Trans>
									Fifteen templates, all free. Pick one you like. You can change the type, color, and layout in the
									editor.
								</Trans>
							</p>
						</div>
						<TemplateShelf template={template} onChange={setTemplate} />
					</div>
				</section>
				<section className={cn(section, wrap)} id="playground" aria-labelledby="export-title">
					<div className={sectionHeading}>
						<h2 id="export-title" className={sectionTitle}>
							<Trans>
								Take it
								<br />
								with you.
							</Trans>
						</h2>
						<p className={sectionText}>
							<Trans>
								A PDF for the application. A Word file for a few more edits. Download a sample using your choices.
							</Trans>
						</p>
					</div>
					<DeferredDemo>
						<ExportPlayground name={name} accent={accent} typeface={typeface} template={template} />
					</DeferredDemo>
				</section>
				<section className={cn(section, "bg-[rgb(23_23_24/55%)]")} aria-labelledby="ats-title">
					<div className={wrap}>
						<div className={sectionHeading}>
							<h2 id="ats-title" className={sectionTitle}>
								<Trans>
									See what
									<br />
									software reads.
								</Trans>
							</h2>
							<p className={sectionText}>
								<Trans>
									See whether your PDF has readable text. Read a sample or try your own PDF. Everything runs in your
									browser, so your file stays with you.
								</Trans>
							</p>
						</div>
						<DeferredDemo>
							<AtsPlayground />
						</DeferredDemo>
					</div>
				</section>
				<section className={cn(section, wrap)} id="features" aria-labelledby="features-title">
					<div className={sectionHeading}>
						<h2 id="features-title" className={sectionTitle}>
							<Trans>
								The rest of your
								<br />
								job search, too.
							</Trans>
						</h2>
						<p className={sectionText}>
							<Trans>
								Get a second opinion on your writing, share your resume, and keep track of where you’ve applied. It’s
								all in one place.
							</Trans>
						</p>
					</div>
					<FeatureExplorer />
				</section>
				<LanguagesShowcase />
				<section
					className={cn(
						wrap,
						"grid grid-cols-[1.1fr_1fr] items-center gap-x-[90px] gap-y-[50px] border-(--home-line) border-t pt-[100px] pb-[65px] max-[600px]:grid-cols-1 max-[600px]:gap-[42px] max-[900px]:gap-[45px] max-[900px]:pt-[70px] max-[900px]:pb-[45px]",
					)}
					id="support"
					aria-labelledby="open-title"
				>
					<div>
						<h2 id="open-title" className={sectionTitle}>
							<Trans>
								A project you can
								<br />
								be part of.
							</Trans>
						</h2>
						<p className="mt-[26px] max-w-[460px] text-(--home-muted) text-[16px] leading-[1.75] max-[900px]:text-[14px]">
							<Trans>
								Reactive Resume is free and open source. Amruth and a community of contributors keep it running. If
								you’d like to support the work, donations help cover hosting and development.
							</Trans>
						</p>
						<a href={githubUrl} className={cn(textLink, "mt-5")}>
							<GithubLogoIcon size={21} aria-hidden="true" />
							<Trans>Find us on GitHub</Trans>
							<ArrowUpRightIcon size={16} aria-hidden="true" />
						</a>
					</div>
					<div className="transform-[perspective(1000px)_rotateY(-7deg)_rotateZ(2deg)] relative rounded-[2px_4px_2px_2px] bg-[#d9dad5] px-[35px] pt-[29px] pb-6 text-[#2d2e30] shadow-[1px_1px_0_#fafaf3_inset,1px_2px_0_#a9aaa6,2px_4px_0_#6b6c6a,8px_19px_30px_#0005] after:absolute after:top-0 after:right-0 after:size-[26px] after:rounded-[0_0_0_4px] after:bg-[#f4f5ec] after:shadow-[-1px_2px_2px_#0002] after:content-[''] max-[600px]:mx-auto max-[600px]:w-[calc(100%_-_10px)] max-[900px]:p-[25px]">
						<div className="flex items-center gap-[11px] pr-5 text-[13px] tracking-[-0.02em]">
							<img src="/icon/light.svg" alt="" width="36" height="36" />
							<span>Reactive Resume</span>
						</div>
						<h3 className="mt-[30px] mb-6 font-[Manrope_Variable,sans-serif] font-semibold text-[28px] leading-[1.2] tracking-[-0.045em] max-[900px]:text-[24px]">
							<Trans>Support the project</Trans>
						</h3>
						<a href="https://github.com/sponsors/AmruthPillai" className={paperLinkClass}>
							<GithubLogoIcon size={22} aria-hidden="true" />
							<span>GitHub Sponsors</span>
							<ArrowUpRightIcon size={20} aria-hidden="true" className={paperArrowClass} />
						</a>
						<a href="https://opencollective.com/reactive-resume/donate" className={paperLinkClass}>
							<span
								className="block size-[21px] rounded-full border-4 border-current border-r-[#9e9f99]"
								aria-hidden="true"
							/>
							<span>Open Collective</span>
							<ArrowUpRightIcon size={20} aria-hidden="true" className={paperArrowClass} />
						</a>
						<p className="mt-[22px] border-[#2d2e3045] border-t border-dashed pt-5 text-[#62635f] text-[11px]">
							<Trans>Thank you for helping keep it free.</Trans>
						</p>
					</div>
					<div className="col-span-full flex items-center justify-between gap-5 pt-3 text-(--home-muted) text-[13px] max-[900px]:flex-col max-[900px]:items-start max-[900px]:gap-3 max-[600px]:text-[12px]">
						<p>
							<Trans>There are other ways to pitch in.</Trans>
						</p>
						<div className="flex flex-wrap gap-x-7 max-[600px]:gap-x-5">
							<a href="https://crowdin.com/project/reactive-resume" className={contributeLinkClass}>
								<Trans>Translate the app</Trans>
								<ArrowUpRightIcon size={15} aria-hidden="true" />
							</a>
							<a href={`${githubUrl}/issues`} className={contributeLinkClass}>
								<Trans>Report a bug</Trans>
								<ArrowUpRightIcon size={15} aria-hidden="true" />
							</a>
							<a href="https://docs.rxresu.me/contributing/development" className={contributeLinkClass}>
								<Trans>Contribute code</Trans>
								<ArrowUpRightIcon size={15} aria-hidden="true" />
							</a>
						</div>
					</div>
				</section>
				<div
					className={cn(
						wrap,
						"flex items-center justify-between gap-[30px] border-(--home-line) border-y py-[47px] max-[540px]:flex-col max-[540px]:items-start max-[540px]:gap-6 max-[540px]:py-[35px]",
					)}
				>
					<p className="font-[Manrope_Variable,sans-serif] font-semibold text-[clamp(23px,2.4vw,33px)] leading-[1.3] tracking-[-0.045em] max-[540px]:text-[25px]">
						<Trans>Ready to put your name on it?</Trans>
					</p>
					<Link to="/dashboard" className={buttonClass}>
						<Trans>Create a resume</Trans>
						<ArrowRightIcon size={20} aria-hidden="true" />
					</Link>
				</div>
			</main>
			<SiteFooter />
		</div>
	);
}
