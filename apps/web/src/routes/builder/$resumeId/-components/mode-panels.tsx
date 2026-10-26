import type { EditorMode } from "@/features/resume/editor/store";
import { lazyRouteComponent } from "@tanstack/react-router";
import { Suspense } from "react";
import { CheckPanel } from "@/features/resume/editor/check/check-panel";
import { OfflineBanner } from "@/features/resume/editor/save-status";
import { useEditorStore } from "@/features/resume/editor/store";
import { selectionFromPanelElement } from "@/features/resume/editor/write/reveal";
import { WritePanel } from "@/features/resume/editor/write/write-panel";

// Design carries the font list and icon search: it loads once the editor is idle, or when first opened.
export const DesignPanel = lazyRouteComponent(() => import("./design-panel"), "DesignPanel");
export const DesignSheet = lazyRouteComponent(() => import("./design-panel"), "DesignSheet");
const SharePanel = lazyRouteComponent(() => import("@/features/resume/share/share-panel"), "SharePanel");

function WriteMode() {
	return (
		// Focus events bubble here from every field; the handler only reads where focus landed.
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- not an interactive element, see above.
		<div
			onFocus={(event) => {
				// Fields only: buttons (an entry's title, the chevrons) change the selection themselves.
				if (!event.target.matches("input, textarea, select, [contenteditable='true']")) return;
				const selection = selectionFromPanelElement(event.target);
				if (selection) useEditorStore.setState({ selection });
			}}
		>
			<WritePanel />
		</div>
	);
}

export function ModePanel({ mode }: { mode: EditorMode }) {
	return (
		<>
			<OfflineBanner className="mx-4 mt-4 w-auto" />
			{mode === "design" ? (
				<Suspense>
					<DesignPanel />
				</Suspense>
			) : mode === "check" ? (
				<CheckPanel />
			) : mode === "share" ? (
				<Suspense>
					<SharePanel />
				</Suspense>
			) : (
				<WriteMode />
			)}
		</>
	);
}
