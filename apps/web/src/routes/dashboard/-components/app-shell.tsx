import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@reactive-resume/ui/components/avatar";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { getInitials } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { MobileTabIndicator } from "@/components/layout/mobile-tab-indicator";
import { useDialogStore } from "@/dialogs/store";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { useCommandPaletteStore } from "@/features/command-palette/store";
import { isEditableElementFocused } from "@/features/resume/builder/draft";
import { UserDropdownMenu } from "@/features/user/dropdown-menu";
import { orpc } from "@/libs/orpc/client";

type NavItem = {
	to: "/dashboard" | "/dashboard/applications" | "/dashboard/trash" | "/dashboard/settings";
	icon: IconName;
	label: string;
	count?: number;
};

function useNavItems() {
	const { data: counts } = useQuery(orpc.documents.counts.queryOptions());
	const { data: applications } = useQuery(applicationsListQueryOptions());

	const items: NavItem[] = [
		{
			to: "/dashboard",
			icon: "description",
			label: t`Documents`,
			...(counts ? { count: counts.resume + counts.letter } : {}),
		},
		{
			to: "/dashboard/applications",
			icon: "work",
			label: t`Applications`,
			...(applications ? { count: applications.filter((application) => application.status !== "closed").length } : {}),
		},
	];
	const settings: NavItem = { to: "/dashboard/settings", icon: "settings", label: t`Settings` };
	const trash: NavItem | null = counts?.trash
		? { to: "/dashboard/trash", icon: "delete", label: t`Trash`, count: counts.trash }
		: null;

	return { items, settings, trash };
}

/** Whether the item is the current page: Documents is exact, the others match their section. */
function useIsCurrent() {
	const matchRoute = useMatchRoute();
	return (to: NavItem["to"]) => Boolean(matchRoute({ to, fuzzy: to !== "/dashboard" }));
}

/**
 * The app shell for Documents, Trash, Applications and Settings: a 240px sidebar at ≥1024, an icon rail at
 * 640–1023 and a bottom tab bar below 640. N opens New anywhere outside a field.
 */
type AppShellProps = { children: ReactNode };

export function AppShell({ children }: AppShellProps) {
	const breakpoint = useBreakpoint();
	const openDialog = useDialogStore((state) => state.openDialog);

	useHotkey("N", () => {
		if (isEditableElementFocused() || useDialogStore.getState().open) return;
		openDialog("document.new", undefined);
	});

	return (
		<div
			className={cn(
				"grid min-h-svh bg-bg",
				breakpoint === "mobile"
					? "grid-rows-[minmax(0,1fr)_auto]"
					: breakpoint === "tablet"
						? "grid-cols-[64px_minmax(0,1fr)]"
						: "grid-cols-[240px_minmax(0,1fr)]",
			)}
		>
			<a
				href="#main-content"
				className="sr-only rounded-md bg-raised px-4 py-2 text-sm focus:not-sr-only focus:absolute focus:inset-s-2 focus:top-2 focus:z-[100]"
			>
				<Trans>Skip to main content</Trans>
			</a>
			{breakpoint !== "mobile" && (breakpoint === "tablet" ? <Rail /> : <Sidebar />)}
			<main id="main-content" className="min-w-0">
				{children}
			</main>
			{breakpoint === "mobile" && <MobileTabs />}
		</div>
	);
}

