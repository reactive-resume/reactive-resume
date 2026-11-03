import type { AiAction, AiUsageSummary } from "@reactive-resume/schema/ai-usage";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";

export const aiActionLabel = (action: AiAction) =>
	({
		"provider-test": t`Provider test`,
		"import-pdf": t`PDF import`,
		"import-docx": t`Word import`,
		"writing-review": t`Writing review`,
		improve: t`Improve`,
		"parse-posting": t`Read posting`,
		"web-search": t`Web research`,
		"autofill-posting": t`Fill fields`,
		"match-score": t`MCP match score`,
		"tailor-resume": t`MCP tailoring`,
		"draft-message": t`MCP message draft`,
		"draft-letter": t`Letter draft`,
		"role-suggestions": t`Role suggestions`,
		fit: t`Fit`,
		briefing: t`Briefing`,
		practice: t`Practice`,
		debrief: t`Debrief`,
		reply: t`Reply`,
		answer: t`Form answer`,
		assistant: t`Assistant`,
		"career-chat": t`Career chat`,
		transcription: t`Voice transcription`,
		speech: t`Voice playback`,
	})[action];

type AiResultUsageProps = { usage: AiUsageSummary | null | undefined };
export function AiResultUsage({ usage }: AiResultUsageProps) {
	const { t, i18n } = useLingui();
	return (
		<div className="grid gap-1 text-xs text-ink-3">
			<p>
				{usage
					? t`AI request attempts: ${i18n.number(usage.requests)}`
					: t`AI request history unavailable for this result.`}
			</p>
			{usage?.models.map((model) => (
				<p className="break-words" key={JSON.stringify(model)}>
					{model.label} · {model.provider} · {model.model}
				</p>
			))}
		</div>
	);
}
