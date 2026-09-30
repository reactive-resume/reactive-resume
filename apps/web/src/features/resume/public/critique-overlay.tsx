import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ChatCircleTextIcon, CheckIcon, MapPinIcon, PencilSimpleIcon, TrashIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { cn } from "@reactive-resume/utils/style";
import { useConfirm } from "@/hooks/use-confirm";
import { usePdfPageRects } from "@/hooks/use-pdf-page-rects";
import { PdfViewer } from "./pdf-viewer";

type CritiqueComment = RouterOutput["resume"]["critique"]["getCritiqueView"]["comments"][number];
type PagePin = { pageNumber: number; xNormalized: number; yNormalized: number };

type CritiqueOverlayProps = {
	data: ResumeData;
	publicResume: { username: string; slug: string };
	comments: CritiqueComment[];
	onAdd: (input: PagePin & { body: string }) => Promise<void>;
	onEdit: (commentId: string, body: string) => Promise<void>;
	onDelete: (commentId: string) => Promise<void>;
};

export function CritiqueOverlay({ data, publicResume, comments, onAdd, onEdit, onDelete }: CritiqueOverlayProps) {
	const { wrapperRef, pageRects, recomputeRects } = usePdfPageRects();
	const [isPlacing, setIsPlacing] = useState(false);
	const [pendingPin, setPendingPin] = useState<PagePin | null>(null);

	const onWrapperClick = (event: React.MouseEvent<HTMLDivElement>) => {
		if (!isPlacing) return;

		const pageElement = (event.target as HTMLElement).closest<HTMLElement>(".page");
		if (!pageElement) return;

		const pageNumber = Number(pageElement.dataset.pageNumber) || 1;
		const rect = pageElement.getBoundingClientRect();

		setPendingPin({
			pageNumber,
			xNormalized: (event.clientX - rect.left) / rect.width,
			yNormalized: (event.clientY - rect.top) / rect.height,
		});
		setIsPlacing(false);
	};

	return (
		<div className="relative">
			{/* This bar sits on the resume's own forced-white background (it must render correctly
			 in print/PDF-parity contexts), independent of the app's light/dark theme, so its
			 idle "outline" state can't rely on theme-relative foreground/border tokens — those
			 resolve to near-white in dark mode and disappear against the white page. */}
			<div className="mb-3 flex justify-end print:hidden">
				<Button
					variant={isPlacing ? "default" : "outline"}
					className={isPlacing ? undefined : "border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-100"}
					onClick={() => {
						setPendingPin(null);
						setIsPlacing((value) => !value);
					}}
				>
					<ChatCircleTextIcon />
					{isPlacing ? <Trans>Click anywhere on the resume</Trans> : <Trans>Add Comment</Trans>}
				</Button>
			</div>

			{/* biome-ignore lint/a11y/noStaticElementInteractions: pointer-coordinate pin placement has no keyboard equivalent; every pin/compose control underneath is its own focusable button. */}
			<div
				ref={wrapperRef}
				className={cn("relative", isPlacing && "cursor-crosshair")}
				onClick={onWrapperClick}
				onKeyDown={(event) => {
					if (event.key === "Escape") setIsPlacing(false);
				}}
			>
				<PdfViewer data={data} publicResume={publicResume} onLayout={recomputeRects} />

				{[...pageRects.entries()].map(([pageNumber, rect]) => (
					<div
						key={pageNumber}
						className="pointer-events-none absolute print:hidden"
						style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
					>
						{comments
							.filter((comment) => comment.pageNumber === pageNumber)
							.map((comment) => (
								<CommentPin key={comment.id} comment={comment} onEdit={onEdit} onDelete={onDelete} />
							))}

						{pendingPin?.pageNumber === pageNumber && (
							<ComposePin
								position={pendingPin}
								onCancel={() => setPendingPin(null)}
								onSubmit={async (body) => {
									await onAdd({ ...pendingPin, body });
									setPendingPin(null);
								}}
							/>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

export function PinMarker({ className, ...props }: React.ComponentProps<"button">) {
	return (
		<button
			type="button"
			// Explicit white ring, not the theme-relative `border-background` — pins always sit on
			// the resume's forced-white page, regardless of the app's light/dark theme.
			className={cn(
				"pointer-events-auto absolute flex size-7 -translate-x-1/2 -translate-y-full items-center justify-center rounded-full border-2 border-white shadow-md transition-transform hover:scale-110",
				className,
			)}
			{...props}
		/>
	);
}

type CommentPinProps = {
	comment: CritiqueComment;
	onEdit: (commentId: string, body: string) => Promise<void>;
	onDelete: (commentId: string) => Promise<void>;
};

function CommentPin({ comment, onEdit, onDelete }: CommentPinProps) {
	const confirm = useConfirm();
	const [isOpen, setIsOpen] = useState(false);
	const [isEditing, setIsEditing] = useState(false);
	const [body, setBody] = useState(comment.body);

	const statusColor =
		comment.status === "resolved"
			? "bg-primary"
			: comment.status === "dismissed"
				? "bg-muted-foreground"
				: "bg-amber-500";

	return (
		<Popover
			open={isOpen}
			onOpenChange={(open) => {
				setIsOpen(open);
				if (!open) {
					setIsEditing(false);
					setBody(comment.body);
				}
			}}
		>
			<PopoverTrigger
				render={
					<PinMarker
						className={cn("text-white", statusColor)}
						style={{ left: `${comment.xNormalized * 100}%`, top: `${comment.yNormalized * 100}%` }}
						aria-label={t`View comment`}
					/>
				}
			>
				<MapPinIcon weight="fill" />
			</PopoverTrigger>

			<PopoverContent className="pointer-events-auto">
				{isEditing ? (
					<div className="space-y-2">
						<Textarea autoFocus value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} />
						<div className="flex justify-end gap-2">
							<Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
								<Trans>Cancel</Trans>
							</Button>
							<Button
								size="sm"
								disabled={!body.trim()}
								onClick={() => void onEdit(comment.id, body.trim()).then(() => setIsEditing(false))}
							>
								<CheckIcon />
								<Trans>Save</Trans>
							</Button>
						</div>
					</div>
				) : (
					<div className="space-y-2">
						<p className="text-sm">{comment.body}</p>
						{comment.status !== "pending" && (
							<p className="text-muted-foreground text-xs">
								{comment.status === "resolved" ? (
									<Trans>The resume owner marked this as implemented.</Trans>
								) : (
									<Trans>The resume owner dismissed this comment.</Trans>
								)}
							</p>
						)}
						{comment.status === "pending" && (
							<div className="flex justify-end gap-2">
								<Button
									size="sm"
									variant="ghost"
									onClick={async () => {
										const confirmed = await confirm(t`Delete this comment?`, {
											confirmText: t`Delete`,
											cancelText: t`Cancel`,
										});
										if (confirmed) await onDelete(comment.id);
									}}
								>
									<TrashIcon />
									<Trans>Delete</Trans>
								</Button>
								<Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
									<PencilSimpleIcon />
									<Trans>Edit</Trans>
								</Button>
							</div>
						)}
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

type ComposePinProps = {
	position: PagePin;
	onSubmit: (body: string) => Promise<void>;
	onCancel: () => void;
};

function ComposePin({ position, onSubmit, onCancel }: ComposePinProps) {
	const [body, setBody] = useState("");
	const [isSubmitting, setIsSubmitting] = useState(false);

	return (
		<Popover
			open
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
		>
			<PopoverTrigger
				render={
					<PinMarker
						className="bg-primary text-primary-foreground"
						style={{ left: `${position.xNormalized * 100}%`, top: `${position.yNormalized * 100}%` }}
						aria-label={t`New comment`}
					/>
				}
			>
				<MapPinIcon weight="fill" />
			</PopoverTrigger>

			<PopoverContent className="pointer-events-auto">
				<div className="space-y-2">
					<Textarea
						autoFocus
						placeholder={t`Leave a comment...`}
						value={body}
						maxLength={2000}
						disabled={isSubmitting}
						onChange={(event) => setBody(event.target.value)}
					/>
					<div className="flex justify-end gap-2">
						<Button size="sm" variant="ghost" disabled={isSubmitting} onClick={onCancel}>
							<XIcon />
							<Trans>Cancel</Trans>
						</Button>
						<Button
							size="sm"
							disabled={!body.trim() || isSubmitting}
							onClick={async () => {
								setIsSubmitting(true);
								try {
									await onSubmit(body.trim());
								} finally {
									setIsSubmitting(false);
								}
							}}
						>
							<CheckIcon />
							<Trans>Post</Trans>
						</Button>
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
