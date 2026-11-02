import type { CommentSeverity } from "./comment-anchor";

/**
 * The standard feedback a reviewer can send on each resume section, one click each.
 *
 * These are curated by the placement team and ship with the app rather than living in
 * `review_snippet`: that table is per-tenant, has no section of its own, and lets any reviewer
 * delete a row for everybody. It stays as it is — for the snippets reviewers write themselves.
 *
 * `severity` is taken from the weight of the checklist item each line enforces, so the common
 * case needs no second click: weight 3 is HIGH, weight 2 MEDIUM, weight 1 LOW. The reviewer can
 * still override it before sending.
 */
export type ReviewSuggestion = {
	/** Stable id. Used to tell apart two suggestions with the same opening words. */
	id: string;
	/** Resume section key this belongs to, matching `CommentAnchor["section"]`. */
	section: string;
	content: string;
	severity: CommentSeverity;
	/** The checklist item this enforces, shown to the reviewer as provenance. */
	checklistItem: number;
};

export const REVIEW_SUGGESTIONS: readonly ReviewSuggestion[] = [
	// ── Career Objective ────────────────────────────────────────────────────────
	{
		id: "summary-heading",
		section: "summary",
		content:
			"Rename this section to “Career Objective” — invented headings like “Professional Summary” are not recognised by resume parsers.",
		severity: "LOW",
		checklistItem: 7,
	},
	{
		id: "summary-generic-three-lines",
		section: "summary",
		content:
			"Keep it generic so it suits every company you apply to. Mention your main strengths and complete it within 3 lines.",
		severity: "MEDIUM",
		checklistItem: 9,
	},

	// ── Education ───────────────────────────────────────────────────────────────
	{
		id: "education-cgpa",
		section: "education",
		content: "Add your CGPA on its stated scale (e.g. 8.6/10) and the duration (2024–2028) for B.Tech.",
		severity: "MEDIUM",
		checklistItem: 2,
	},
	{
		id: "education-inter-ssc",
		section: "education",
		content: "Add your Intermediate and SSC details also — percentage and year of passing.",
		severity: "MEDIUM",
		checklistItem: 2,
	},

	// ── Projects ────────────────────────────────────────────────────────────────
	{
		id: "projects-at-least-four",
		section: "projects",
		content:
			"List at least 4 projects. Each needs a title, tech stack, duration and 2–3 bullets, with a GitHub or live link on at least two.",
		severity: "HIGH",
		checklistItem: 4,
	},
	{
		id: "projects-result-first",
		section: "projects",
		content:
			"Open each description with the result — the accuracy or outcome, where there is one — then the process you followed.",
		severity: "HIGH",
		checklistItem: 5,
	},

	// ── Internships (the resume's `experience` section) ─────────────────────────
	{
		id: "experience-rename-internships",
		section: "experience",
		content: "Rename the “Experience” section to “Internships” — that is where your internships belong.",
		severity: "LOW",
		checklistItem: 7,
	},
	{
		id: "experience-company-role-dates",
		section: "experience",
		content: "List each internship with company, role and dates.",
		severity: "HIGH",
		checklistItem: 4,
	},

	// ── Certifications ──────────────────────────────────────────────────────────
	{
		id: "certifications-mention-all",
		section: "certifications",
		content: "Mention all the certifications you have done so far in college.",
		severity: "MEDIUM",
		checklistItem: 10,
	},
	{
		id: "certifications-body-and-year",
		section: "certifications",
		content: "Give the awarding body and the year, plus the score or percentile where there is one.",
		severity: "MEDIUM",
		checklistItem: 10,
	},

	// ── Skills ──────────────────────────────────────────────────────────────────
	{
		id: "skills-hands-on",
		section: "skills",
		content:
			"List the technologies and tools you have worked on hands-on — only what you can be questioned on in an interview.",
		severity: "HIGH",
		checklistItem: 3,
	},
	{
		id: "skills-grouped",
		section: "skills",
		content:
			"Group them under headings — Languages, Frameworks, Databases, Tools. Remove star ratings and progress bars.",
		severity: "HIGH",
		checklistItem: 3,
	},
];

/** Sections that have standard feedback, in the order a resume is read. */
export const SUGGESTION_SECTIONS: readonly { key: string; label: string }[] = [
	{ key: "summary", label: "Career Objective" },
	{ key: "education", label: "Education" },
	{ key: "projects", label: "Projects" },
	{ key: "experience", label: "Internships" },
	{ key: "certifications", label: "Certifications" },
	{ key: "skills", label: "Skills" },
];

/**
 * The standard feedback for one section.
 *
 * A custom section follows a built-in type and carries its own id, so an anchor can name something
 * like `custom.abc123`; falling back to the part before the dot keeps those working.
 */
export function suggestionsForSection(section: string | null | undefined): readonly ReviewSuggestion[] {
	if (!section) return [];
	const exact = REVIEW_SUGGESTIONS.filter((s) => s.section === section);
	if (exact.length > 0) return exact;
	const base = section.split(".")[0];
	return REVIEW_SUGGESTIONS.filter((s) => s.section === base);
}

/** Label for a section key, for the picker shown on a comment with no anchor. */
export function suggestionSectionLabel(section: string): string {
	return SUGGESTION_SECTIONS.find((s) => s.key === section)?.label ?? section;
}
