import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Fragment } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { popTransition } from "@/features/settings/root";

type Page = {
	to: "/dashboard/settings/account" | "/dashboard/settings/preferences" | "/dashboard/settings/ai";
	icon: IconName;
	label: () => string;
};

// Six pages became three, each with one job (README §5.9).
const SETTINGS_PAGES: Page[] = [
	{ to: "/dashboard/settings/account", icon: "account_circle", label: () => t`Account` },
	{ to: "/dashboard/settings/preferences", icon: "tune", label: () => t`Preferences` },
	{ to: "/dashboard/settings/ai", icon: "hub", label: () => t`AI & developer` },
];

// The project's own links: where to read up, see the code, help translate, report a problem or donate.
const getProjectLinks = () => [
	{ href: "https://docs.rxresu.me", label: t`Docs` },
	{ href: "https://github.com/reactive-resume/reactive-resume", label: t`Source` },
	{ href: "https://crowdin.com/project/reactive-resume", label: t`Translate` },
	{ href: "https://github.com/reactive-resume/reactive-resume/issues", label: t`Report a bug` },
	{ href: "https://opencollective.com/reactive-resume/donate", label: t`Donate` },
];

export const Route = createFileRoute("/dashboard/settings")({ component: RouteComponent });

function RouteComponent() {
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const isRoot = pathname.replace(/\/$/, "") === "/dashboard/settings";

	return (
		<div className="grid min-h-full content-start sm:h-svh sm:min-h-0 sm:grid-rows-[auto_minmax(0,1fr)] sm:overflow-hidden lg:grid-cols-[220px_minmax(0,1fr)] lg:grid-rows-1 lg:content-stretch">
			<nav
				aria-label={t`Settings`}
				className="flex flex-col gap-1 border-line [view-transition-name:settings-nav] max-lg:border-b max-sm:hidden lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-e lg:py-7 lg:ps-6 lg:pe-3"
			>
				<h1 className="ms-2 mb-3.5 font-display text-[26px] leading-8 font-medium max-lg:hidden">
					<Trans>Settings</Trans>
				</h1>
				<div className="flex gap-1 max-lg:overflow-x-auto max-lg:px-6 max-lg:py-2 lg:flex-col">
					{SETTINGS_PAGES.map((page) => (
						<Link
							key={page.to}
							to={page.to}
							className="flex h-10 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium text-ink-2 transition-colors duration-quick hover:bg-hover"
							activeProps={{ className: "bg-sunken text-ink", "aria-current": "page" }}
						>
							<Icon name={page.icon} size={20} />
							{page.label()}
						</Link>
					))}
				</div>
				<p className="mt-auto px-2.5 text-xs leading-[18px] text-ink-3 max-lg:hidden">
					<Trans>Reactive Resume {__APP_VERSION__} · MIT</Trans>
					<br />
					{getProjectLinks().map((link, index) => (
						<Fragment key={link.href}>
							{index > 0 && " · "}
							<a className="underline" href={link.href} target="_blank" rel="noopener noreferrer">
								{link.label}
							</a>
						</Fragment>
					))}
				</p>
			</nav>

			<div className="min-w-0 px-12 pt-8 pb-16 max-lg:px-6 max-sm:px-4 max-sm:pt-4 sm:min-h-0 sm:overflow-y-auto sm:overscroll-contain">
				{!isRoot && (
					<Link
						to="/dashboard/settings"
						viewTransition={popTransition}
						className="mb-4 inline-flex h-9 items-center gap-1 text-sm text-ink-2 sm:hidden"
					>
						<Icon name="chevron_left" size={20} />
						<Trans>Settings</Trans>
					</Link>
				)}
				<div className="grid max-w-[680px] gap-8">
					<Outlet />
				</div>
			</div>
		</div>
	);
}
