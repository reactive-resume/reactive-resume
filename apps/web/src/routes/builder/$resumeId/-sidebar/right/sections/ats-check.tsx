import type { AtsFinding, AtsSeverity } from "@reactive-resume/resume/ats";
import type { CSSProperties } from "react";
import type { AtsCheckResult } from "@/features/ats-checker/run-ats-check";
import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { ArrowRightIcon, CheckCircleIcon, MagnifyingGlassIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";
import { match } from "ts-pattern";
import { lintResumeForAts } from "@reactive-resume/resume/ats";
import { Alert, AlertDescription } from "@reactive-resume/ui/components/alert";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import { Label } from "@reactive-resume/ui/components/label";
import { Separator } from "@reactive-resume/ui/components/separator";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Textarea } from "@reactive-resume/ui/components/textarea";
import { cn } from "@reactive-resume/utils/style";
import { AiReviewCard } from "@/features/ats-checker/ai-review/ai-review-card";
import { AtsPdfReportView } from "@/features/ats-checker/report/report-view";
import { blobToPdfFile, runAtsCheck } from "@/features/ats-checker/run-ats-check";
import { useResumeData } from "@/features/resume/builder/draft";
import { getScrollBehavior } from "@/features/resume/builder/section-recovery";
import { createResumePdfBlob } from "@/features/resume/export/pdf-document";
import {
	atsFindingItemElementId,
	getAtsFindingLocation,
	getAtsFindingMessage,
	getAtsFindingTarget,
} from "@/libs/resume/ats";
import { useSectionStore } from "../../../-store/section";
import { useBuilderSidebar } from "../../../-store/sidebar";
import { SectionBase } from "../shared/section-base";

const MAX_JOB_DESCRIPTION_CHARS = 20_000;

const SEVERITIES = ["error", "warning", "info"] as const;

function severityDotClass(severity: AtsSeverity) {
	return match(severity)
		.with("error", () => "bg-rose-600")
		.with("warning", () => "bg-amber-600")
		.with("info", () => "bg-sky-600")
		.exhaustive();
}

function severityLabel(severity: AtsSeverity) {
	return match(severity)
		.with("error", () => t`Error`)
		.with("warning", () => t`Warning`)
		.with("info", () => t`Note`)
		.exhaustive();
}

type SeverityCountProps = {
	severity: AtsSeverity;
	count: number;
};

function SeverityCount({ severity, count }: SeverityCountProps) {
	return (
		<span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
			<span className={cn("size-2 shrink-0 rounded-full", severityDotClass(severity))} aria-hidden />
			{match(severity)
				.with("error", () => <Plural value={count} one="# error" other="# errors" />)
				.with("warning", () => <Plural value={count} one="# warning" other="# warnings" />)
				.with("info", () => <Plural value={count} one="# note" other="# notes" />)
				.exhaustive()}
		</span>
	);
}

type AtsFindingRowProps = {
	finding: AtsFinding;
	onJump: (pointer: string) => void;
};

function AtsFindingRow({ finding, onJump }: AtsFindingRowProps) {
	const message = getAtsFindingMessage(finding.code);
	const location = getAtsFindingLocation(finding.pointer);

	return (
		<li className="space-y-2 rounded-md border bg-card p-3">
			<div className="flex items-start gap-2">
				<span className={cn("mt-1.5 size-2 shrink-0 rounded-full", severityDotClass(finding.severity))} aria-hidden />

				<div className="min-w-0 flex-1 space-y-1">
					<p className="font-medium text-sm leading-snug">{message.title}</p>
					<p className="text-muted-foreground text-xs leading-normal">{message.action}</p>
				</div>

				<Badge variant="secondary" className="shrink-0">
					{severityLabel(finding.severity)}
				</Badge>
			</div>

			{location && (
				<Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={() => onJump(finding.pointer)}>
					{location}
					<ArrowRightIcon />
				</Button>
			)}
		</li>
	);
}

