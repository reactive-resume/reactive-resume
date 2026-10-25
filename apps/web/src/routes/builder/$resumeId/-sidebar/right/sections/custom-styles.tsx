import { t } from "@lingui/core/macro";
import { lazy, Suspense } from "react";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { SectionBase } from "../shared/section-base";

const StylesheetEditorShell = lazy(() => import("@/features/resume/stylesheet/editor"));

export function CustomStylesSectionBuilder() {
	return (
		<SectionBase type="styles" className="space-y-4">
			<Suspense fallback={<Skeleton role="status" aria-label={t`Loading stylesheet editor…`} className="h-72" />}>
				<StylesheetEditorShell />
			</Suspense>
		</SectionBase>
	);
}
