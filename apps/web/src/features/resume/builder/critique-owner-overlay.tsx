import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { RouterOutput } from "@/libs/orpc/client";
import { MapPinIcon } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { cn } from "@reactive-resume/utils/style";
import { PinMarker } from "@/features/resume/public/critique-overlay";
import { PdfViewer } from "@/features/resume/public/pdf-viewer";
import { usePdfPageRects } from "@/hooks/use-pdf-page-rects";
import { CommentStatusActions, StatusBadge } from "./critique-status-actions";

type OwnerComment = RouterOutput["resume"]["critique"]["listAllComments"][number];

type CritiqueOwnerOverlayProps = {
	data: ResumeData;
	comments: OwnerComment[];
	onUpdateStatus: (commentId: string, status: "pending" | "resolved" | "dismissed") => void;
};

// Read-only, cross-critiquer counterpart to CritiqueOverlay: plots every critiquer's pins on the
// resume (colored by status, same convention as the review list) so the owner can see exactly
// where on the page each comment applies, instead of only a page number.
export function CritiqueOwnerOverlay({ data, comments, onUpdateStatus }: CritiqueOwnerOverlayProps) {
	const { wrapperRef, pageRects, recomputeRects } = usePdfPageRects();

	return (
		<div ref={wrapperRef} className="relative">
			<PdfViewer data={data} onLayout={recomputeRects} />

			{[...pageRects.entries()].map(([pageNumber, rect]) => (
				<div
					key={pageNumber}
					className="pointer-events-none absolute print:hidden"
					style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
				>
					{comments
						.filter((comment) => comment.pageNumber === pageNumber)
						.map((comment) => (
							<OwnerCommentPin key={comment.id} comment={comment} onUpdateStatus={onUpdateStatus} />
						))}
				</div>
			))}
		</div>
	);
}

type OwnerCommentPinProps = {
	comment: OwnerComment;
	onUpdateStatus: (commentId: string, status: "pending" | "resolved" | "dismissed") => void;
};

function OwnerCommentPin({ comment, onUpdateStatus }: OwnerCommentPinProps) {
	const statusColor =
		comment.status === "resolved"
			? "bg-primary"
			: comment.status === "dismissed"
				? "bg-muted-foreground"
				: "bg-amber-500";

	return (
		<Popover>
			<PopoverTrigger
				render={
					<PinMarker
						className={cn("text-white", statusColor)}
						style={{ left: `${comment.xNormalized * 100}%`, top: `${comment.yNormalized * 100}%` }}
						aria-label={comment.critiquerDisplayName}
					/>
				}
			>
				<MapPinIcon weight="fill" />
			</PopoverTrigger>

			<PopoverContent className="pointer-events-auto space-y-2">
				<div className="flex items-center justify-between gap-2">
					<span className="font-medium text-sm">{comment.critiquerDisplayName}</span>
					<StatusBadge status={comment.status} />
				</div>
				<p className="text-sm">{comment.body}</p>
				<CommentStatusActions status={comment.status} onUpdateStatus={(status) => onUpdateStatus(comment.id, status)} />
			</PopoverContent>
		</Popover>
	);
}
