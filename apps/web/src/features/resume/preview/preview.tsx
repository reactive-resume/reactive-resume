import type { ResumePreviewProps } from "./preview.shared";
import { lazy, Suspense } from "react";
import { useResumeData } from "../builder/draft";
import { ResumePreviewLoader } from "./preview.shared";
import { getResumePreviewPageCount } from "./preview.shared.utils";

const ResumePreviewClient = lazy(() =>
	import("./preview.browser").then((module) => ({ default: module.ResumePreviewClient })),
);

export type { ResumePreviewProps };

export function ResumePreview(props: ResumePreviewProps) {
	const builderResumeData = useResumeData();
	const pageCount = getResumePreviewPageCount(props.data ?? builderResumeData);

	return (
		<Suspense fallback={<ResumePreviewLoader {...props} pageCount={pageCount} />}>
			<ResumePreviewClient {...props} />
		</Suspense>
	);
}
