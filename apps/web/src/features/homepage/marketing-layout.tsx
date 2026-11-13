import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { Link, useRouterState } from "@tanstack/react-router";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { Button, buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { getLanguageName } from "@reactive-resume/utils/locale";
import { cn } from "@reactive-resume/utils/style";
import { LandingFooter } from "./footer";
import { LocaleCombobox } from "@/features/locale/combobox";

type MarketingLayoutProps = { children: ReactNode };

/**
 * Public chrome for the tool pages (Templates, ATS checker), shared by the live routes and their anonymous build-time
 * HTML. The homepage has its own header (header.tsx) and does not render this.
 */
export function MarketingLayout({ children }: MarketingLayoutProps) {
	return (
		<div className="relative isolate flex min-h-svh flex-col bg-bg font-ui text-ink">
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:fixed focus:inset-s-4 focus:top-4 focus:z-100 focus:rounded-md focus:bg-bg focus:px-4 focus:py-2 focus:text-ink focus:shadow-lg focus:ring-2 focus:ring-accent"
			>
				<Trans>Skip to main content</Trans>
			</a>
			<PublicHeader />
			{children}
			{/* The footer is the homepage's own, on its desk: it keeps that page's variables. */}
			<div className="landing relative">
				<LandingFooter story={false} />
			</div>
		</div>
	);
}

const navLink =
	"flex h-9 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-ink-2 transition-colors duration-quick hover:text-ink aria-[current=page]:bg-hover aria-[current=page]:font-semibold aria-[current=page]:text-ink";

/** Calm public header (`.pubh`): the brand, the two tool pages, then language, sign in and one quiet way to start. */
function PublicHeader() {
	const { i18n } = useLingui();
	// Build-time prerender has no route matches; live routes carry the root session.
	const signedIn = useRouterState({ select: (state) => Boolean(state.matches.at(-1)?.context.session) });
	const language = getLanguageName(i18n.locale, i18n.locale, false);

	return (
		<header
			data-design="pubh"
			className="sticky top-0 z-70 flex h-16 shrink-0 items-center gap-1 border-b border-line bg-bg ps-3 pe-5 max-sm:pe-3"
		>
			{/* On phones the wordmark is read, not shown: the mark alone leaves room for the two pages. */}
			<a
				href="/"
				className="me-4 flex h-9 items-center gap-2.5 rounded-md px-2 text-[15px] leading-5 font-semibold max-sm:me-1 max-sm:gap-0 max-sm:text-[0px]"
			>
				<BrandIcon variant="icon" alt="" className="size-6 shrink-0" />
				Reactive Resume
			</a>

			<nav aria-label={t`Site`} className="flex items-center gap-0.5">
				<Link to="/resume-templates" className={navLink}>
					<Trans>Templates</Trans>
				</Link>
				<Link to="/ats-checker" className={navLink}>
					<Trans>ATS checker</Trans>
				</Link>
			</nav>

			<div className="ms-auto flex items-center gap-1">
				<LocaleCombobox
					render={(props) => (
						<button
							{...props}
							type="button"
							aria-label={t`Language: ${language}`}
							className={cn(buttonVariants({ variant: "ghost" }), "max-sm:hidden")}
						>
							<Icon name="translate" />
							{language}
						</button>
					)}
				/>
				{/* Phones keep the two pages and one way in; language is also in the footer. */}
				{signedIn ? (
					<Button variant="secondary" nativeButton={false} render={<Link to="/dashboard" />} className="ms-1">
						<Icon name="house-simple" className="sm:hidden" />
						<span className="max-sm:sr-only">
							<Trans>Go to dashboard</Trans>
						</span>
					</Button>
				) : (
					<>
						<Button variant="ghost" nativeButton={false} render={<Link to="/auth/login" />}>
							<Trans>Sign in</Trans>
						</Button>
						{/* Quiet on purpose: each of these pages has its own accent button. */}
						<Button
							variant="secondary"
							nativeButton={false}
							render={<Link to="/auth/register" />}
							className="ms-1 max-sm:hidden"
						>
							<Trans>Build your resume</Trans>
						</Button>
					</>
				)}
			</div>
		</header>
	);
}
