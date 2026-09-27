import type { PdfAtsReport } from "@reactive-resume/resume/ats-pdf";
import type { CSSProperties } from "react";
import { Trans } from "@lingui/react/macro";
import { InfoIcon } from "@phosphor-icons/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { cn } from "@reactive-resume/utils/style";
import { getPdfFindingMessage } from "../messages";

function scoreTone(score: number) {
	if (score >= 80) return { text: "text-emerald-600", bar: "bg-emerald-600" };
	if (score >= 60) return { text: "text-amber-600", bar: "bg-amber-600" };
	return { text: "text-rose-600", bar: "bg-rose-600" };
}

type ScoreHeaderProps = {
	report: PdfAtsReport;
};

export function ScoreHeader({ report }: ScoreHeaderProps) {
	const tone = scoreTone(report.score);
	const [cap] = report.cappedBy;

	return (
		<div className="space-y-3 rounded-md border bg-card p-3">
			<div className="flex items-baseline gap-2">
				<span className={cn("font-bold text-4xl tabular-nums leading-none", tone.text)}>{report.score}</span>
				<span className="text-muted-foreground text-sm">
					<Trans>out of 100</Trans>
				</span>
			</div>

			<div className="h-1.5 overflow-hidden rounded-full bg-muted">
				<div
					className={cn(
						"h-full translate-x-(--fill) rounded-full transition-[translate] duration-300 ease-out-strong rtl:-translate-x-(--fill)",
						tone.bar,
					)}
					style={{ "--fill": `${report.score - 100}%` } as CSSProperties}
				/>
			</div>

			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
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
									<InfoIcon className="size-3" />
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
				<p className="rounded-md bg-muted/60 p-2 text-muted-foreground text-xs leading-normal">
					<Trans>The score is capped because of a blocking problem: {getPdfFindingMessage(cap).title}</Trans>
				</p>
			)}
		</div>
	);
}
