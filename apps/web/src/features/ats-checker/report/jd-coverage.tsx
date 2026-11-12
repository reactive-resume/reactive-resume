import type { JdMatchReport } from "@reactive-resume/resume/ats-pdf";
import { i18n } from "@lingui/core";
import { Trans } from "@lingui/react/macro";
import { Chip } from "@/components/calm/filter-bar";

type JdCoverageProps = {
	jd: JdMatchReport;
};

/**
 * Job match: the terms a pasted posting stresses, found in the file's text or not. A count, never a score: how well a
 * resume matches one posting's vocabulary is a different question from whether software can read the file.
 */
export function JdCoverage({ jd }: JdCoverageProps) {
	if (jd.totalTerms === 0) {
		return (
			<p className="text-ink-3 t-small">
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
		<div className="flex flex-col">
			<h3 className="font-display text-2xl/[30px]">
				<Trans>
					{i18n.number(jd.matchedCount)} of {i18n.number(jd.totalTerms)} terms found
				</Trans>
			</h3>
			<p className="pt-1 text-ink-3 t-small">
				<Trans>Terms the pasted posting stresses, looked for in your file's text.</Trans>
			</p>

			{matched.length > 0 && (
				<>
					<p className="pt-4 pb-1.5 font-semibold t-small">
						<Trans>In your resume</Trans>
					</p>
					<ul className="flex flex-wrap gap-1.5">
						{matched.map((term) => (
							<Chip key={term.term} render={<li />}>
								{term.term}
							</Chip>
						))}
					</ul>
				</>
			)}

			{missing.length > 0 && (
				<>
					<p className="pt-4 pb-1.5 font-semibold t-small">
						<Trans>Not found</Trans>
					</p>
					<ul className="flex flex-wrap gap-1.5">
						{missing.map((term) => (
							<Chip key={term.term} variant="dash" render={<li />}>
								{term.term}
							</Chip>
						))}
					</ul>
				</>
			)}

			<p className="pt-3 text-xs/4 text-ink-3">
				{missing.length > 0 ? (
					<Trans>Add a term only where it is true of your work.</Trans>
				) : (
					<Trans>Every term the posting stresses is already there.</Trans>
				)}
			</p>

			{jd.stuffedTerms.length > 0 && (
				<p className="pt-2 text-xs/4 text-ink-3">
					<Trans>
						Repeated far more often than the posting itself uses them: {jd.stuffedTerms.join(", ")}. Recruiters notice.
					</Trans>
				</p>
			)}

			{jd.documentHasHiddenText && (
				<p className="pt-2 text-xs/4 text-ink-3">
					<Trans>This file contains text a reader cannot see, so some of these matches may be against it.</Trans>
				</p>
			)}
		</div>
	);
}
