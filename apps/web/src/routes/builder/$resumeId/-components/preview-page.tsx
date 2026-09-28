import { t } from "@lingui/core/macro";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useReducedMotion } from "motion/react";
import { Suspense, useState } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { toast } from "@reactive-resume/ui/components/toast";
import { LoadingScreen } from "@/components/layout/loading-screen";
import { ResumePreview } from "@/features/resume/preview/preview";
import { BuilderDock } from "./dock";
import { DEFAULT_BUILDER_PREVIEW_PAGE_LAYOUT, getNextBuilderPreviewPageLayout } from "./page-layout";
import { blurFocusedElementOnPan } from "./pan-focus";

export function PreviewPage() {
	const [pageLayout, setPageLayout] = useState(DEFAULT_BUILDER_PREVIEW_PAGE_LAYOUT);
	const reduceMotion = useReducedMotion();

	useHotkey("Mod+S", () => {
		toast.add({
			type: "info",
			description: t`Your changes are saved automatically.`,
			id: "auto-save",
		});
	});

	return (
		<Suspense fallback={<LoadingScreen />}>
			<div className="fixed inset-0">
				<TransformWrapper
					centerOnInit
					maxScale={5}
					minScale={0.5}
					initialScale={0.75}
					limitToBounds={false}
					wheel={{ step: 0.001 }}
					doubleClick={{ animationType: "easeOutCubic", animationTime: reduceMotion ? 0 : 200 }}
					onPanningStart={blurFocusedElementOnPan}
				>
					{/* Zoom transforms use left-origin coordinates, regardless of the interface language. */}
					<TransformComponent wrapperClass="h-full! w-full!" wrapperProps={{ dir: "ltr" }}>
						<ResumePreview showPageNumbers pageLayout={pageLayout} />
					</TransformComponent>

					<BuilderDock
						pageLayout={pageLayout}
						onTogglePageLayout={() => {
							setPageLayout((current) => getNextBuilderPreviewPageLayout(current));
						}}
					/>
				</TransformWrapper>
			</div>
		</Suspense>
	);
}
