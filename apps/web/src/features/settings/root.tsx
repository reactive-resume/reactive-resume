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
			<Icon name="chevron_right" size={22} className="text-ink-3" />
		</>
	);
}

const rowClass =
	"flex h-14 items-center gap-3 px-3.5 font-medium text-base transition-colors duration-quick ease-enter active:bg-press";

/** Phones: the Settings tab opens the root, three rows showing their current values. */
export function SettingsRoot() {
	const { i18n } = useLingui();
	const { session } = useRouteContext({ from: "/dashboard" });
	const { theme } = useTheme();
	const { data: providers } = useQuery(orpc.aiProviders.list.queryOptions());
	const provider = providers?.find((entry) => entry.enabled && entry.testStatus === "success");

	return (
		<div className="grid gap-4">
			<h1 className="font-display text-[30px] leading-9 font-medium lg:hidden">
				<Trans>Settings</Trans>
			</h1>
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
				className="divide-y divide-line overflow-hidden rounded-[14px] border border-line bg-surface"
			>
				<Link to="/dashboard/settings/account" viewTransition={pushTransition} className={rowClass}>
					<Row icon="account_circle" label={<Trans>Account</Trans>} />
				</Link>
				<Link to="/dashboard/settings/preferences" viewTransition={pushTransition} className={rowClass}>
					<Row icon="tune" label={<Trans>Preferences</Trans>} value={i18n.t(themeMap[theme])} />
				</Link>
				<Link to="/dashboard/settings/ai" viewTransition={pushTransition} className={rowClass}>
					<Row icon="hub" label={<Trans>AI & developer</Trans>} value={provider?.label ?? <Trans>Not set up</Trans>} />
				</Link>
			</nav>

			<a
				href="https://docs.rxresu.me"
				target="_blank"
				rel="noopener noreferrer"
				className="flex h-12 items-center rounded-[14px] border border-line bg-surface px-3.5 font-medium transition-colors duration-quick ease-enter active:bg-press"
			>
				<Trans>Help & docs</Trans>
			</a>
			<SignOutButton />
		</div>
	);
}
