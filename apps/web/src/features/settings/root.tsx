import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@reactive-resume/ui/components/avatar";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { getLanguageName } from "@reactive-resume/utils/locale";
import { getInitials } from "@reactive-resume/utils/string";
import { getProjectLinks } from "./project-links";
import { List, ListRow } from "@/components/calm/list-row";
import { RootHeader } from "@/components/calm/page";
import { useTheme } from "@/features/theme/provider";
import { trashedApplicationsQueryOptions } from "@/features/trash/queries";
import { useSignOut } from "@/features/user/sign-out";
import { orpc } from "@/libs/orpc/client";
import { themeMap } from "@/libs/theme";

// Phones: a section pushes in from the end and Back returns from the start (styles in index.css, after the page
// transition). Browsers without view-transition types swap instantly, as for every other navigation.
const supportsTransitionTypes = globalThis.CSS?.supports?.("selector(:active-view-transition-type(a))") === true;
const pushTransition = supportsTransitionTypes && { types: ["page", "forward"] };
export const popTransition = supportsTransitionTypes && { types: ["page", "back"] };

/** Phones: the Settings tab opens the root, rows showing their current values. */
export function SettingsRoot() {
	const { i18n } = useLingui();
	const { session } = useRouteContext({ from: "/dashboard" });
	const { theme } = useTheme();
	const signOut = useSignOut();
	const { data: counts } = useQuery(orpc.documents.counts.queryOptions());
	const { data: applications } = useQuery(trashedApplicationsQueryOptions());
	const trashCount = (counts?.trash ?? 0) + (applications?.total ?? 0);
	const { data: providers } = useQuery(orpc.aiProviders.list.queryOptions());
	const provider = providers?.find((entry) => entry.enabled && entry.testStatus === "success");

	return (
		<div className="grid gap-5">
			<RootHeader title={<Trans>Settings</Trans>} />
			<div className="flex items-center gap-3">
				<Avatar className="size-12">
					<AvatarImage src={session.user.image ?? undefined} alt="" />
					<AvatarFallback className="bg-accent-soft font-semibold text-accent-text">
						{getInitials(session.user.name)}
					</AvatarFallback>
				</Avatar>
				<span className="grid min-w-0">
					<b className="truncate text-lg font-semibold">{session.user.name}</b>
					<span dir="ltr" className="truncate text-sm text-ink-3">
						{session.user.email}
					</span>
				</span>
			</div>

			<nav aria-label={t`Settings`}>
				<List cap>
					<ListRow
						render={<Link to="/dashboard/settings/account" viewTransition={pushTransition} />}
						leading={<Icon name="user" />}
						title={<Trans>Account</Trans>}
						subtitle={<Trans>Name, email, password, passkeys, your data</Trans>}
						caret
					/>
					<ListRow
						render={<Link to="/dashboard/settings/profile" viewTransition={pushTransition} />}
						leading={<Icon name="identification-card" />}
						title={<Trans>Application profile</Trans>}
						subtitle={<Trans>Details for job forms</Trans>}
						caret
					/>
					<ListRow
						render={<Link to="/dashboard/settings/preferences" viewTransition={pushTransition} />}
						leading={<Icon name="sliders-horizontal" />}
						title={<Trans>Preferences</Trans>}
						subtitle={`${i18n.t(themeMap[theme])} · ${getLanguageName(i18n.locale, i18n.locale)}`}
						caret
					/>
					<ListRow
						render={<Link to="/dashboard/settings/ai" viewTransition={pushTransition} />}
						leading={<Icon name="sparkle" />}
						title={<Trans>AI</Trans>}
						subtitle={provider ? `${provider.label} · ${provider.model}` : <Trans>Not set up</Trans>}
						caret
					/>
					<ListRow
						render={<Link to="/dashboard/settings/developer" viewTransition={pushTransition} />}
						leading={<Icon name="code" />}
						title={<Trans>Developer</Trans>}
						subtitle={<Trans>API keys and MCP</Trans>}
						caret
					/>
				</List>
			</nav>
			<List cap>
				<ListRow
					render={<Link to="/dashboard/trash" />}
					leading={<Icon name="trash" />}
					title={<Trans>Trash</Trans>}
					subtitle={
						trashCount ? (
							plural(trashCount, { one: "# item · each kept 30 days", other: "# items · each kept 30 days" })
						) : (
							<Trans>Items are kept for 30 days</Trans>
						)
					}
					caret
				/>
			</List>
			<Button variant="ghost" className="justify-start px-0" onClick={() => void signOut()}>
				<Icon name="sign-out" />
				<Trans>Sign out</Trans>
			</Button>
			<footer className="mt-2 t-small text-ink-3">
				<p>
					<Trans>Reactive Resume {__APP_VERSION__} · MIT</Trans>
				</p>
				<nav aria-label={t`About Reactive Resume`} className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
					{getProjectLinks().map((link) => (
						<a
							key={link.href}
							href={link.href}
							target="_blank"
							rel="noopener noreferrer"
							className="underline decoration-line-2 underline-offset-3"
						>
							{link.label}
						</a>
					))}
				</nav>
			</footer>
		</div>
	);
}
