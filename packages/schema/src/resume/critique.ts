import z from "zod";

// Fixed status for an owner's response to a critique comment; stored as text per repo convention
// (see ApplicationStatus). "pending" is the default until the owner acts on it.
export const critiqueCommentStatusSchema = z.enum(["pending", "resolved", "dismissed"]);

export type CritiqueCommentStatus = z.infer<typeof critiqueCommentStatusSchema>;

export const CRITIQUE_COMMENT_STATUSES = [
	{ value: "pending", label: "Pending", color: "oklch(0.62 0 0)" },
	{ value: "resolved", label: "Resolved", color: "oklch(0.55 0.15 152)" },
	{ value: "dismissed", label: "Dismissed", color: "oklch(0.63 0.12 22)" },
] as const satisfies ReadonlyArray<{ value: CritiqueCommentStatus; label: string; color: string }>;
