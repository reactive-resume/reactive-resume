/**
 * The application a document editor was opened from, only when that application really links this document. A stale,
 * foreign or tampered `applicationId` returns null, so Back never lands on an unrelated application.
 */
export function applicationOrigin(
	kind: "resume" | "letter",
	documentId: string,
	application: { id: string; resumeId: string | null; coverLetterId: string | null } | null | undefined,
) {
	if (!application) return null;
	const linked = kind === "resume" ? application.resumeId === documentId : application.coverLetterId === documentId;
	return linked ? { id: application.id } : null;
}
