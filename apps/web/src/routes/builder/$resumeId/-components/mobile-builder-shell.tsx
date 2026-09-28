import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { EyeIcon, NotePencilIcon, PaletteIcon } from "@phosphor-icons/react";
import { Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { cn } from "@reactive-resume/utils/style";
import { usePreviewPausedStore } from "@/features/resume/builder/draft";
import { BuilderSidebarLeft } from "../-sidebar/left";
import { BuilderSidebarRight } from "../-sidebar/right";
import { BuilderHeader } from "./header";

type MobileBuilderTab = "edit" | "preview" | "design";

const MOBILE_BUILDER_TABS = [
	{ value: "edit", icon: NotePencilIcon },
	{ value: "preview", icon: EyeIcon },
	{ value: "design", icon: PaletteIcon },
] as const satisfies readonly { value: MobileBuilderTab; icon: Icon }[];

type MobileSidebarPanelProps = {
	children: ReactNode;
};

function MobileSidebarPanel({ children }: MobileSidebarPanelProps) {
	// Sits below the header (top-14) and above the tab bar (bottom-16). The sidebar's ScrollArea hardcodes
	// `h-[calc(100svh-3.5rem)]`; override it to fill this panel so its last item isn't hidden under the tab bar.
	return (
		<div className="fixed inset-x-0 top-14 bottom-16 z-40 bg-background [&_[data-slot=scroll-area]]:h-full">
			{children}
		</div>
	);
}

type MobileBuilderTabBarProps = {
	activeTab: MobileBuilderTab;
	onTabChange: (tab: MobileBuilderTab) => void;
};

function MobileBuilderTabBar({ activeTab, onTabChange }: MobileBuilderTabBarProps) {
	const labels: Record<MobileBuilderTab, string> = { edit: t`Edit`, preview: t`Preview`, design: t`Design` };

	return (
		<nav className="fixed inset-x-0 bottom-0 z-50 flex border-t bg-popover pb-[env(safe-area-inset-bottom)]">
			{MOBILE_BUILDER_TABS.map(({ value, icon: Icon }) => {
				const isActive = value === activeTab;

				return (
					<button
						key={value}
						type="button"
						aria-current={isActive ? "page" : undefined}
						onClick={() => onTabChange(value)}
						className={cn(
							"flex min-h-16 flex-1 flex-col items-center justify-center gap-1 text-xs transition-[color,scale] duration-150 ease-out-strong active:scale-[0.97]",
							isActive ? "text-primary" : "text-muted-foreground hover:text-foreground",
						)}
					>
						<Icon className="size-5" weight={isActive ? "fill" : "regular"} />
						<span>{labels[value]}</span>
					</button>
				);
			})}
		</nav>
	);
}

export function MobileBuilderShell() {
	// Local state is enough — mobile view mode is shell-scoped and doesn't need to persist.
	const [tab, setTab] = useState<MobileBuilderTab>("edit");
	const setPreviewPaused = usePreviewPausedStore((state) => state.setPaused);

	// The preview stays mounted under the Edit/Design overlay; pause its render while it's covered.
	useEffect(() => {
		setPreviewPaused(tab !== "preview");
		return () => setPreviewPaused(false);
	}, [tab, setPreviewPaused]);

	return (
		<div className="flex min-h-[100dvh] flex-col">
			<a
				href="#main-content"
				className="sr-only rounded-md bg-popover px-4 py-2 text-sm ring-2 ring-ring focus:not-sr-only focus:absolute focus:inset-s-2 focus:top-2 focus:z-[100]"
			>
				<Trans>Skip to main content</Trans>
			</a>

			<BuilderHeader />

			{/* The preview (fixed inset-0) stays mounted so zoom/pan state survives tab switches. */}
			<main id="main-content" className="flex-1">
				<Outlet />
			</main>

			{tab === "edit" && (
				<MobileSidebarPanel>
					<BuilderSidebarLeft />
				</MobileSidebarPanel>
			)}
			{tab === "design" && (
				<MobileSidebarPanel>
					<BuilderSidebarRight />
				</MobileSidebarPanel>
			)}

			<MobileBuilderTabBar activeTab={tab} onTabChange={setTab} />
		</div>
	);
}
