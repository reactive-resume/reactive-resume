import type { Icon } from "@phosphor-icons/react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { GithubLogoIcon, LinkedinLogoIcon, XLogoIcon } from "@phosphor-icons/react";
import { m } from "motion/react";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { Button } from "@reactive-resume/ui/components/button";
import { Copyright } from "@/components/ui/copyright";
import { EASE_OUT_STRONG } from "@/libs/motion";

type FooterLinkItem = {
	url: string;
	label: string;
};

type FooterLinkGroupProps = {
	title: string;
	links: FooterLinkItem[];
};

type SocialLink = {
	url: string;
	label: string;
	icon: Icon;
};

const getResourceLinks = (): FooterLinkItem[] => [
	{ url: "https://docs.rxresu.me", label: t`Documentation` },
	{ url: "https://opencollective.com/reactive-resume/donate", label: t`Sponsorships` },
	{ url: "https://github.com/reactive-resume/reactive-resume", label: t`Source Code` },
	{ url: "https://docs.rxresu.me/changelog", label: t`Changelog` },
];

const getCommunityLinks = (): FooterLinkItem[] => [
	{ url: "https://github.com/reactive-resume/reactive-resume/issues", label: t`Report an issue` },
	{ url: "https://crowdin.com/project/reactive-resume", label: t`Translations` },
	{ url: "https://reddit.com/r/reactiveresume", label: t`Subreddit` },
	{ url: "https://discord.gg/aSyA5ZSxpb", label: t`Discord` },
];

const socialLinks: SocialLink[] = [
	{ url: "https://github.com/reactive-resume/reactive-resume", label: t`GitHub`, icon: GithubLogoIcon },
	{ url: "https://linkedin.com/in/amruthpillai", label: t`LinkedIn`, icon: LinkedinLogoIcon },
	{ url: "https://x.com/KingOKings", label: t`X (Twitter)`, icon: XLogoIcon },
];

export function Footer() {
	return (
		<m.footer
			id="footer"
			className="p-4 pb-8 md:p-8 md:pb-12"
			initial={{ opacity: 0 }}
			whileInView={{ opacity: 1 }}
			viewport={{ once: true }}
			transition={{ duration: 0.45, ease: EASE_OUT_STRONG }}
		>
			<div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
				{/* Brand Column */}
				<div className="space-y-4 sm:col-span-2 lg:col-span-1">
					<BrandIcon variant="logo" className="size-10" />

					<div className="space-y-2">
						<h2 className="font-semibold text-lg tracking-tight">Reactive Resume</h2>
						<p className="max-w-xs text-muted-foreground text-sm leading-relaxed">
							<Trans>
								A free and open-source resume builder that makes it easy to create, update, and share your resume.
							</Trans>
						</p>
					</div>

					{/* Social Links */}
					<div className="flex items-center gap-2 pt-2">
						{socialLinks.map((social) => (
							<Button
								key={social.label}
								size="icon-sm"
								variant="ghost"
								nativeButton={false}
								render={
									<a
										href={social.url}
										target="_blank"
										rel="noopener noreferrer"
										aria-label={`${social.label} (${t`opens in new tab`})`}
									>
										<social.icon aria-hidden="true" size={18} />
									</a>
								}
							/>
						))}
					</div>
				</div>

				{/* Resources Column */}
				<FooterLinkGroup title={t`Resources`} links={getResourceLinks()} />

				{/* Community Column */}
				<FooterLinkGroup title={t`Community`} links={getCommunityLinks()} />

				{/* Copyright Column */}
				<div className="space-y-4 sm:col-span-2 lg:col-span-1">
					<Copyright />
				</div>
			</div>
		</m.footer>
	);
}

function FooterLinkGroup({ title, links }: FooterLinkGroupProps) {
	return (
		<div className="space-y-4">
			<h2 className="font-medium text-muted-foreground text-sm tracking-tight">{title}</h2>

			<ul className="space-y-3">
				{links.map((link) => (
					<FooterLink key={link.url} url={link.url} label={link.label} />
				))}
			</ul>
		</div>
	);
}

function FooterLink({ url, label }: FooterLinkItem) {
	return (
		<li className="relative">
			<a
				href={url}
				target="_blank"
				rel="noopener noreferrer"
				className="relative inline-block text-sm transition-colors after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:origin-left after:scale-x-0 after:rounded-md after:bg-primary after:content-[''] hover:text-foreground hover:after:scale-x-100 rtl:after:origin-right after:[transition:scale_200ms_var(--ease-out-strong)]"
			>
				{label}

				<span className="sr-only">
					<Trans>(opens in new tab)</Trans>
				</span>
			</a>
		</li>
	);
}
