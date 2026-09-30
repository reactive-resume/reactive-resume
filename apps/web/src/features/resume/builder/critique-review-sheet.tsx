import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { CritiqueCommentStatus } from "./critique-status-actions";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { ChatCircleTextIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@reactive-resume/ui/components/empty";
import { ScrollArea } from "@reactive-resume/ui/components/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@reactive-resume/ui/components/sheet";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { toast } from "@reactive-resume/ui/components/toast";
import { orpc } from "@/libs/orpc/client";
import { CommentStatusActions, StatusBadge } from "./critique-status-actions";

// Code-split: pulls in the PDF.js/react-pdf rendering pipeline, which the Sharing section
// (always part of the builder bundle) shouldn't have to load until the owner opens Feedback.
const CritiqueOwnerOverlay = lazy(() =>
	import("./critique-owner-overlay").then((module) => ({ default: module.CritiqueOwnerOverlay })),
);

type CritiqueReviewSheetProps = {
	resumeId: string;
	resumeData: ResumeData;
	onClose: () => void;
};

export function CritiqueReviewSheet({ resumeId, resumeData, onClose }: CritiqueReviewSheetProps) {
	const queryClient = useQueryClient();
	const listQueryOptions = orpc.resume.critique.listAllComments.queryOptions({ input: { resumeId }, staleTime: 0 });
	const { data: comments, isLoading } = useQuery(listQueryOptions);

	const { mutateAsync: updateStatus } = useMutation(
		orpc.resume.critique.updateCommentStatus.mutationOptions({
			onSuccess: () => queryClient.invalidateQueries({ queryKey: listQueryOptions.queryKey }),
		}),
	);

	const onUpdateStatus = async (commentId: string, status: CritiqueCommentStatus) => {
		try {
			await updateStatus({ resumeId, commentId, status });
		} catch (error) {
			const message = error instanceof ORPCError ? error.message : t`Something went wrong. Please try again.`;
			toast.add({ type: "error", description: message });
		}
	};

	const groups = new Map<string, NonNullable<typeof comments>>();
	for (const comment of comments ?? []) {
		const existing = groups.get(comment.critiquerDisplayName) ?? [];
		existing.push(comment);
		groups.set(comment.critiquerDisplayName, existing);
	}

	return (
		<Sheet open onOpenChange={(open) => !open && onClose()}>
			{/* SheetContent's own base classes set data-[side=right]:sm:max-w-sm, which — because it's
			 scoped to an attribute selector — beats a plain sm:max-w-* override on specificity alone.
			 Overriding it requires matching that same variant chain. */}
			<SheetContent className="flex w-full flex-col gap-0 data-[side=right]:sm:max-w-6xl">
				<SheetHeader>
					<SheetTitle>
						<Trans>Feedback</Trans>
					</SheetTitle>
					<SheetDescription>
						<Trans>Comments left by people you've shared your feedback link with. Pins show where on the page.</Trans>
					</SheetDescription>
				</SheetHeader>

				{isLoading ? (
					<div className="flex flex-1 items-center justify-center">
						<Spinner className="size-6" />
					</div>
				) : groups.size === 0 ? (
					<Empty className="flex-1">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<ChatCircleTextIcon />
							</EmptyMedia>
							<EmptyTitle>
								<Trans>No feedback yet</Trans>
							</EmptyTitle>
							<EmptyDescription>
								<Trans>Comments will show up here once someone leaves feedback on your resume.</Trans>
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
						<ScrollArea className="flex-1 border-b bg-neutral-100 lg:border-e lg:border-b-0">
							<div className="p-4">
								<Suspense
									fallback={
										<div className="flex justify-center py-8">
											<Spinner className="size-6" />
										</div>
									}
								>
									<CritiqueOwnerOverlay
										data={resumeData}
										comments={comments ?? []}
										onUpdateStatus={(commentId, status) => void onUpdateStatus(commentId, status)}
									/>
								</Suspense>
							</div>
						</ScrollArea>

						<ScrollArea className="w-full px-4 lg:max-w-sm">
							<div className="space-y-6 py-4">
								{[...groups.entries()].map(([displayName, groupComments]) => (
									<div key={displayName} className="space-y-3">
										<h3 className="font-medium text-sm">
											{displayName} <span className="text-muted-foreground">({groupComments.length})</span>
										</h3>

										<div className="space-y-2">
											{groupComments.map((comment) => (
												<div key={comment.id} className="space-y-2 rounded-md border p-3">
													<div className="flex items-center justify-between gap-2">
														<Badge variant="outline">
															<Trans>Page {comment.pageNumber}</Trans>
														</Badge>
														<StatusBadge status={comment.status} />
													</div>

													<p className="text-sm">{comment.body}</p>

													<CommentStatusActions
														status={comment.status}
														onUpdateStatus={(status) => void onUpdateStatus(comment.id, status)}
													/>
												</div>
											))}
										</div>
									</div>
								))}
							</div>
						</ScrollArea>
					</div>
				)}
			</SheetContent>
		</Sheet>
	);
}
