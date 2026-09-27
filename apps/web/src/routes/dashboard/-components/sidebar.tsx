import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import {
	BrainIcon,
	BriefcaseIcon,
	ChatCircleDotsIcon,
	EnvelopeSimpleIcon,
	GearSixIcon,
	KeyIcon,
	MagnifyingGlassIcon,
	ReadCvLogoIcon,
	SealCheckIcon,
	ShieldCheckIcon,
	UserCircleIcon,
	UserGearIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, m } from "motion/react";
import { Avatar, AvatarFallback, AvatarImage } from "@reactive-resume/ui/components/avatar";
import { BrandIcon } from "@reactive-resume/ui/components/brand-icon";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	SidebarSeparator,
	useSidebarState,
} from "@reactive-resume/ui/components/sidebar";
import { getInitials } from "@reactive-resume/utils/string";
import { Copyright } from "@/components/ui/copyright";
import { useCommandPaletteStore } from "@/features/command-palette/store";
import { UserDropdownMenu } from "@/features/user/dropdown-menu";
import { EASE_OUT_STRONG } from "@/libs/motion";

type SidebarItem = {
	icon: React.ReactNode;
	label: MessageDescriptor;
	href: React.ComponentProps<typeof Link>["to"];
};

const appSidebarItems = [
	{
		icon: <ReadCvLogoIcon />,
		label: msg`Resumes`,
		href: "/dashboard/resumes",
	},
	{
		icon: <BriefcaseIcon />,
		label: msg`Applications`,
		href: "/dashboard/applications",
	},
	{
		icon: <EnvelopeSimpleIcon />,
		label: msg`Cover Letters`,
		href: "/dashboard/cover-letters",
	},
	{
		icon: <ChatCircleDotsIcon />,
		label: msg`Agents`,
		href: "/agent",
	},
	{
		icon: <SealCheckIcon />,
		label: msg`ATS Checker`,
		href: "/ats-checker",
	},
] as const satisfies SidebarItem[];

const settingsSidebarItems = [
	{
		icon: <UserCircleIcon />,
		label: msg`Profile`,
		href: "/dashboard/settings/profile",
	},
	{
		icon: <GearSixIcon />,
		label: msg`Preferences`,
		href: "/dashboard/settings/preferences",
	},
	{
		icon: <ShieldCheckIcon />,
		label: msg`Authentication`,
		href: "/dashboard/settings/authentication",
	},
	{
		icon: <KeyIcon />,
		label: msg`API Keys`,
		href: "/dashboard/settings/api-keys",
	},
	{
		icon: <BrainIcon />,
		label: msg`Integrations`,
		href: "/dashboard/settings/integrations",
	},
	{
		icon: <UserGearIcon />,
		label: msg`Account`,
		href: "/dashboard/settings/account",
	},
] as const satisfies SidebarItem[];

type SidebarItemListProps = {
	items: readonly SidebarItem[];
};

function SidebarItemList({ items }: SidebarItemListProps) {
	const { i18n } = useLingui();

	return (
		<SidebarMenu>
			{items.map((item) => (
				<SidebarMenuItem key={item.href}>
					<SidebarMenuButton
						tooltip={i18n.t(item.label)}
						render={
							<Link to={item.href} activeProps={{ className: "bg-sidebar-accent" }}>
								{item.icon}
								<span className="shrink-0 transition-opacity duration-150 ease-out-strong group-data-[collapsible=icon]:opacity-0 group-data-instant/sidebar-wrapper:transition-none">
									{i18n.t(item.label)}
								</span>
							</Link>
						}
					/>
				</SidebarMenuItem>
			))}
		</SidebarMenu>
	);
}

function SidebarSearchButton() {
	const { i18n } = useLingui();
	const setOpen = useCommandPaletteStore((state) => state.setOpen);

	const label = i18n.t(msg`Search`);

	return (
		<SidebarMenuItem>
			<SidebarMenuButton tooltip={label} onClick={() => setOpen(true)}>
				<MagnifyingGlassIcon />
				<span className="flex-1 text-start transition-opacity duration-150 ease-out-strong group-data-[collapsible=icon]:opacity-0 group-data-instant/sidebar-wrapper:transition-none">
					{label}
				</span>
				<Kbd className="transition-opacity duration-150 ease-out-strong group-data-[collapsible=icon]:opacity-0 group-data-instant/sidebar-wrapper:transition-none">
					⌘K
				</Kbd>
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

export function DashboardSidebar() {
	const { i18n } = useLingui();
	const { state } = useSidebarState();

	return (
		<Sidebar variant="floating" collapsible="icon">
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							className="h-auto justify-center"
							render={
								<Link to="/">
									<BrandIcon variant="icon" className="size-6" />
									<h1 className="sr-only">Reactive Resume</h1>
								</Link>
							}
						/>
					</SidebarMenuItem>

					<SidebarSearchButton />
				</SidebarMenu>
			</SidebarHeader>

			<SidebarSeparator />

			<SidebarContent aria-label={i18n.t(msg`Dashboard`)} role="navigation">
				<SidebarGroup>
					<SidebarGroupLabel>
						<Trans>App</Trans>
					</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarItemList items={appSidebarItems} />
					</SidebarGroupContent>
				</SidebarGroup>

				<SidebarGroup>
					<SidebarGroupLabel>
						<Trans>Settings</Trans>
					</SidebarGroupLabel>
					<SidebarGroupContent>
						<SidebarItemList items={settingsSidebarItems} />
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>

			<SidebarSeparator />

			<SidebarFooter className="gap-y-0">
				<SidebarMenu>
					<SidebarMenuItem>
						<UserDropdownMenu>
							{({ session }) => (
								<SidebarMenuButton className="h-auto gap-x-3 group-data-[collapsible=icon]:p-1!">
									<Avatar className="size-8 shrink-0 group-data-[collapsible=icon]:size-6">
										<AvatarImage src={session.user.image ?? undefined} />
										<AvatarFallback className="group-data-[collapsible=icon]:text-[0.5rem]">
											{getInitials(session.user.name)}
										</AvatarFallback>
									</Avatar>

									<div className="transition-opacity duration-150 ease-out-strong group-data-[collapsible=icon]:opacity-0 group-data-instant/sidebar-wrapper:transition-none">
										<p className="font-medium">{session.user.name}</p>
										<p className="text-muted-foreground text-xs">{session.user.email}</p>
									</div>
								</SidebarMenuButton>
							)}
						</UserDropdownMenu>
					</SidebarMenuItem>
				</SidebarMenu>

				<AnimatePresence>
					{state === "expanded" && (
						<m.div
							key="copyright"
							initial={{ opacity: 0 }}
							animate={{ opacity: 1, transition: { duration: 0.2, ease: EASE_OUT_STRONG } }}
							exit={{ opacity: 0, transition: { duration: 0.08 } }}
						>
							<Copyright className="wrap-break-word shrink-0 whitespace-normal p-2" />
						</m.div>
					)}
				</AnimatePresence>
			</SidebarFooter>

			<SidebarRail />
		</Sidebar>
	);
}
