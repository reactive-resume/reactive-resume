import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@reactive-resume/ui/components/avatar";
import { Icon } from "@reactive-resume/ui/components/icon";
import { getInitials } from "@reactive-resume/utils/string";
import { SignOutButton } from "./account/page";
import { getProjectLinks } from "./project-links";
import { PageHeader } from "@/components/layout/page-header";
import { useTheme } from "@/features/theme/provider";
import { orpc } from "@/libs/orpc/client";
import { themeMap } from "@/libs/theme";

// Phones: a section pushes in from the end and Back returns from the start (styles in index.css, after the page
// transition). Browsers without view-transition types swap instantly, as for every other navigation.
const supportsTransitionTypes = globalThis.CSS?.supports?.("selector(:active-view-transition-type(a))") === true;
const pushTransition = supportsTransitionTypes && { types: ["page", "forward"] };
export const popTransition = supportsTransitionTypes && { types: ["page", "back"] };

type RowProps = { icon: IconName; label: ReactNode; value?: ReactNode };

function Row({ icon, label, value }: RowProps) {
	return (
		<>
			<Icon name={icon} size={22} className="text-ink-2" />
			<span className="flex-1">{label}</span>
			{value && <span className="truncate text-sm text-ink-3">{value}</span>}
			<Icon name="caret-right" size={22} className="text-ink-3" />
		</>
	);
}

const rowClass =
	"flex h-14 items-center gap-3 px-3.5 font-medium text-base transition-colors duration-quick ease-enter active:bg-press";

/** Phones: the Settings tab opens the root, rows showing their current values. */
export function SettingsRoot() {
	const { i18n } = useLingui();
	const { session } = useRouteContext({ from: "/dashboard" });
	const { theme } = useTheme();
	const { data: providers } = useQuery(orpc.aiProviders.list.queryOptions());
	const provider = providers?.find((entry) => entry.enabled && entry.testStatus === "success");

	return (
		<div className="grid gap-4">
			<PageHeader title={<Trans>Settings</Trans>} />
			<div className="flex items-center gap-3">
				<Avatar className="size-12">
					<AvatarImage src={session.user.image ?? undefined} alt="" />
					<AvatarFallback className="bg-accent-soft font-semibold text-accent-text">
						{getInitials(session.user.name)}
					</AvatarFallback>
				</Avatar>
				<span className="grid min-w-0">
					<b className="truncate text-lg font-semibold">{session.user.name}</b>
					<span className="truncate text-sm text-ink-3">{session.user.email}</span>
				</span>
			</div>

			<nav
				aria-label={t`Settings`}
				className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface"
			>
				<Link to="/dashboard/settings/account" viewTransition={pushTransition} className={rowClass}>
					<Row icon="user-circle" label={<Trans>Account</Trans>} />
				</Link>
				<Link to="/dashboard/settings/profile" viewTransition={pushTransition} className={rowClass}>
					<Row icon="clipboard-text" label={<Trans>Profile</Trans>} />
				</Link>
				<Link to="/dashboard/settings/preferences" viewTransition={pushTransition} className={rowClass}>
					<Row icon="sliders-horizontal" label={<Trans>Preferences</Trans>} value={i18n.t(themeMap[theme])} />
				</Link>
				<Link to="/dashboard/settings/ai" viewTransition={pushTransition} className={rowClass}>
					<Row
						icon="sparkle"
						label={<Trans>AI & developer</Trans>}
						value={provider?.label ?? <Trans>Not set up</Trans>}
					/>
				</Link>
			</nav>

			{/* The desktop footer's links, as rows: each opens outside the app. */}
			<nav
				aria-label={t`About Reactive Resume`}
				className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface"
			>
				{getProjectLinks().map((link) => (
					<a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className={rowClass}>
						<Icon name={link.icon} size={22} className="text-ink-2" />
						<span className="flex-1">{link.label}</span>
						<Icon name="arrow-square-out" size={20} className="text-ink-3" />
					</a>
				))}
			</nav>
			<p className="text-center text-xs text-ink-3">
				<Trans>Reactive Resume {__APP_VERSION__} · MIT</Trans>
			</p>
			<SignOutButton />
		</div>
	);
}
