// Job match (B10), ported from apps/web/src/features/resume/editor/check/job-match.tsx: the posting of the linked
// application (or one chosen or pasted for this visit), its terms sorted into found and missing. Terms hidden as
// "Not true for me" are left out. It isn't part of the score.
import type { JdTermMatch } from "@reactive-resume/resume/ats-pdf";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { useApplication } from "@/data";

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
	const result = useMemo(() => {
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
	}, [engine.data, posting, resumeText, hidden, app?.company, app?.location, app?.role]);
	return {
		application: app,
		posting,
		result,
		reading: !!posting && engine.isPending,
		loading: !!applicationId && application.isPending,
	};
}
