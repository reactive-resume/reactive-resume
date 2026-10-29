export function getScoreColor(score: number): string {
	if (score >= 4.5) return "text-green-600";
	if (score >= 3.5) return "text-amber-600";
	return "text-red-600";
}

export function getEvaluationBadgeClass(score: number): string {
	if (score >= 4.5) return "bg-green-100 text-green-800";
	if (score >= 3.5) return "bg-amber-100 text-amber-800";
	return "bg-red-100 text-red-800";
}

export function getStatusBadgeClass(status: string): { bg: string; text: string; label: string } {
	switch (status) {
		case "not_reviewed":
		case "DRAFT":
			return { bg: "bg-muted", text: "text-muted-foreground", label: "Draft" };
		case "evaluated":
		case "FACULTY_VERIFIED":
			return { bg: "bg-emerald-50", text: "text-emerald-700", label: "Verified" };
		case "submitted":
		case "SUBMITTED_TO_FACULTY":
			return { bg: "bg-primary/10", text: "text-primary", label: "Submitted for Review" };
		case "has_comments":
		case "FACULTY_REVISION_REQUESTED":
			return { bg: "bg-amber-50", text: "text-amber-700", label: "Revision Requested" };
		case "FINALIZED_BY_FACULTY":
			return { bg: "bg-primary/10", text: "text-primary", label: "Finalized / Pending PO" };
		case "SUBMITTED_TO_PO":
			return { bg: "bg-primary/10", text: "text-primary", label: "Submitted to PO" };
		case "PO_REVISION_REQUESTED":
			return { bg: "bg-amber-50", text: "text-amber-700", label: "PO: Revision Requested" };
		case "RESUBMITTED_TO_PO":
			return { bg: "bg-primary/10", text: "text-primary", label: "Resubmitted to PO" };
		case "PO_VERIFIED":
			return { bg: "bg-emerald-50", text: "text-emerald-700", label: "PO Verified" };
		case "APPROVED":
			return { bg: "bg-emerald-50", text: "text-emerald-700", label: "Approved" };
		default:
			return { bg: "bg-muted", text: "text-muted-foreground", label: "Not Reviewed" };
	}
}
