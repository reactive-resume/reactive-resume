import type { PageMap } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { CSSProperties, ReactNode } from "react";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import { DEFAULT_PDF_PAGE_SIZE, getResumePreviewGapValue, getScaledPreviewPageSize } from "./preview.shared.utils";

export type ResumePreviewProps = {
	className?: string;
	data?: ResumeData | undefined;
	pageGap?: CSSProperties["gap"];
	pageLayout?: "horizontal" | "vertical";
	pageScale?: number;
	pageClassName?: string | undefined;
	showPageNumbers?: boolean;
	/** Letters show the sender's header, which a document with only a letter otherwise leaves out. */
	includeCoverLetterHeader?: boolean;
	/** Drawn above each page (e.g. "Page 1 · Letter"). Replaces the small page-number caption. */
	renderPageCaption?: (page: { pageNumber: number; totalPages: number }) => ReactNode;
	/** Drawn over each page, in page-relative coordinates; receives the page map of the render on screen. */
	renderPageOverlay?: (page: { pageIndex: number; pageMap: PageMap | undefined }) => ReactNode;
	/** Called whenever the render on screen changes, with its physical page count and page map. */
	/** Each render on screen: its page count, page map and the PDF itself. */
	onRender?: (render: { pageCount: number; pageMap: PageMap | undefined; file: Blob }) => void;
};

export type ResolvedResumePreviewProps = ResumePreviewProps & {
	pageLayout: "horizontal" | "vertical";
	pageScale: number;
	showPageNumbers: boolean;
};

type ResumePreviewLoaderProps = Pick<ResumePreviewProps, "pageClassName" | "showPageNumbers"> & {
	pageCount?: number;
	pageGap?: CSSProperties["gap"];
	pageLayout?: "horizontal" | "vertical";
	pageScale?: number;
	/** Shown on the first page in place of the spinner when the render failed. */
	failure?: ReactNode;
};

// ponytail: normalizeResumePreviewProps deleted — defaults now live in ResumePreview destructuring

export function ResumePreviewLoader({
	pageCount = 1,
	pageClassName,
	pageGap = 16,
	pageLayout = "horizontal",
	pageScale = 1,
	showPageNumbers = false,
	failure,
}: ResumePreviewLoaderProps) {
	const pageSize = getScaledPreviewPageSize(DEFAULT_PDF_PAGE_SIZE, pageScale);
	const resolvedPageGap = getResumePreviewGapValue(pageGap);

	return (
		<div
			// Chrome-only placeholder: anchor pages left-to-right so page 1 stays on-screen regardless of UI direction.
			dir="ltr"
			style={{ "--resume-preview-page-gap": resolvedPageGap } as CSSProperties}
			className={cn(
				"flex justify-start gap-(--resume-preview-page-gap)",
				pageLayout === "horizontal" ? "flex-row items-start" : "flex-col items-center",
			)}
		>
			{Array.from({ length: pageCount }, (_, index) => {
				const pageNumber = index + 1;

				return (
					<figure key={pageNumber} className="shrink-0">
						{showPageNumbers ? (
							<figcaption className="mb-1 text-[0.625rem] font-medium text-ink-3">
								Page {pageNumber} of {pageCount}
							</figcaption>
						) : null}

						<div
							role={failure ? undefined : "img"}
							aria-label={failure ? undefined : `Loading resume page ${pageNumber} of ${pageCount}`}
							style={pageSize}
							className={cn(
								"flex aspect-page items-center justify-center overflow-hidden rounded-md bg-white text-ink-3",
								pageClassName,
							)}
						>
							{failure ? pageNumber === 1 && failure : <Spinner className="size-10" />}
						</div>
					</figure>
				);
			})}
		</div>
	);
}
