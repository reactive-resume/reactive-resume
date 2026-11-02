import type { Proposal } from "@reactive-resume/resume/proposals";
import { t } from "@lingui/core/macro";
import { useQuery } from "@tanstack/react-query";
import { measureProposalPageFit } from "@reactive-resume/pdf/page-map";
import { useResumeStore } from "@/draft";
import { measureResume } from "@/preview/fit";
import { Text } from "@/ui";

type ProposalPageFitProps = { resumeId: string; proposals: readonly Proposal[] };

export function ProposalPageFit({ resumeId, proposals }: ProposalPageFitProps) {
	const data = useResumeStore((state) => (state.document?.id === resumeId ? state.data : null));
	const fit = useQuery({
		queryKey: ["proposal-page-fit", resumeId, data, proposals],
		enabled: data !== null && proposals.length > 0,
		staleTime: Infinity,
		retry: false,
		queryFn: () => {
			if (!data) throw new Error("Resume not open");
			return measureProposalPageFit(data, proposals, measureResume);
		},
	});
	if (!data || !proposals.length) return null;
	const change =
		fit.data?.lines === null || fit.data?.lines === undefined
			? null
			: `${fit.data.lines > 0 ? "+" : ""}${fit.data.lines}`;
	return (
		<Text accessibilityLiveRegion="polite" variant="caption" color="ink3">
			{fit.data
				? t`Page fit: ${fit.data.before} → ${fit.data.after} printed pages.`
				: fit.isError
					? t`Couldn't measure page fit. Check the page preview before accepting.`
					: t`Measuring page fit…`}
			{change !== null && ` ${t`Estimated overflow change: ${change} lines.`}`}
		</Text>
	);
}
