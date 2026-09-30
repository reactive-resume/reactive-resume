import type { PdfAtsReport, PdfCategory, PdfCategoryScore } from "@reactive-resume/resume/ats-pdf";
import { Trans } from "@lingui/react/macro";
import { useMemo } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@reactive-resume/ui/components/accordion";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { getPdfCategoryDescription, getPdfCategoryLabel } from "../messages";
import { FindingRow } from "./finding-row";
import { JdCoverage } from "./jd-coverage";
import { ScoreHeader } from "./score-header";

type ReportViewProps = {
	report: PdfAtsReport;
	className?: string;
};

function categoryTone(score: number) {
	if (score >= 80) return "text-accent-text";
	if (score >= 60) return "text-warn-text";
	return "text-danger-text";
}

/**
 * The whole report, built compact-first so the same component serves the narrow builder sidebar
 * and the full-width page without a second implementation.
 */
export function AtsPdfReportView({ report, className }: ReportViewProps) {
	const findingsByCategory = useMemo(() => {
		const grouped = new Map<PdfCategory, PdfAtsReport["findings"]>();
		for (const finding of report.findings) {
			grouped.set(finding.category, [...(grouped.get(finding.category) ?? []), finding]);
		}
		return grouped;
	}, [report.findings]);

	const openCategories = report.categories
		.filter((category) => (findingsByCategory.get(category.category)?.length ?? 0) > 0)
		.map((category) => category.category);

	return (
		<div className={cn("space-y-4", className)}>
			<ScoreHeader report={report} />

			{report.document.truncated && (
				<p className="text-xs leading-normal text-ink-3">
					<Trans>
						Only the first {report.document.pageCount} pages were checked, so this report does not cover the whole file.
					</Trans>
				</p>
			)}

			<Accordion defaultValue={openCategories} className="rounded-md border px-3">
				{report.categories.map((category) => (
					<CategorySection
						key={category.category}
						category={category}
						findings={findingsByCategory.get(category.category) ?? []}
					/>
				))}

				<WritingSection tips={report.tips} />
			</Accordion>

			{report.jd && <JdCoverage jd={report.jd} />}

			<p className="text-xs leading-normal text-ink-3">
				<Trans>
					This measures how faithfully software can extract this file's text. It does not predict whether an application
					will be rejected, and no tool can. Your file was read in this browser and never uploaded.
				</Trans>
			</p>
		</div>
	);
}

type CategorySectionProps = {
	category: PdfCategoryScore;
	findings: PdfAtsReport["findings"];
};

function CategorySection({ category, findings }: CategorySectionProps) {
	return (
		<AccordionItem value={category.category}>
			<AccordionTrigger>
				<span className="flex min-w-0 flex-1 items-center gap-2 pe-2">
					<span className="min-w-0 truncate">{getPdfCategoryLabel(category.category)}</span>
					<Badge variant="neutral" className="shrink-0 tabular-nums">
						<span className={categoryTone(category.score)}>{category.score}</span>
					</Badge>
					{findings.length > 0 && (
						<span className="shrink-0 text-xs font-normal text-ink-3">
							<Trans>{findings.length} to fix</Trans>
						</span>
					)}
				</span>
			</AccordionTrigger>

			<AccordionContent className="space-y-3">
				<p className="text-xs leading-normal text-ink-3">
					{getPdfCategoryDescription(category.category)}{" "}
					<Trans>
						{category.passedChecks} of {category.applicableChecks} applicable checks passed.
					</Trans>
				</p>

				{findings.length === 0 ? (
					<div className="flex items-center gap-2 rounded-md border border-dashed p-2.5">
						<Icon name="check_circle" size={16} className="shrink-0 text-accent-text" />
						<span className="text-xs leading-normal text-ink-3">
							<Trans>Nothing to fix here.</Trans>
						</span>
					</div>
				) : (
					<ul className="space-y-2">
						{findings.map((finding) => (
							<FindingRow key={finding.code} finding={finding} />
						))}
					</ul>
				)}
			</AccordionContent>
		</AccordionItem>
	);
}

type WritingSectionProps = {
	tips: PdfAtsReport["tips"];
};

/** Unscored advice, kept visually separate so nobody reads it as part of the number above. */
function WritingSection({ tips }: WritingSectionProps) {
	return (
		<AccordionItem value="content">
			<AccordionTrigger>
				<span className="flex min-w-0 flex-1 items-center gap-2 pe-2">
					<span className="min-w-0 truncate">{getPdfCategoryLabel("content")}</span>
					<Badge variant="outline" className="shrink-0 font-normal">
						<Trans>Not scored</Trans>
					</Badge>
				</span>
			</AccordionTrigger>

			<AccordionContent className="space-y-3">
				<p className="text-xs leading-normal text-ink-3">{getPdfCategoryDescription("content")}</p>

				{tips.length === 0 ? (
					<div className="flex items-center gap-2 rounded-md border border-dashed p-2.5">
						<Icon name="check_circle" size={16} className="shrink-0 text-accent-text" />
						<span className="text-xs leading-normal text-ink-3">
							<Trans>Nothing to suggest.</Trans>
						</span>
					</div>
				) : (
					<ul className="space-y-2">
						{tips.map((tip) => (
							<FindingRow key={tip.code} finding={tip} />
						))}
					</ul>
				)}
			</AccordionContent>
		</AccordionItem>
	);
}
