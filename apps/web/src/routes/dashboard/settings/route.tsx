import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { createFileRoute, Link, Outlet, retainSearchParams, useRouterState } from "@tanstack/react-router";
import { Fragment } from "react";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { PageHeader } from "@/components/layout/page-header";
import { getProjectLinks } from "@/features/settings/project-links";
import { popTransition } from "@/features/settings/root";
import { authClient } from "@/libs/auth/client";
import { getPageTitle } from "@/libs/seo";

type Page = {
	to:
		| "/dashboard/settings/profile"
		| "/dashboard/settings/account"
		| "/dashboard/settings/preferences"
		| "/dashboard/settings/ai";
	icon: IconName;
	label: () => string;
};

const SETTINGS_PAGES: Page[] = [
	{ to: "/dashboard/settings/account", icon: "user-circle", label: () => t`Account` },
	{ to: "/dashboard/settings/profile", icon: "clipboard-text", label: () => t`Profile` },
	{ to: "/dashboard/settings/preferences", icon: "sliders-horizontal", label: () => t`Preferences` },
	{ to: "/dashboard/settings/ai", icon: "sparkle", label: () => t`AI & developer` },
];

// The project's own links: where to read up, see the code, help translate, report a problem or donate.

export const Route = createFileRoute("/dashboard/settings")({
	head: () => ({ meta: [{ title: getPageTitle(t`Settings`) }] }),
	validateSearch: z.object({ forAccount: z.string().min(1).max(200).optional() }),
	search: { middlewares: [retainSearchParams(["forAccount"])] },
	component: RouteComponent,
});

function RouteComponent() {
	const location = useRouterState({ select: (state) => state.location });
	const pathname = location.pathname;
	const { forAccount } = Route.useSearch();
	const { session } = Route.useRouteContext();
	const { data: browserSession, error } = authClient.useSession();

	const matchesAccount =
		!forAccount || (!error && forAccount === session.user.id && forAccount === browserSession?.user.id);
	const isRoot = pathname.replace(/\/$/, "") === "/dashboard/settings";

	return (
		<div className="grid min-h-full content-start sm:h-svh sm:min-h-0 sm:grid-rows-[auto_minmax(0,1fr)] sm:overflow-hidden lg:grid-cols-[220px_minmax(0,1fr)] lg:grid-rows-1 lg:content-stretch">
			<nav
				aria-label={t`Settings`}
				className="flex flex-col gap-1 border-line [view-transition-name:settings-nav] max-lg:border-b max-sm:hidden lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:border-e lg:py-7 lg:ps-6 lg:pe-3"
			>
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
						<Icon name="caret-left" size={20} />
						<Trans>Settings</Trans>
					</Link>
				)}
				<div className="grid max-w-[680px] gap-8">
					{matchesAccount ? (
						<Outlet />
					) : (
						<>
							<PageHeader title={<Trans>Account</Trans>} />
							<p role="alert">
								<Trans>Sign in with the account that opened these settings.</Trans>
							</p>
							<Button render={<Link to="/auth/login" search={{ reauthenticate: true, callbackURL: location.href }} />}>
								<Trans>Sign in again</Trans>
							</Button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