function LiveLintTier() {
	const data = useResumeData();
	const { toggleSidebar } = useBuilderSidebar();
	const setCollapsed = useSectionStore((state) => state.setCollapsed);

	const report = useMemo(() => (data ? lintResumeForAts(data) : null), [data]);

	const onJump = useCallback(
		(pointer: string) => {
			const target = getAtsFindingTarget(pointer, data);
			if (!target) return;

			toggleSidebar(target.side, true);
			setCollapsed(target.section, false);

			const item = target.itemId ? document.getElementById(atsFindingItemElementId(target.itemId)) : null;
			const destination = item ?? document.getElementById(`sidebar-${target.section}`);
			destination?.scrollIntoView({ block: "start", inline: "nearest", behavior: getScrollBehavior() });
		},
		[data, setCollapsed, toggleSidebar],
	);

	if (!report) return null;

	const { counts, findings, passedRules, totalRules } = report;

	return (
		<div className="space-y-3">
			<div className="space-y-3 rounded-md border bg-card p-3">
				<p className="text-muted-foreground text-xs leading-normal">
					<Trans>
						These checks run as you type and never leave your browser. They test whether software can read your resume,
						not how well it is written.
					</Trans>
				</p>

				<div className="space-y-2">
					<p className="font-medium text-sm leading-none">
						<Trans>
							{passedRules} of {totalRules} checks passed
						</Trans>
					</p>

					<div className="h-1.5 overflow-hidden rounded-full bg-muted">
						<div
							className="h-full translate-x-(--fill) rounded-full bg-primary transition-[translate] duration-200 ease-out-strong rtl:-translate-x-(--fill)"
							style={{ "--fill": `${(passedRules / totalRules) * 100 - 100}%` } as CSSProperties}
						/>
					</div>
				</div>

				{findings.length > 0 && (
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1">
						{SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => (
							<SeverityCount key={severity} severity={severity} count={counts[severity]} />
						))}
					</div>
				)}
			</div>

			{findings.length === 0 ? (
				<div className="flex items-center gap-3 rounded-md border border-dashed p-3">
					<CheckCircleIcon className="size-5 shrink-0 text-emerald-600" />
					<p className="text-muted-foreground text-sm leading-normal">
						<Trans>Every check passed. Nothing here should stop a parser from reading your resume.</Trans>
					</p>
				</div>
			) : (
				<ul className="space-y-2">
					{findings.map((finding) => (
						<AtsFindingRow key={`${finding.code}:${finding.pointer}`} finding={finding} onJump={onJump} />
					))}
				</ul>
			)}
		</div>
	);
}

/**
 * Tier two and three: render the current resume to a PDF and run the same file-level check the
 * standalone page runs, then offer the optional AI review on top of the result.
 *
 * The render happens in this tab and the report is derived from those bytes, so the deep check
 * measures the file a recruiter would actually receive rather than the draft that produced it.
 */
function DeepCheckTier() {
	const data = useResumeData();

	const [jobDescription, setJobDescription] = useState("");
	const [result, setResult] = useState<AtsCheckResult | null>(null);
	const [isRunning, setIsRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const onRun = async () => {
		if (!data || isRunning) return;

		setIsRunning(true);
		setError(null);

		try {
			const blob = await createResumePdfBlob(data);
			setResult(await runAtsCheck(blobToPdfFile(blob, "resume.pdf"), { jobDescription }));
		} catch {
			setError(t`The deep check could not finish. Please try again.`);
		} finally {
			setIsRunning(false);
		}
	};

	if (!data) return null;

	return (
		<div className="space-y-3">
			<div className="space-y-3 rounded-md border bg-card p-3">
				<div className="space-y-1">
					<p className="font-medium text-sm leading-none">
						<Trans>Deep check</Trans>
					</p>
					<p className="text-muted-foreground text-xs leading-normal">
						<Trans>
							Renders your current resume to PDF and runs the full file check in your browser. Nothing is uploaded.
						</Trans>
					</p>
				</div>

				<div className="space-y-2">
					<Label htmlFor="builder-ats-job-description" className="text-xs">
						<Trans>Job description (optional)</Trans>
					</Label>
					<Textarea
						id="builder-ats-job-description"
						rows={3}
						maxLength={MAX_JOB_DESCRIPTION_CHARS}
						value={jobDescription}
						placeholder={t`Paste a posting to see which of its terms already appear in your resume.`}
						onChange={(event) => setJobDescription(event.target.value)}
					/>
				</div>

				<Button size="sm" disabled={isRunning} onClick={() => void onRun()}>
					{isRunning ? <Spinner /> : <MagnifyingGlassIcon />}
					{isRunning ? <Trans>Checking…</Trans> : result ? <Trans>Run again</Trans> : <Trans>Run deep check</Trans>}
				</Button>
			</div>

			{error && (
				<Alert variant="destructive">
					<WarningCircleIcon />
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			{result && (
				<>
					<AtsPdfReportView report={result.report} />
					<AiReviewCard report={result.report} fullText={result.fullText} jobDescription={jobDescription} />
				</>
			)}
		</div>
	);
}

export function AtsCheckSectionBuilder() {
	return (
		<SectionBase type="ats" className="space-y-4">
			<LiveLintTier />
			<Separator />
			<DeepCheckTier />
		</SectionBase>
	);
}
