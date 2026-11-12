import type { IconName } from "@reactive-resume/ui/components/icon";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { createFileRoute, Link, Outlet, retainSearchParams, useRouterState } from "@tanstack/react-router";
import { Fragment } from "react";
import z from "zod";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Page, PageBody, RootHeader } from "@/components/calm/page";
import { SectionRail, SectionRailItem } from "@/components/calm/section-rail";
import { PageHeader } from "@/components/layout/page-header";
import { getProjectLinks } from "@/features/settings/project-links";
import { popTransition } from "@/features/settings/root";
import { useSignOut } from "@/features/user/sign-out";
import { authClient } from "@/libs/auth/client";
import { getPageTitle } from "@/libs/seo";

type Section = {
	to:
		| "/dashboard/settings/account"
		| "/dashboard/settings/profile"
		| "/dashboard/settings/preferences"
		| "/dashboard/settings/ai"
		| "/dashboard/settings/developer";
	icon: IconName;
	label: () => string;
};

const SECTIONS: Section[] = [
	{ to: "/dashboard/settings/account", icon: "user", label: () => t`Account` },
	{ to: "/dashboard/settings/profile", icon: "identification-card", label: () => t`Application profile` },
	{ to: "/dashboard/settings/preferences", icon: "sliders-horizontal", label: () => t`Preferences` },
	{ to: "/dashboard/settings/ai", icon: "sparkle", label: () => t`AI` },
	{ to: "/dashboard/settings/developer", icon: "code", label: () => t`Developer` },
];

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
	const signOut = useSignOut();

	const matchesAccount =
		!forAccount || (!error && forAccount === session.user.id && forAccount === browserSession?.user.id);
	const isRoot = pathname.replace(/\/$/, "") === "/dashboard/settings";

	return (
		<Page>
			<PageBody>
				{/* Phones open the root list, which has its own title, and each section has a Back link. */}
				<RootHeader title={<Trans>Settings</Trans>} className="max-sm:hidden" />
				<div className="grid gap-x-12 gap-y-4 sm:mt-5 lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start">
					<div className="flex flex-col [view-transition-name:settings-nav] max-sm:hidden lg:sticky lg:top-7">
						<SectionRail aria-label={t`Settings sections`}>
							{SECTIONS.map((section) => (
								<SectionRailItem key={section.to} to={section.to} icon={section.icon}>
									{section.label()}
								</SectionRailItem>
							))}
						</SectionRail>
						<div className="mx-2.5 my-4 h-px bg-line max-lg:hidden" />
						{/* Sign out left the account menu for here; phones have it on the Settings root. */}
						<button
							type="button"
							onClick={() => void signOut()}
							className="flex h-10 items-center gap-3 rounded-md px-2.5 text-start text-sm font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink max-lg:hidden"
						>
							<Icon name="sign-out" />
							<Trans>Sign out</Trans>
						</button>
					</div>

					<div className="min-w-0">
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
						<div className="grid max-w-[704px] gap-8">
							{matchesAccount ? (
								<Outlet />
							) : (
								<>
									<PageHeader title={<Trans>Account</Trans>} />
									<p role="alert">
										<Trans>Sign in with the account that opened these settings.</Trans>
									</p>
									<Button
										render={<Link to="/auth/login" search={{ reauthenticate: true, callbackURL: location.href }} />}
									>
										<Trans>Sign in again</Trans>
									</Button>
								</>
							)}
						</div>
						<p className="mt-12 text-xs leading-[18px] text-ink-3 max-sm:hidden">
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
					</div>
				</div>
			</PageBody>
		</Page>
	);
}
