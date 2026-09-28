import type { Icon } from "@phosphor-icons/react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
	ArrowUpRightIcon,
	DiscordLogoIcon,
	GithubLogoIcon,
	LinkedinLogoIcon,
	RedditLogoIcon,
	XLogoIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { m } from "motion/react";
import { cn } from "@reactive-resume/utils/style";
import { EASE_OUT_STRONG } from "@/libs/motion";
import { wrap } from "./classes";

const githubUrl = "https://github.com/reactive-resume/reactive-resume";
const licenseUrl = `${githubUrl}/blob/main/LICENSE`;

type FooterLink = { label: string } & (
	| { external: string }
	| { anchor: string }
	| { to: "/dashboard" | "/ats-checker" }
);
type FooterColumn = { title: string; links: FooterLink[] };
type SocialLink = { url: string; label: string; icon: Icon };

const getColumns = (): FooterColumn[] => [
	{
		title: t`Product`,
		links: [
			{ anchor: "#templates", label: t`Templates` },
			{ anchor: "#features", label: t`Features` },
			{ to: "/ats-checker", label: t`ATS Checker` },
			{ to: "/dashboard", label: t`Get Started` },
		],
	},
	{
		title: t`Resources`,
		links: [
			{ external: "https://docs.rxresu.me", label: t`Documentation` },
			{ external: "https://docs.rxresu.me/changelog", label: t`Changelog` },
			{ external: githubUrl, label: t`Source Code` },
			{ external: "https://opencollective.com/reactive-resume/donate", label: t`Sponsorships` },
		],
	},
	{
		title: t`Community`,
		links: [
			{ external: "https://discord.gg/aSyA5ZSxpb", label: t`Discord` },
			{ external: "https://reddit.com/r/reactiveresume", label: t`Subreddit` },
			{ external: "https://crowdin.com/project/reactive-resume", label: t`Translations` },
			{ external: `${githubUrl}/issues`, label: t`Report an issue` },
		],
	},
	{
		title: t`Legal`,
		links: [
			{ external: "https://docs.rxresu.me/legal/privacy-policy", label: t`Privacy Policy` },
			{ external: licenseUrl, label: t`MIT License` },
		],
	},
];

const getSocialLinks = (): SocialLink[] => [
	{ url: githubUrl, label: t`GitHub`, icon: GithubLogoIcon },
	{ url: "https://x.com/KingOKings", label: t`X (Twitter)`, icon: XLogoIcon },
	{ url: "https://linkedin.com/in/amruthpillai", label: t`LinkedIn`, icon: LinkedinLogoIcon },
	{ url: "https://discord.gg/aSyA5ZSxpb", label: t`Discord`, icon: DiscordLogoIcon },
	{ url: "https://reddit.com/r/reactiveresume", label: t`Subreddit`, icon: RedditLogoIcon },
];

const linkClass =
	"group/link inline-flex min-h-9 items-center gap-1 text-(--home-muted) text-[14px] [transition:color_150ms_ease] hover:text-(--home-ink)";
const arrowClass =
	"opacity-0 [transition:opacity_180ms_ease,transform_180ms_var(--ease-out-strong)] group-hover/link:transform-[translate(1px,-1px)] group-hover/link:opacity-60";
const socialClass =
	"inline-grid size-10 place-items-center text-(--home-muted) [transition:color_160ms_ease] hover:text-(--home-ink)";
const metaLinkClass = "text-(--home-ink) underline-offset-[3px] hover:underline";

function FooterColumnLink({ link }: { link: FooterLink }) {
	if ("external" in link) {
		return (
			<a href={link.external} target="_blank" rel="noopener noreferrer" className={linkClass}>
				{link.label}
				<span className="sr-only">
					<Trans>(opens in new tab)</Trans>
				</span>
				<ArrowUpRightIcon size={13} aria-hidden="true" className={arrowClass} />
			</a>
		);
	}

	if ("anchor" in link) {
		return (
			<a href={link.anchor} className={linkClass}>
				{link.label}
			</a>
		);
	}

	return (
		<Link to={link.to} className={linkClass}>
			{link.label}
		</Link>
	);
}

