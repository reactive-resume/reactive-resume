import { Trans } from "@lingui/react/macro";
import { ArrowCounterClockwiseIcon, CheckCircleIcon, XCircleIcon } from "@phosphor-icons/react";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";

export type CritiqueCommentStatus = "pending" | "resolved" | "dismissed";

// Shared between the review sheet's list rows and the resume-with-pins popover, so the two
// surfaces stay in lockstep as the same comment's status can be changed from either one.
type CommentStatusActionsProps = {
	status: CritiqueCommentStatus;
	size?: "sm" | "default";
	onUpdateStatus: (status: CritiqueCommentStatus) => void;
};

export function CommentStatusActions({ status, size = "sm", onUpdateStatus }: CommentStatusActionsProps) {
	return (
		<div className="flex flex-wrap gap-2">
			{status !== "resolved" && (
				<Button size={size} variant="outline" onClick={() => onUpdateStatus("resolved")}>
					<CheckCircleIcon />
					<Trans>Mark Implemented</Trans>
				</Button>
			)}
			{status !== "dismissed" && (
				<Button size={size} variant="outline" onClick={() => onUpdateStatus("dismissed")}>
					<XCircleIcon />
					<Trans>Dismiss</Trans>
				</Button>
			)}
			{status !== "pending" && (
				<Button size={size} variant="ghost" onClick={() => onUpdateStatus("pending")}>
					<ArrowCounterClockwiseIcon />
					<Trans>Reopen</Trans>
				</Button>
			)}
		</div>
	);
}

export function StatusBadge({ status }: { status: CritiqueCommentStatus }) {
	switch (status) {
		case "resolved": {
			return (
				<Badge variant="default">
					<Trans>Resolved</Trans>
				</Badge>
			);
		}
		case "dismissed": {
			return (
				<Badge variant="destructive">
					<Trans>Dismissed</Trans>
				</Badge>
			);
		}
		default: {
			return (
				<Badge variant="secondary">
					<Trans>Pending</Trans>
				</Badge>
			);
		}
	}
}