function Sidebar() {
	const { items, settings, trash } = useNavItems();
	const isCurrent = useIsCurrent();
	const openPalette = useCommandPaletteStore((state) => state.setOpen);
	const openDialog = useDialogStore((state) => state.openDialog);

	return (
		<aside className="sticky top-0 flex h-svh flex-col gap-3 border-e border-line bg-surface p-3 [view-transition-name:app-nav]">
			<Link to="/" className="flex h-9 items-center gap-2.5 px-1.5">
				<BrandIcon variant="icon" alt="" className="size-6 shrink-0" />
				<span className="text-sm font-semibold">Reactive Resume</span>
			</Link>

			<button
				type="button"
				aria-label={t`Search or run…`}
				aria-keyshortcuts="Meta+K"
				onClick={() => openPalette(true)}
				className="flex h-[34px] items-center gap-2 rounded-lg border border-line bg-bg px-2.5 text-sm text-ink-3 transition-colors duration-quick hover:text-ink-2"
			>
				<Icon name="search" size={18} />
				<span className="flex-1 text-start">
					<Trans>Search or run…</Trans>
				</span>
				<Kbd>⌘K</Kbd>
			</button>

			<nav aria-label={t`App`} className="grid gap-0.5">
				{items.map((item) => (
					<NavLink key={item.to} item={item} current={isCurrent(item.to)} />
				))}
				<div className="mt-2 border-t border-line pt-2">
					<NavLink item={settings} current={isCurrent(settings.to)} />
				</div>
			</nav>

			<div className="mt-auto grid gap-2">
				{trash && <NavLink item={trash} current={isCurrent(trash.to)} />}
				<Button
					aria-label={t`New`}
					aria-keyshortcuts="N"
					className="h-9 justify-between"
					onClick={() => openDialog("document.new", undefined)}
				>
					<span className="flex items-center gap-1.5">
						<Icon name="add" />
						<Trans>New</Trans>
					</span>
					<Kbd className="bg-on-accent/15 text-on-accent">N</Kbd>
				</Button>
				<UserDropdownMenu>
					{({ session }) => (
						<button
							type="button"
							className="flex h-11 items-center gap-2.5 rounded-lg px-1.5 text-start transition-colors duration-quick hover:bg-hover"
						>
							<Avatar className="size-7">
								<AvatarImage src={session.user.image ?? undefined} />
								<AvatarFallback className="text-[11px]">{getInitials(session.user.name)}</AvatarFallback>
							</Avatar>
							<span className="grid min-w-0">
								<span className="truncate text-sm font-medium">{session.user.name}</span>
								<span className="text-xs text-ink-3">
									<Trans>Account</Trans>
								</span>
							</span>
						</button>
					)}
				</UserDropdownMenu>
			</div>
		</aside>
	);
}

function NavLink({ item, current }: { item: NavItem; current: boolean }) {
	return (
		<Link
			to={item.to}
			aria-current={current ? "page" : undefined}
			className={cn(
				"flex h-[34px] items-center gap-2.5 rounded-lg px-2.5 text-sm transition-[background-color,color,scale] duration-quick ease-enter active:scale-[0.97]",
				current ? "bg-sunken font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
			)}
		>
			<Icon name={item.icon} filled={current} />
			<span className="flex-1">{item.label}</span>
			{item.count !== undefined && <span className="font-mono text-xs text-ink-3">{item.count}</span>}
		</Link>
	);
}

/** Tablets: the same destinations as icons, with their names in tooltips. */
function Rail() {
	const { items, settings, trash } = useNavItems();
	const isCurrent = useIsCurrent();
	const openPalette = useCommandPaletteStore((state) => state.setOpen);
	const openDialog = useDialogStore((state) => state.openDialog);

	return (
		<aside className="sticky top-0 flex h-svh flex-col items-center gap-2 border-e border-line bg-surface py-3 [view-transition-name:app-nav]">
			<Link to="/" aria-label="Reactive Resume" className="mb-1 grid size-8 place-items-center rounded-md">
				<BrandIcon variant="icon" alt="" className="size-6" />
			</Link>
			<RailTip label={t`Search`} icon="search">
				<button
					type="button"
					aria-label={t`Search or run…`}
					onClick={() => openPalette(true)}
					className="grid size-10 place-items-center rounded-lg text-ink-2 transition-[background-color,scale] duration-quick ease-enter hover:bg-hover active:scale-[0.97]"
				/>
			</RailTip>
			<nav aria-label={t`App`} className="grid gap-1">
				{[...items, settings].map((item) => (
					<RailTip key={item.to} label={item.label} icon={item.icon} filled={isCurrent(item.to)}>
						<Link
							to={item.to}
							aria-label={item.label}
							aria-current={isCurrent(item.to) ? "page" : undefined}
							className={cn(
								"grid size-10 place-items-center rounded-lg transition-[background-color,color,scale] duration-quick ease-enter active:scale-[0.97]",
								isCurrent(item.to) ? "bg-sunken text-ink" : "text-ink-2 hover:bg-hover",
							)}
						/>
					</RailTip>
				))}
			</nav>
			<div className="mt-auto grid justify-items-center gap-2">
				{trash && (
					<RailTip label={trash.label} icon={trash.icon}>
						<Link
							to={trash.to}
							aria-label={t`Trash`}
							className="grid size-10 place-items-center rounded-lg text-ink-2 transition-[background-color,scale] duration-quick ease-enter hover:bg-hover active:scale-[0.97]"
						/>
					</RailTip>
				)}
				<RailTip label={t`New`} icon="add">
					<Button size="icon" aria-label={t`New`} onClick={() => openDialog("document.new", undefined)} />
				</RailTip>
				<UserDropdownMenu>
					{({ session }) => (
						<button type="button" aria-label={t`Account`} className="rounded-full">
							<Avatar className="size-8">
								<AvatarImage src={session.user.image ?? undefined} />
								<AvatarFallback className="text-[11px]">{getInitials(session.user.name)}</AvatarFallback>
							</Avatar>
						</button>
					)}
				</UserDropdownMenu>
			</div>
		</aside>
	);
}

