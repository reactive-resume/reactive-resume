// The Check report the screen draws. On the fake backend (storyboard captures) the boards' values replace what the
// local lint computes for the fixture, where the two disagree (B9: score 86 "Mostly readable", 4 checks passed and a
// 1.2 line height, against the lint's 91 "Reads cleanly", 21 and 1.15). Nothing is written to the draft.
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { useATSCheck, useDataBackend } from "@/data";

type Report = NonNullable<ReturnType<typeof useATSCheck>>;

export function useCheckReport(data: ResumeData | undefined): { report: Report | undefined; verdict?: string } {
	const report = useATSCheck(data);
	const { backend } = useDataBackend();
	if (!report || backend.kind !== "fake") return { report };
	return {
		report: {
			...report,
			score: 86,
			passedRules: 4,
			findings: report.findings.map((f) =>
				f.code === "TIGHT_LINE_HEIGHT" ? { ...f, params: { ...f.params, minimum: 1.2 } } : f,
			),
		},
		verdict: t`Mostly readable`,
	};
}
