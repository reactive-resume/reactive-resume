import { t } from "@lingui/core/macro";
import { useRouter } from "@tanstack/react-router";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { Tabs } from "@reactive-resume/ui/components/tabs";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { useResumeData } from "@/features/resume/builder/draft";
import { BackLink, usePageScale } from "@/features/resume/editor/chrome";
import { EditorFrame, useEditorLayout } from "@/features/resume/editor/chrome/shell";
import { ResumePreviewLoader } from "@/features/resume/preview/preview.shared";

/**
 * The builder while a resume loads: its own frame, with still placeholders for the bar and panel and a blank page
 * where the canvas draws its first page, at the same size. The editor then fills in place. The app's first load keeps
 * the logo loader, which takes over from the identical one in index.html.
 */
export function EditorPending() {
	const router = useRouter({ warn: false });
	const editorLayout = useEditorLayout();
	if (router?.state.resolvedLocation === undefined) return <LoadingScreen />;

	return (
		<Tabs value="write" className="contents">
			<EditorFrame
				editorLayout={editorLayout}
				bar={
					<header className="flex h-(--editor-bar) items-center gap-1.5 border-b border-line bg-surface px-3">
						<BackLink />
						<Skeleton className="h-4 w-40" />
					</header>
				}
				mode="write"
				panelLabel={t`Content`}
				panel={<PanelPlaceholder />}
				page={<PagePlaceholder />}
				assistant={null}
				mobile={
					<div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
						<PanelPlaceholder />
						<div className="min-h-[52px] border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]" />
					</div>
				}
			>
				{null}
			</EditorFrame>
		</Tabs>
	);
}

function PanelPlaceholder() {
	return (
		<div role="status" aria-label={t`Loading`} className="grid content-start gap-3 bg-surface p-4">
			<Skeleton className="h-9" />
			<Skeleton className="h-9" />
			<Skeleton className="h-9 w-2/3" />
			<Skeleton className="mt-4 h-11" />
			<Skeleton className="h-11" />
			<Skeleton className="h-11" />
		</div>
	);
}

/**
 * The canvas's blank first page, sized and placed as the page canvas places it (page-canvas.tsx). Also the page
 * route's own pending state, should its chunk still be loading once the editor is up.
 */
export function PagePlaceholder() {
	const data = useResumeData();
	const { canvasRef, pageScale } = usePageScale(data?.metadata.page.format ?? "a4");

	return (
		<div className="relative h-full min-h-0 bg-sunken">
			<div ref={canvasRef} className="absolute inset-0 overflow-auto px-4 pt-7 pb-24 sm:px-10">
				<div className="mx-auto w-fit">
					<ResumePreviewLoader
						data={data}
						pageLayout="vertical"
						pageGap={24}
						pageScale={pageScale}
						pageClassName="rounded-none shadow-page"
					/>
				</div>
			</div>
		</div>
	);
}
