import type { ResumePreviewProps } from "./preview.shared";
import { lazy, Suspense } from "react";
import { useResumeData } from "../builder/draft";
import { ResumePreviewLoader } from "./preview.shared";
import { getResumePreviewPageCount } from "./preview.shared.utils";

const ResumePreviewClient = lazy(() =>
	import("./preview.browser").then((module) => ({ default: module.ResumePreviewClient })),
);

export type { ResumePreviewProps };

// ponytail: normalizeResumePreviewProps removed — defaults inlined here, single call site
export function ResumePreview({
	pageGap = 16,
	pageLayout = "horizontal",
	pageScale = 1,
	showPageNumbers = false,
	...rest
}: ResumePreviewProps) {
	const builderResumeData = useResumeData();
	const resumeData = rest.data ?? builderResumeData;
	const pageCount = getResumePreviewPageCount(resumeData);

	const resolvedProps = { ...rest, pageGap, pageLayout, pageScale, showPageNumbers };

	return (
		<Suspense
			fallback={
				<ResumePreviewLoader
					pageCount={pageCount}
					pageClassName={rest.pageClassName}
					pageGap={pageGap}
					pageLayout={pageLayout}
					pageScale={pageScale}
					showPageNumbers={showPageNumbers}
				/>
			}
		>
			<ResumePreviewClient {...resolvedProps} />
		</Suspense>
	);
}
