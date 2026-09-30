import type { JdMatchReport } from "@reactive-resume/resume/ats-pdf";
import { Trans } from "@lingui/react/macro";
import { Badge } from "@reactive-resume/ui/components/badge";

type JdCoverageProps = {
	jd: JdMatchReport;
};

/**
 * Keyword coverage, reported as a count rather than a percentage of anything.
 *
 * Deliberately kept apart from the score: how well a resume matches one posting's vocabulary is a
 * different question from whether software can read the file, and blending them would make both
 * numbers mean less.
 */
export function JdCoverage({ jd }: JdCoverageProps) {
	if (jd.totalTerms === 0) {
		return (
			<p className="rounded-md border border-dashed p-3 text-xs leading-normal text-ink-3">
				<Trans>
					No specific terms could be pulled out of that job description, so it may be mostly boilerplate. Paste the
					requirements section for a more useful comparison.
				</Trans>
			</p>
		);
	}

	const matched = jd.terms.filter((term) => term.resumeCount > 0);
	const missing = jd.terms.filter((term) => term.resumeCount === 0);

	return (
		<div className="space-y-3 rounded-md border bg-surface p-3">
			<div className="space-y-1">
				<p className="text-sm leading-none font-medium">
					<Trans>
						{jd.matchedCount} of {jd.totalTerms} terms found
					</Trans>
				</p>
				<p className="text-xs leading-normal text-ink-3">
					<Trans>Counted separately from the parse score. Coverage does not predict anything.</Trans>
				</p>
			</div>

			{missing.length > 0 && (
				<div className="space-y-1.5">
					<p className="text-xs font-medium text-ink-3">
						<Trans>Not in your resume</Trans>
					</p>
					<div className="flex flex-wrap gap-1.5">
						{missing.map((term) => (
							<Badge key={term.term} variant="outline" className="font-normal">
								{term.term}
							</Badge>
						))}
					</div>
				</div>
			)}

			{matched.length > 0 && (
				<div className="space-y-1.5">
					<p className="text-xs font-medium text-ink-3">
						<Trans>Already covered</Trans>
					</p>
					<div className="flex flex-wrap gap-1.5">
						{matched.map((term) => (
							<Badge key={term.term} variant="neutral" className="font-normal">
								{term.term}
							</Badge>
						))}
					</div>
				</div>
			)}

			{jd.stuffedTerms.length > 0 && (
				<p className="text-xs leading-normal text-ink-3">
					<Trans>
						Repeated far more often than the posting itself uses them: {jd.stuffedTerms.join(", ")}. Recruiters notice.
					</Trans>
				</p>
			)}

			{jd.documentHasHiddenText && (
				<p className="text-xs leading-normal text-ink-3">
					<Trans>This file contains text a reader cannot see, so some of these matches may be against it.</Trans>
				</p>
			)}
		</div>
	);
}
