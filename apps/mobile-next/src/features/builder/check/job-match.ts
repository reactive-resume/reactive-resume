// Job match (B10), ported from apps/web/src/features/resume/editor/check/job-match.tsx: the posting of the linked
// application (or one chosen or pasted for this visit), its terms sorted into found and missing. Terms hidden as
// "Not true for me" are left out. It isn't part of the score.
import type { JdTermMatch } from "@reactive-resume/resume/ats-pdf";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { useApplication, useDataBackend } from "@/data";

export type MatchedTerm = JdTermMatch & { label: string };
const loadEngine = () => import("@reactive-resume/resume/ats-pdf");

function termAsWritten(forms: readonly string[], posting: string): string | undefined {
	for (const form of forms) {
		const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const found = posting.match(new RegExp(escaped, "i"))?.[0];
		if (found) return found;
	}
	return undefined;
}

/**
 * The fake backend's applications carry no posting text, so storyboard captures draw the board's match (B10: 9 of
 * 14, three missing terms; two more are hidden as "Not true for me"). A term added to the resume moves to found.
 */
const boardFound = [
	"Design systems",
	"Prototyping",
	"User research",
	"Interaction design",
	"Figma",
	"Accessibility",
	"Onboarding",
	"Payments",
	"Product strategy",
];
const boardMissing = ["Accessibility audits", "Design tokens", "Workshop facilitation"];
const boardTotal = 14;
const boardTerm = (label: string, inResume: boolean): MatchedTerm => ({
	term: label.toLowerCase(),
	label,
	jdCount: 1,
	resumeCount: inResume ? 1 : 0,
	weight: 1,
});
function boardMatch(resumeText: string, hidden: readonly string[]) {
	const text = resumeText.toLowerCase();
	const missing = boardMissing
		.filter((label) => !hidden.includes(label.toLowerCase()))
		.map((label) => boardTerm(label, text.includes(label.toLowerCase())));
	return {
		found: [...boardFound.map((label) => boardTerm(label, true)), ...missing.filter((term) => term.resumeCount > 0)],
		missing: missing.filter((term) => term.resumeCount === 0),
		total: boardTotal,
	};
}

export function useJobMatch(data: ResumeData | null, applicationId: string | null, pasted: string) {
	const application = useApplication(applicationId ?? "");
	const app = applicationId ? (application.data ?? null) : null;
	const posting = applicationId ? (app?.jobDescription ?? "").trim() : pasted.trim();
	const engine = useQuery({
		queryKey: ["ats-pdf-engine"],
		queryFn: loadEngine,
		staleTime: Number.POSITIVE_INFINITY,
		enabled: !!posting,
	});
	const hidden = data?.metadata.check?.hiddenTerms;
	const resumeText = useMemo(() => (data ? buildMarkdown(data) : ""), [data]);
	const board = useDataBackend().backend.kind === "fake" && !!applicationId && !posting;
	const result = useMemo(() => {
		if (board) return boardMatch(resumeText, hidden ?? []);
		const e = engine.data;
		if (!e || !posting) return null;
		const skip = new Set(hidden ?? []);
		const terms = e
			.matchJobDescription({
				jobDescription: posting,
				resumeText,
				company: app?.company,
				location: app?.location ?? undefined,
				role: app?.role,
			})
			.terms.filter((term) => !skip.has(term.term))
			.map((term) => ({ ...term, label: termAsWritten(e.surfaceFormsOf(term.term), posting) ?? term.term }));
		return {
			found: terms.filter((term) => term.resumeCount > 0),
			missing: terms.filter((term) => term.resumeCount === 0),
			total: terms.length,
		};
	}, [board, engine.data, posting, resumeText, hidden, app?.company, app?.location, app?.role]);
	return {
		application: app,
		posting,
		result,
		reading: !!posting && engine.isPending,
		loading: !!applicationId && application.isPending,
	};
}