/** A rail button: its icon inside the given trigger, and its name in a tooltip. */
function RailTip({
	label,
	icon,
	filled = false,
	children,
}: {
	label: string;
	icon: IconName;
	filled?: boolean;
	children: React.ReactElement;
}) {
	return (
		<Tooltip>
			<TooltipTrigger render={children}>
				<Icon name={icon} filled={filled} />
			</TooltipTrigger>
			<TooltipContent side="right">{label}</TooltipContent>
		</Tooltip>
	);
}

/** Phones: Documents · Applications · New · Settings, with New as an accent pill in the middle. */
function MobileTabs() {
	const isCurrent = useIsCurrent();
	const openDialog = useDialogStore((state) => state.openDialog);

	const tab = (icon: IconName, label: string, current: boolean) => (
		<>
			{current && <MobileTabIndicator />}
			<Icon name={icon} size={24} filled={current} />
			<span className={cn("text-[11px]", current ? "font-semibold text-ink" : "text-ink-2")}>{label}</span>
		</>
	);

	return (
		<nav
			aria-label={t`App`}
			className="sticky bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] [view-transition-name:app-nav]"
		>
			<Link
				to="/dashboard"
				aria-current={isCurrent("/dashboard") ? "page" : undefined}
				viewTransition={false}
				className="relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 transition-[scale] duration-quick ease-enter active:scale-[0.97]"
			>
				{tab("description", t`Documents`, isCurrent("/dashboard"))}
			</Link>
			<Link
				to="/dashboard/applications"
				aria-current={isCurrent("/dashboard/applications") ? "page" : undefined}
				viewTransition={false}
				className="relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 transition-[scale] duration-quick ease-enter active:scale-[0.97]"
			>
				{tab("work", t`Applications`, isCurrent("/dashboard/applications"))}
			</Link>
			<button
				type="button"
				onClick={() => openDialog("document.new", undefined)}
				className="flex min-h-[52px] flex-col items-center justify-center gap-0.5 transition-[scale] duration-quick ease-enter active:scale-[0.97]"
			>
				<span className="grid h-[26px] w-[34px] place-items-center rounded-full bg-accent text-on-accent">
					<Icon name="add" size={20} />
				</span>
				<span className="text-[11px] text-ink-2">
					<Trans>New</Trans>
				</span>
			</button>
			<Link
				to="/dashboard/settings"
				aria-current={isCurrent("/dashboard/settings") ? "page" : undefined}
				viewTransition={false}
				className="relative flex min-h-[52px] flex-col items-center justify-center gap-0.5 transition-[scale] duration-quick ease-enter active:scale-[0.97]"
			>
				{tab("settings", t`Settings`, isCurrent("/dashboard/settings"))}
			</Link>
		</nav>
	);
}
