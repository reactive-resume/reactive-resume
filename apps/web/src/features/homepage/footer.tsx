import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Link } from "@tanstack/react-router";
import { cn } from "@reactive-resume/utils/style";
import { SCENE } from "./scroll";
import { labelClass } from "./ui";

const githubUrl = "https://github.com/reactive-resume/reactive-resume";
const licenseUrl = `${githubUrl}/blob/main/LICENSE`;
const linkClass = "text-ink transition-colors hover:text-accent-text";

type FooterLink = { label: string; href: string } | { label: string; to: "/ats-checker" | "/dashboard" };

const getColumns = (): { id: string; title: string; links: FooterLink[] }[] => [
	{
		id: "product",
		title: t`Product`,
		links: [
			{ label: t`Templates`, href: "#design" },
			{ label: t`Features`, href: "#write" },
			{ label: t`ATS checker`, to: "/ats-checker" },
			{ label: t`Get started`, to: "/dashboard" },
		],
	},
	{
		id: "resources",
		title: t`Resources`,
		links: [
			{ label: t`Documentation`, href: "https://docs.rxresu.me" },
			{ label: t`Changelog`, href: "https://docs.rxresu.me/changelog" },
			{ label: t`Source code`, href: githubUrl },
			{ label: t`Self-hosting`, href: "https://docs.rxresu.me" },
		],
	},
	{
		id: "community",
		title: t`Community`,
		links: [
			{ label: t`Discord`, href: "https://discord.gg/aSyA5ZSxpb" },
			{ label: t`Subreddit`, href: "https://reddit.com/r/reactiveresume" },
			{ label: t`Translations`, href: "https://crowdin.com/project/reactive-resume" },
			{ label: t`Report an issue`, href: `${githubUrl}/issues` },
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

/** 11 Footer, ending on the wordmark rising into view, cropped by the page's edge. */
export function LandingFooter() {
	return (
		<footer data-scene={SCENE.footer} className="relative overflow-hidden border-t border-line">
			<div className="mx-auto grid max-w-[1440px] grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-x-8 gap-y-10 px-(--gutter) pt-16">
				<div className="col-span-2 flex min-w-0 flex-col gap-3.5">
					<img
						src="/logo/light.svg"
						alt="Reactive Resume"
						width={140}
						height={140}
						className="-ms-[18px] -mt-[22px] -mb-[18px] size-[140px] dark:hidden"
					/>
					<img
						src="/logo/dark.svg"
						alt="Reactive Resume"
						width={140}
						height={140}
						className="-ms-[18px] -mt-[22px] -mb-[18px] hidden size-[140px] dark:block"
					/>
					<div className="flex flex-col gap-1 font-ui text-[13px] leading-normal text-ink-3">
						<p>{t`By the community, for the community.`}</p>
						<p>
							<Trans>
								Licensed under{" "}
								<a
									href={licenseUrl}
									className="text-accent-text underline underline-offset-[3px] transition-colors hover:text-accent-hover"
								>
									MIT License
								</a>
							</Trans>
						</p>
					</div>
				</div>

				{getColumns().map((column) => (
					<nav
						key={column.id}
						aria-labelledby={`footer-${column.id}`}
						className="flex flex-col gap-2.5 font-ui text-sm"
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

			{/* It fades in by sliding up out of the mask's faded bottom; an opacity fade would fail contrast checks. */}
			<div aria-hidden="true" className="@container mx-auto mt-14 max-w-[1440px] px-(--gutter)">
				<div className="h-[27cqw] overflow-hidden [mask-image:linear-gradient(to_bottom,#000_35%,transparent_100%)]">
					<div className="font-anybody [transform:translateY(calc((1-clamp(0,(var(--p)-.1)/.8,1))*60%))] pt-[.12em] pb-[.06em] text-[17.5cqw] leading-[.84] font-extrabold tracking-[-.035em] whitespace-nowrap text-ink font-stretch-[78%] select-none [transition:transform_.35s_var(--ease)]">
						<span className="block">Reactive</span>
						<span className="block text-accent-text">Resume</span>
					</div>
				</div>
			</div>
		</footer>
	);
}