export function SiteFooter() {
	return (
		<footer id="footer" className="relative isolate z-1 overflow-clip border-(--home-line) border-t">
			{/* Warm light pooling under the wordmark, echoing the parallax planes behind the page. */}
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-x-0 bottom-0 -z-1 h-[78%] bg-[radial-gradient(125%_100%_at_50%_100%,rgb(196_166_140/13%)_0%,rgb(166_143_184/7%)_36%,transparent_70%)]"
			/>

			<div
				className={cn(
					wrap,
					"grid grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,1fr))] gap-x-8 gap-y-12 pt-[76px] max-[1100px]:grid-cols-[repeat(3,minmax(0,1fr))] max-[700px]:grid-cols-2 max-[700px]:gap-y-10 max-[540px]:pt-[52px]",
				)}
			>
				<div className="max-[1100px]:col-span-full">
					<Link to="/" className="inline-flex items-center gap-[11px] font-[550] text-[17px] tracking-[-0.04em]">
						<img src="/icon/dark.svg" alt="" width="30" height="30" className="block" />
						<span>Reactive Resume</span>
					</Link>
					<p className="mt-[18px] max-w-[300px] text-(--home-muted) text-[14px] leading-[1.7]">
						<Trans>A free, open-source resume builder. Yours to keep, yours to export, yours to host.</Trans>
					</p>
					<ul className="mt-6 flex flex-wrap gap-1">
						{getSocialLinks().map((social) => (
							<li key={social.label}>
								<a
									href={social.url}
									target="_blank"
									rel="noopener noreferrer"
									className={socialClass}
									aria-label={`${social.label} (${t`opens in new tab`})`}
								>
									<social.icon aria-hidden="true" size={19} weight="fill" />
								</a>
							</li>
						))}
					</ul>
				</div>

				{getColumns().map((column) => (
					<nav key={column.title} aria-label={column.title}>
						<h2 className="font-[Manrope_Variable,sans-serif] font-semibold text-[15px] tracking-[-0.03em]">
							{column.title}
						</h2>
						<ul className="mt-[18px] space-y-0.5">
							{column.links.map((link) => (
								<li key={link.label}>
									<FooterColumnLink link={link} />
								</li>
							))}
						</ul>
					</nav>
				))}
			</div>

			<div
				className={cn(
					wrap,
					"mt-[68px] flex items-center justify-between gap-x-8 gap-y-3 border-(--home-line) border-t pt-6 text-[#87878d] text-[12px] max-[540px]:mt-12 max-[700px]:flex-col max-[700px]:items-start",
				)}
			>
				<p>
					<Trans>By the community, for the community.</Trans>
					<br />
					<Trans>
						Released under the{" "}
						<a href={licenseUrl} target="_blank" rel="noopener noreferrer" className={metaLinkClass}>
							MIT License
						</a>
						.
					</Trans>
				</p>
				<p>
					<Trans>
						A passion project by{" "}
						<a href="https://amruthpillai.com" target="_blank" rel="noopener noreferrer" className={metaLinkClass}>
							Amruth Pillai
						</a>
					</Trans>
					<span aria-hidden="true" className="px-2 text-(--home-line)">
						/
					</span>
					<bdi className="tabular-nums">v{__APP_VERSION__}</bdi>
				</p>
			</div>

			{/* Oversized wordmark, cropped by the footer edge so it reads as a watermark rather than a heading. */}
			<div className={cn(wrap, "@container mt-10 max-[540px]:mt-7")}>
				<m.p
					aria-hidden="true"
					className="select-none bg-gradient-to-b from-(--home-ink) from-45% to-[rgb(241_240_235/7%)] bg-clip-text font-[Manrope_Variable,sans-serif] font-bold text-[14.4cqw] text-transparent leading-[0.78] tracking-[-0.07em]"
					initial={{ opacity: 0, y: 24 }}
					whileInView={{ opacity: 1, y: 0 }}
					viewport={{ once: true, amount: 0.3 }}
					transition={{ duration: 0.7, ease: EASE_OUT_STRONG }}
				>
					Reactive Resume
				</m.p>
			</div>
		</footer>
	);
}
