import { ZodError } from "zod";

const MAX_LISTED_ISSUES = 3;

type Issue = ZodError["issues"][number];

const describeIssuePath = (path: ReadonlyArray<PropertyKey>): string =>
	path.length > 0 ? path.map((segment) => String(segment)).join(".") : "the document";

/** The listed field paths and messages, capped, with a count of whatever didn't fit. */
const listIssues = (issues: readonly Issue[]): string => {
	const listed = issues
		.slice(0, MAX_LISTED_ISSUES)
		.map((issue) => `${describeIssuePath(issue.path)} (${issue.message})`)
		.join(", ");
	const remaining = issues.length - MAX_LISTED_ISSUES;
	const suffix = remaining > 0 ? `, and ${remaining} more field${remaining === 1 ? "" : "s"}` : "";
	return `${listed}${suffix}`;
};

/** Builds a short, human-readable summary from a ZodError instead of a raw JSON dump. */
const summarizeZodError = (error: ZodError): string => {
	if (error.issues.length === 0)
		return "This file isn't a valid resume. Check that it matches the selected format, then try again.";

	const listed = listIssues(error.issues);

	// Root-level issues have an empty path (rendered as "the document"); use a
	// singular label for them so the sentence stays grammatical.
	const allAtRoot = error.issues.slice(0, MAX_LISTED_ISSUES).every((issue) => issue.path.length === 0);
	const prefix = allAtRoot ? "Problem" : "Problem fields";
	return `This file isn't a valid resume. ${prefix}: ${listed}. Fix these fields, or choose the matching format.`;
};

/**
 * The issues a message hasn't already explained, for callers that replace one issue with friendlier wording. Returns
 * null when nothing else is wrong, so the caller keeps its own message alone.
 */
export function summarizeOtherIssues(error: ZodError, explained: Issue | undefined): string | null {
	const issues = error.issues.filter((issue) => issue !== explained);
	if (issues.length === 0) return null;
	return `Other problem${issues.length === 1 ? "" : "s"}: ${listIssues(issues)}.`;
}

/** Rethrows a ZodError as a human-readable import error; re-throws other errors as-is. */
export function rethrowAsImportError(error: unknown): never {
	if (error instanceof ZodError) {
		throw new Error(summarizeZodError(error));
	}
	throw error;
}
