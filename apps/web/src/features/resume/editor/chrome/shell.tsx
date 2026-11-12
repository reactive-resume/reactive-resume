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
import { AssistantOverlay } from "@/features/assistant/dock";
import { useEditorStore } from "@/features/resume/editor/store";

// The editor shell resumes and letters share: the layout for the screen, the one panel slot beside the page (the
// mode's panel, or the assistant or History in its place) and the phone tab bar. Each editor brings its own bar,
// panels, page and phone body. How another area mounts in the slot: `.agents` handoff, B/work/B/PANEL-SLOT.md.

/** One panel beside the page from 640px; phones show one view at a time. */
export function useEditorLayout() {
	const breakpoint = useBreakpoint();
	const layout = breakpoint === "mobile" ? "mobile" : breakpoint === "tablet" ? "tablet" : "desktop";
	return {
		layout,
		pinnable: false,
		pinned: layout === "tablet",
		assistantPlace: layout === "mobile" ? "screen" : "replace",
	} as const;
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
	/** Version history, in the panel's place while `historyOpen` (the clock in the bar). Without it the clock keeps
	 * opening the Download & history sheet. */
	history?: ReactNode;
	/** Phones show one view at a time; each editor brings its own. */
	mobile: ReactNode;
	/** The Download & history sheet and hotkeys. */
	children: ReactNode;
};

/** A 56px bar over the one panel slot and the page; the assistant and History take the panel's place. */
export function EditorFrame({
	editorLayout,
	bar,
	mode,
	panelLabel,
	panel,
	page,
	assistant,
	history,
	mobile,
	children,
}: EditorFrameProps) {
	const { layout, assistantPlace } = editorLayout;

	return (
		<div className="grid h-svh grid-rows-[var(--editor-bar)_minmax(0,1fr)] overflow-hidden bg-bg">
			<a
				href="#main-content"
				className="sr-only rounded-md bg-raised px-4 py-2 text-sm focus:not-sr-only focus:absolute focus:inset-s-2 focus:top-2 focus:z-[100]"
			>
				<Trans>Skip to the page</Trans>
			</a>

			{bar}

			{layout !== "mobile" && (
				<DesktopBody
					mode={mode}
					panelLabel={panelLabel}
					panel={panel}
					page={page}
					assistant={assistantPlace === "replace" ? assistant : null}
					history={history}
					narrow={layout === "tablet"}
				/>
			)}
			{layout === "mobile" && mobile}

			{assistantPlace === "screen" && <AssistantOverlay place={assistantPlace}>{assistant}</AssistantOverlay>}

			{children}
		</div>
	);
}

type BodyProps = { mode: string; panelLabel: string; panel: ReactNode; page: ReactNode };

type DesktopBodyProps = BodyProps & {
	/** Takes the panel's place while `assistantOpen`. */
	assistant: ReactNode;
	/** Takes the panel's place while `historyOpen`. */
	history: ReactNode;
	/** Pinned on a tablet: a 380px panel. */
	narrow: boolean;
};

/**
 * The panel slot beside the page: 400px on desktop, 380px when pinned on a tablet. It holds one thing at a time: the
 * mode's panel, or the assistant or History in its place, so the page keeps its width. Hidden (`panelHidden`), the
 * page has the whole canvas.
 */
function DesktopBody({ mode, panelLabel, panel, page, assistant, history, narrow }: DesktopBodyProps) {
	const assistantOpen = useEditorStore((state) => state.assistantOpen);
	const historyOpen = useEditorStore((state) => state.historyOpen);
	const instant = useEditorStore((state) => state.assistantInstant);
	const hidden = useEditorStore((state) => state.panelHidden);
	const takeover = assistantOpen && assistant ? "assistant" : historyOpen && history ? "history" : null;
	// Each thing fades up 4px as it takes the slot; ⌘J swaps at once.
	const enter = instant
		? undefined
		: "transition-[opacity,translate] duration-standard ease-enter starting:translate-y-1 starting:opacity-0";

	return (
		<div className="relative flex min-h-0">
			{!hidden && (
				<aside
					id="editor-panel"
					data-design="epanel"
					data-panel={takeover ?? mode}
					aria-label={takeover === "assistant" ? t`Assistant` : takeover === "history" ? t`Version history` : t`Editor`}
					className={cn(
						"grid min-h-0 shrink-0 grid-rows-[minmax(0,1fr)] overflow-hidden border-e border-line bg-bg",
						narrow ? "w-[380px]" : "w-(--editor-panel)",
					)}
				>
					{takeover ? (
						<div key={takeover} className={cn("flex min-h-0 min-w-0 flex-col", enter)}>
							{takeover === "assistant" ? assistant : history}
						</div>
					) : (
						<TabsContent
							key={mode}
							value={mode}
							aria-label={panelLabel}
							// `relative`: absolutely positioned descendants (sr-only text, say) stay inside this scroller instead of
							// stretching the document, which would let scrollIntoView shift the whole editor. Keyed by mode so each
							// mode starts at its top; no scroll anchoring, which yanked the Design panel back while scrolling it.
							className={cn("relative flex min-h-0 flex-col overflow-y-auto [overflow-anchor:none]", enter)}
						>
							{panel}
						</TabsContent>
					)}
				</aside>
			)}
			<main id="main-content" className="min-h-0 min-w-0 flex-1">
				{page}
			</main>
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
		<nav aria-label={t`Editor views`} className="flex border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
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
							"relative flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-center text-xs [overflow-wrap:anywhere] transition-[color,scale] duration-quick ease-enter active:scale-[0.97]",
							tab === "page" && "ms-1 border-s border-line",
							active ? "font-semibold text-accent-text" : "text-ink-2",
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
