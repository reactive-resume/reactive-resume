import type { EditorMode } from "@/features/resume/editor/store";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { getRouteApi, Outlet } from "@tanstack/react-router";
import { Suspense, useEffect } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Tabs, TabsContent } from "@reactive-resume/ui/components/tabs";
import { cn } from "@reactive-resume/utils/style";
import { DownloadSheet } from "./download-sheet";
import { EditorBar } from "./editor-bar";
import { DesignPanel, DesignSheet, ModePanel } from "./mode-panels";
import { useEditorHotkeys } from "./use-editor-hotkeys";
import { ResumeAssistant } from "@/features/assistant/dock";
import { openAssistantFrom } from "@/features/assistant/open";
import { usePreviewPausedStore } from "@/features/resume/builder/draft";
import { IssueStepper } from "@/features/resume/editor/check/page-layer";
import { EditorFrame, MobileTabBar, useEditorLayout } from "@/features/resume/editor/chrome/shell";
import { useEditorStore } from "@/features/resume/editor/store";
import { useEditorMode } from "@/features/resume/editor/use-editor-mode";
import { useResumeWebMcpTools } from "@/features/resume/editor/webmcp";
import { revealSelectionInPanel } from "@/features/resume/editor/write/reveal";
import { preloadRichTextEditor } from "@/features/resume/editor/write/rich-text-editor";
import { whenIdle } from "@/features/resume/preview/resume-thumbnail.shared";

/**
 * The editor: a 56px bar over a 400px panel and the page canvas (desktop). On tablets the panel is a 380px
 * drawer over the page, pinnable beside it in landscape; on phones one view shows at a time, switched by
 * Write · Page · Design · Check · Share tabs.
 */
export function EditorShell() {
	const [mode, setMode] = useEditorMode();
	const editorLayout = useEditorLayout();
	const resetEditor = useEditorStore((state) => state.reset);

	// Selection, zoom and open sheets belong to one document.
	useEffect(() => resetEditor, [resetEditor]);
	// Design and the rich text editor load once the page is idle, so opening them is instant.
	useEffect(() => {
		void whenIdle().then(() => {
			void DesignPanel.preload?.();
			preloadRichTextEditor();
		});
	}, []);
	useOpenVersionFromUrl();
	useOpenAssistantFromUrl();
	useResumeWebMcpTools(routeApi.useParams().resumeId);

	return (
		<Tabs value={mode} onValueChange={(value) => setMode(value as EditorMode)} className="contents">
			<EditorFrame
				editorLayout={editorLayout}
				bar={<EditorBar layout={editorLayout.layout} pinnable={editorLayout.pinnable} />}
				mode={mode}
				panelLabel={panelLabel(mode)}
				panel={<ModePanel mode={mode} />}
				page={<Outlet />}
				assistant={<ResumeAssistant />}
				mobile={<MobileBody mode={mode} onModeChange={setMode} />}
			>
				<DownloadSheet />
				<EditorHotkeys onModeChange={setMode} />
			</EditorFrame>
		</Tabs>
	);
}

const routeApi = getRouteApi("/builder/$resumeId");

/** `?version=` opens History on that version (the page shows it read-only), then leaves the URL. */
function useOpenVersionFromUrl() {
	const { version } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();

	useEffect(() => {
		if (!version) return;
		useEditorStore.getState().setSheetTab("history");
		useEditorStore.setState({ historyVersionId: version });
		void navigate({
			to: ".",
			resetScroll: false,
			search: (current: ReturnType<typeof routeApi.useSearch>) => ({ ...current, version: undefined }),
			replace: true,
		});
	}, [version, navigate]);
}

/** `?assistant=` opens the assistant on that conversation; `?ask=` only fills its composer. Both then leave the URL. */
function useOpenAssistantFromUrl() {
	const { assistant, ask } = routeApi.useSearch();
	const navigate = routeApi.useNavigate();

	useEffect(() => {
		if (!openAssistantFrom({ assistant, draft: ask })) return;
		void navigate({
			to: ".",
			resetScroll: false,
			search: (current: ReturnType<typeof routeApi.useSearch>) => ({
				...current,
				assistant: undefined,
				ask: undefined,
			}),
			replace: true,
		});
	}, [assistant, ask, navigate]);
}

function EditorHotkeys({ onModeChange }: { onModeChange: (mode: EditorMode) => void }) {
	useEditorHotkeys(onModeChange);
	return null;
}

const panelLabel = (mode: EditorMode) =>
	({ write: t`Content`, design: t`Design`, check: t`Check`, share: t`Share` })[mode];

type MobileBodyProps = {
	mode: EditorMode;
	onModeChange: (mode: EditorMode) => void;
};

function MobileBody({ mode, onModeChange }: MobileBodyProps) {
	const view = useEditorStore((state) => state.mobileView) ?? mode;
	const setPreviewPaused = usePreviewPausedStore((state) => state.setPaused);

	// The page stays mounted so zoom survives switching views; it doesn't re-render while hidden. Design keeps
	// it in view above its sheet.
	const pageVisible = view === "page" || view === "design";
	useEffect(() => {
		// oxlint-disable-next-line react/set-state-in-effect -- a shared store the preview renderer reads, reset on unmount
		setPreviewPaused(!pageVisible);
		return () => setPreviewPaused(false);
	}, [pageVisible, setPreviewPaused]);

	return (
		<div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
			{/* Clip, not hidden: the lowered Design sheet overflows it, and scrolling into the sheet mustn't scroll it. */}
			<div className="relative min-h-0 overflow-clip">
				<main id="main-content" className={cn("h-full", !pageVisible && "invisible")}>
					<Outlet />
				</main>
				{view === "page" && mode === "check" && <IssueStepper />}
				{view === "page" && mode !== "check" && (
					<SelectionBar
						onEdit={() => {
							useEditorStore.setState({ mobileView: "write" });
							onModeChange("write");
						}}
					/>
				)}
				{view === "design" && (
					<Suspense>
						<DesignSheet />
					</Suspense>
				)}
				{view !== "page" && view !== "design" && (
					<TabsContent
						key={mode}
						value={mode}
						className="absolute inset-0 overflow-y-auto bg-surface [overflow-anchor:none]"
					>
						<ModePanel mode={mode} />
					</TabsContent>
				)}
			</div>

			<MobileTabBar
				tabs={[
					{ view: "write", icon: "pencil-simple", label: t`Write` },
					{ view: "page", icon: "file-text", label: t`Page` },
					{ view: "design", icon: "palette", label: t`Design` },
					{ view: "check", icon: "list-checks", label: t`Check` },
					{ view: "share", icon: "globe-hemisphere-west", label: t`Share` },
				]}
				view={view}
				onModeChange={onModeChange}
			/>
		</div>
	);
}

/** Phones: tapping a line on the page selects it and offers to edit that entry. Improve joins it in M10. */
function SelectionBar({ onEdit }: { onEdit: () => void }) {
	const selection = useEditorStore((state) => state.selection);
	if (!selection) return null;

	return (
		<div className="absolute bottom-[76px] left-1/2 z-10 flex -translate-x-1/2 items-center rounded-xl bg-ink p-1 text-bg shadow-e3 transition-[opacity,translate] duration-standard ease-enter starting:translate-y-2 starting:opacity-0">
			<button
				type="button"
				className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-[15px] font-semibold"
				onClick={() => {
					onEdit();
					revealSelectionInPanel(selection);
				}}
			>
				<Icon name="pencil-simple" size={20} />
				<Trans>Edit entry</Trans>
			</button>
		</div>
	);
}
