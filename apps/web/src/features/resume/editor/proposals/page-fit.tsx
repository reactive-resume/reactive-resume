import type { PageMap } from "@reactive-resume/pdf/page-map";
import type { Proposal } from "@reactive-resume/resume/proposals";
import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { measureProposalPageFit } from "@reactive-resume/pdf/page-map";
import { useResumeStore } from "@/features/resume/builder/draft";
import { createResumePdfBlob } from "@/features/resume/export/pdf-document";

type ProposalPageFitProps = { resumeId: string; proposals: readonly Proposal[] };

export function ProposalPageFit({ resumeId, proposals }: ProposalPageFitProps) {
	const data = useResumeStore((state) => (state.resume?.id === resumeId ? state.resume.data : null));
	const fit = useQuery({
		queryKey: ["proposal-page-fit", resumeId, data, proposals],
		enabled: data !== null && proposals.length > 0,
		staleTime: Infinity,
		retry: false,
		queryFn: () => {
			if (!data) throw new Error("Resume not open");
			return measureProposalPageFit(data, proposals, async (candidate) => {
				let map: PageMap | undefined;
				await createResumePdfBlob(candidate, undefined, {
					onPageMap: (value) => {
						map = value;
					},
				});
				if (!map) throw new Error("Page map unavailable");
				return map;
			});
		},
	});
	if (!data || !proposals.length) return null;
	const change =
		fit.data?.lines === null || fit.data?.lines === undefined
			? null
			: `${fit.data.lines > 0 ? "+" : ""}${fit.data.lines}`;
	return (
		<p role="status" className="text-xs text-ink-3">
			{fit.data
				? t`Page fit: ${fit.data.before} → ${fit.data.after} printed pages.`
				: fit.isError
					? t`Couldn't measure page fit. Check the page preview before accepting.`
					: t`Measuring page fit…`}
			{change !== null && ` ${t`Estimated overflow change: ${change} lines.`}`}
		</p>
	);
}
