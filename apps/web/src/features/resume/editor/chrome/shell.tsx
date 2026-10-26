import type { MobileView } from "@/features/resume/editor/store";
import type { IconName } from "@reactive-resume/ui/components/icon";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Icon } from "@reactive-resume/ui/components/icon";
import { TabsContent } from "@reactive-resume/ui/components/tabs";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { MobileTabIndicator } from "@/components/layout/mobile-tab-indicator";
import {
	AssistantColumn,
	AssistantOverlay,
	AssistantReplace,
	assistantGridTransition,
	assistantPlaceFor,
	columnsWithAssistant,
} from "@/features/assistant/dock";
import { useIsLandscape } from "@/features/resume/editor/chrome";
import { useEditorStore } from "@/features/resume/editor/store";

// The editor shell resumes and letters share: the layout for the screen, the panel beside or over the page, the
// assistant's place and the phone tab bar. Each editor brings its own bar, panels, page and phone body.

/** Desktop, tablet (the panel is a drawer, pinnable beside the page in landscape) or phone. */
export function useEditorLayout() {
	const breakpoint = useBreakpoint();
	const layout = breakpoint === "mobile" ? "mobile" : breakpoint === "tablet" ? "tablet" : "desktop";
	const landscape = useIsLandscape();
	const pinnable = layout === "tablet" && landscape;
	const pinned = useEditorStore((state) => state.drawerPinned) && pinnable;

	return { layout, pinnable, pinned, assistantPlace: assistantPlaceFor(breakpoint) } as const;
}

type EditorFrameProps = {
	editorLayout: ReturnType<typeof useEditorLayout>;
	bar: ReactNode;
	mode: string;
	/** The panel's accessible name in this mode. */
	panelLabel: string;
	panel: ReactNode;
	page: ReactNode;
	assistant: ReactNode;
	/** Phones show one view at a time; each editor brings its own. */
	mobile: ReactNode;
	/** The Download & history sheet and hotkeys. */
	children: ReactNode;
};

/** A 56px bar over the panel and the page; the assistant joins as a column, in the panel's place, or over it all. */
export function EditorFrame({
	editorLayout,
	bar,
	mode,
	panelLabel,
	panel,
	page,
	assistant,
	mobile,
	children,
}: EditorFrameProps) {
	const { layout, pinned, assistantPlace } = editorLayout;

	return (
		<div className="grid h-svh grid-rows-[var(--editor-bar)_minmax(0,1fr)] overflow-hidden bg-bg">
			<a
				href="#main-content"
				className="sr-only rounded-md bg-raised px-4 py-2 text-sm focus:not-sr-only focus:absolute focus:inset-s-2 focus:top-2 focus:z-[100]"
			>
				<Trans>Skip to the page</Trans>
			</a>

			{bar}

			{(layout === "desktop" || pinned) && (
				<DesktopBody
					mode={mode}
					panelLabel={panelLabel}
					panel={panel}
					page={page}
					assistant={assistant}
					column={assistantPlace === "column"}
					replace={assistantPlace === "replace"}
					narrow={pinned}
				/>
			)}
			{layout === "tablet" && !pinned && <TabletBody mode={mode} panelLabel={panelLabel} panel={panel} page={page} />}
			{layout === "mobile" && mobile}

			{(assistantPlace === "drawer" || assistantPlace === "screen") && (
				<AssistantOverlay place={assistantPlace}>{assistant}</AssistantOverlay>
			)}

			{children}
		</div>
	);
}

type BodyProps = { mode: string; panelLabel: string; panel: ReactNode; page: ReactNode };

type DesktopBodyProps = BodyProps & {
	assistant: ReactNode;
	/** ≥1280: the assistant has its own column. */
	column: boolean;
	/** 1024–1279: the assistant takes the panel's place while open. */
	replace: boolean;
	/** Pinned on a tablet: a 380px panel. */
	narrow: boolean;
};

/** The panel beside the page: 400px on desktop, 380px when pinned on a tablet; the assistant joins at ≥1280. */
function DesktopBody({ mode, panelLabel, panel, page, assistant, column, replace, narrow }: DesktopBodyProps) {
	const assistantOpen = useEditorStore((state) => state.assistantOpen);
	const assistantInstant = useEditorStore((state) => state.assistantInstant);

	return (
		<div
			className={cn("relative grid min-h-0", assistantGridTransition(assistantOpen, assistantInstant))}
			style={{
				gridTemplateColumns: column
					? columnsWithAssistant(assistantOpen)
					: narrow
						? "380px minmax(0,1fr)"
						: "var(--editor-panel) minmax(0,1fr)",
			}}
		>
			<AssistantReplace
				replaced={replace && assistantOpen}
				assistant={<div className="min-h-0 border-e border-line">{assistant}</div>}
			>
				<TabsContent
					key={mode}
					value={mode}
					aria-label={panelLabel}
					// `relative`: absolutely positioned descendants (sr-only text, say) stay inside this scroller instead of
					// stretching the document, which would let scrollIntoView shift the whole editor. Keyed by mode so each
					// mode starts at its top; no scroll anchoring, which yanked the Design panel back while scrolling it.
					className="relative min-h-0 overflow-y-auto border-e border-line bg-surface [overflow-anchor:none]"
				>
					{panel}
				</TabsContent>
			</AssistantReplace>
			<main id="main-content" className="min-h-0 min-w-0">
				{page}
			</main>
			{column && <AssistantColumn>{assistant}</AssistantColumn>}
		</div>
	);
}

/** Tablets: the page, with the panel as a 380px drawer over it. */
function TabletBody({ mode, panelLabel, panel, page }: BodyProps) {
	const drawerOpen = useEditorStore((state) => state.drawerOpen);

	return (
		<div className="relative min-h-0">
			<main id="main-content" className="h-full min-w-0">
				{page}
			</main>
			<TabsContent
				key={mode}
				value={mode}
				aria-label={panelLabel}
				inert={!drawerOpen}
				className={cn(
					"absolute inset-y-0 start-0 z-20 w-[380px] max-w-[calc(100%-3rem)] overflow-y-auto border-e border-line bg-surface shadow-e3 transition-transform duration-emphasized ease-enter [overflow-anchor:none]",
					!drawerOpen && "-translate-x-full rtl:translate-x-full",
				)}
			>
				{panel}
			</TabsContent>
		</div>
	);
}

type MobileTabBarProps<V extends MobileView> = {
	tabs: { view: V; icon: IconName; label: string }[];
	view: V;
	/** Every view but Page is also the editor's mode. */
	onModeChange: (mode: Exclude<V, "page">) => void;
};

/** Phones: the views along the bottom, one showing at a time. */
export function MobileTabBar<V extends MobileView>({ tabs, view, onModeChange }: MobileTabBarProps<V>) {
	return (
		<nav aria-label={t`Editor views`} className="flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
			{tabs.map(({ view: tab, icon, label }) => {
				const active = tab === view;

				return (
					<button
						key={tab}
						type="button"
						aria-current={active ? "page" : undefined}
						onClick={() => {
							useEditorStore.setState({ mobileView: tab });
							if (tab !== "page") onModeChange(tab as Exclude<V, "page">);
						}}
						className={cn(
							"relative flex min-h-[52px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-[color,scale] duration-quick ease-enter active:scale-[0.97]",
							active ? "font-semibold text-ink" : "text-ink-2",
						)}
					>
						{active && <MobileTabIndicator />}
						<Icon name={icon} size={24} filled={active} />
						{label}
					</button>
				);
			})}
		</nav>
	);
}
