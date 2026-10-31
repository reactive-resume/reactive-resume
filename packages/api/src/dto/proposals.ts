import z from "zod";
import { MAX_REVIEWED_WORDING } from "@reactive-resume/resume/proposals";

/** Document saves atomically record assistant acceptance and explicit Undo/Redo outcomes. */
export const proposalApplicationsSchema = z
	.record(z.string().min(1).max(128), z.union([z.boolean(), z.string().max(MAX_REVIEWED_WORDING)]))
	.optional()
	.describe(
		"Assistant edit decisions saved with this change, by edit id: false takes an edit back; the edit's current after (the wording you applied), or snapshot:<id> for an immutable structural proposal, records it as accepted, refined or not. Structural summaries from prior clients remain accepted within the 20000-character receipt limit. true records acceptance only when the saved document holds the edit exactly as proposed (a structural change: its whole snapshot.after). Tailoring the document can't take is refused either way.",
	);

/**
 * Sent by apps that check assistant edits before applying them: they never apply tailored edits a resume can't accept
 * and apply only an edit's current wording. A document with edits an older app could apply wrongly (tailoring it can't
 * accept, or wording changed since) refuses content saves without it, before anything is written: the older app sees
 * a version conflict, keeps its draft as a copy, and needs a refresh or update to keep editing that document.
 */
export const proposalSafetySchema = z
	.literal("v1")
	.optional()
	.describe(
		'Send "v1" when your client applies assistant edits only through proposalApplications or after checking tailoredFor and the edit\'s current after. Documents with tailored or reworded assistant edits refuse content changes without it (RESUME_VERSION_CONFLICT, or CONFLICT for letters).',
	);
