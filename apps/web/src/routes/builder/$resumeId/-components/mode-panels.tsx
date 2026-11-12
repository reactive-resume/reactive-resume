import type { EditorMode } from "@/features/resume/editor/store";
import { lazyRouteComponent } from "@tanstack/react-router";
import { Suspense } from "react";
import { CheckPanel } from "@/features/resume/editor/check/check-panel";
import { OfflineBanner } from "@/features/resume/editor/save-status";
import { WritePanel } from "@/features/resume/editor/write/write-panel";

// Design carries the font list and icon search: it loads once the editor is idle, or when first opened.
export const DesignPanel = lazyRouteComponent(() => import("./design-panel"), "DesignPanel");
export const DesignSheet = lazyRouteComponent(() => import("./design-panel"), "DesignSheet");
const SharePanel = lazyRouteComponent(() => import("@/features/resume/share/share-panel"), "SharePanel");

export function ModePanel({ mode }: { mode: EditorMode }) {
	return (
		<>
			{/* The one notice while offline, at the top of whichever panel is open. */}
			<OfflineBanner className="mx-6 mt-4 w-auto shrink-0" />
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
				<WritePanel />
			)}
		</>
	);
}
