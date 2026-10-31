import type { WorkspaceTab } from "@reactive-resume/schema/career";
import { t } from "@lingui/core/macro";

/** One label per workspace tab, shared by the tab strip and the tab bodies. */
export const workspaceTabLabel = (tab: WorkspaceTab) =>
	({
		fit: t({ message: "Fit", context: "Application workspace tab: how well a job fits your experience" }),
		apply: t`Apply`,
		prepare: t({ message: "Interview prep", context: "Application workspace tab: plan for an interview" }),
		practise: t({ message: "Practice", context: "Application workspace tab: rehearse interview answers" }),
		debrief: t`Debrief`,
		messages: t`Messages`,
		saved: t({ message: "Library", context: "Application workspace tab: earlier results kept for this job" }),
	})[tab];
