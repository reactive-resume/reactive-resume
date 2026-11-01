/**
 * Why a submitted document cannot be replaced. Shared by the server throws and both clients so a typo cannot
 * silently turn a specific recovery message back into the generic one.
 */
export const SUBMITTED_DOCUMENT_LOCKED = "SUBMITTED_DOCUMENT_LOCKED" as const;

export function isSubmittedDocumentLocked(value: unknown): boolean {
	return value === SUBMITTED_DOCUMENT_LOCKED;
}
