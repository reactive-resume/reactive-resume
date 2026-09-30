import type { PdfAtsReport } from "@reactive-resume/resume/ats-pdf";
import type { CSSProperties } from "react";
import { Trans } from "@lingui/react/macro";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { cn } from "@reactive-resume/utils/style";
import { getPdfFindingMessage } from "../messages";

function scoreTone(score: number) {
	if (score >= 80) return { text: "text-accent-text", bar: "bg-accent" };
	if (score >= 60) return { text: "text-warn-text", bar: "bg-warn" };
	return { text: "text-danger-text", bar: "bg-danger" };
}

type ScoreHeaderProps = {
	report: PdfAtsReport;
};

export function ScoreHeader({ report }: ScoreHeaderProps) {
	const tone = scoreTone(report.score);
	const [cap] = report.cappedBy;

	return (
		<div className="space-y-3 rounded-md border bg-surface p-3">
			<div className="flex items-baseline gap-2">
				<span className={cn("text-4xl leading-none font-bold tabular-nums", tone.text)}>{report.score}</span>
				<span className="text-sm text-ink-3">
					<Trans>out of 100</Trans>
				</span>
			</div>

			{/* Fills from empty when the report first shows. The starting --fill needs !important to beat the inline one; it's derived through --fill so RTL still fills from the right. */}
			<div className="h-1.5 overflow-hidden rounded-full bg-sunken">
				<div
					className={cn(
						"h-full translate-x-(--fill) rounded-full transition-[translate,background-color] duration-emphasized ease-enter rtl:-translate-x-(--fill) starting:[--fill:-100%]!",
						tone.bar,
					)}
					style={{ "--fill": `${report.score - 100}%` } as CSSProperties}
				/>
			</div>

			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
				<span>
					<Trans>
						{report.passedChecks} of {report.applicableChecks} applicable checks passed
					</Trans>
				</span>

				{report.skippedChecks > 0 && (
					<Tooltip>
						<TooltipTrigger
							render={
								<span className="inline-flex cursor-help items-center gap-1 underline decoration-dotted underline-offset-2">
									<Trans>{report.skippedChecks} skipped</Trans>
									<Icon name="info" size={12} />
								</span>
							}
						/>
						<TooltipContent side="bottom" className="max-w-64">
							<Trans>
								Some checks need information this file does not carry: page contents that could not be inspected, or
								text in a language these checks do not cover. They count as neither a pass nor a fail.
							</Trans>
						</TooltipContent>
					</Tooltip>
				)}
			</div>

			{cap && (
				<p className="rounded-md bg-sunken/60 p-2 text-xs leading-normal text-ink-3">
					<Trans>The score is capped because of a blocking problem: {getPdfFindingMessage(cap).title}</Trans>
				</p>
			)}
		</div>
	);
}
