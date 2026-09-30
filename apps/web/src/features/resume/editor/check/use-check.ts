import type { CheckIssue } from "./issues";
import type { AtsReport } from "@reactive-resume/resume/ats";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { useDeferredValue, useMemo } from "react";
import { lintResumeForAts } from "@reactive-resume/resume/ats";
import { buildIssues } from "./issues";
import { useResumeData } from "@/features/resume/builder/draft";

export type CheckResult = { data: ResumeData; report: AtsReport; issues: CheckIssue[] };

/** The live checks on the resume as it is now (deferred, so typing stays smooth), with numbered issues. */
export function useCheck(): CheckResult | null {
	const data = useDeferredValue(useResumeData());

	return useMemo(() => {
		if (!data) return null;
		const report = lintResumeForAts(data);
		return { data, report, issues: buildIssues(report, data) };
	}, [data]);
}

/** Open issues, for the badge on the Check tab. Ignored ones don't count. */
export function useOpenIssueCount(): number {
	const data = useDeferredValue(useResumeData());
	return data ? lintResumeForAts(data).findings.length : 0;
}
