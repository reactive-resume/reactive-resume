import type { CheckIssue } from "./issues";
import type { CheckResult } from "./use-check";
import type { AtsCategory, AtsReport } from "@reactive-resume/resume/ats";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { i18n } from "@lingui/core";
import { ph, t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { ATS_CATEGORIES } from "@reactive-resume/resume/ats";
import { Button } from "@reactive-resume/ui/components/button";
import { Collapsible, CollapsibleContent } from "@reactive-resume/ui/components/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@reactive-resume/ui/components/tabs";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { PanelBody } from "../chrome/panel";
import { useEditorStore } from "../store";
import { useCheckActions } from "./actions";
import { buildIssues, getCategoryDescription, getCategoryName } from "./issues";
import { JobMatchTab, useJobMatch } from "./job-match";
import { useCheck } from "./use-check";
import { WritingTab } from "./writing-tab";
import { ListRow, List } from "@/components/calm/list-row";
import { AtsPdfReportView } from "@/features/ats-checker/report/report-view";
import { blobToPdfFile, runAtsCheck } from "@/features/ats-checker/run-ats-check";
import { useIsResumeLocked } from "@/features/resume/builder/draft";
import { createResumePdfBlob } from "@/features/resume/export/pdf-document";

/**
 * Check: the score over the live checks, then Issues (numbered cards pinned to their lines), Job match (terms from
 * the linked application's posting, not scored) and Writing (an opt-in AI review, not scored).
 */
export function CheckPanel() {
	const route = getRouteApi("/builder/$resumeId");
	const search = route.useSearch();
	const { applicationId } = search;
	const navigate = route.useNavigate();
	const check = useCheck();
	const tab = useEditorStore((state) => state.checkTab);
	const match = useJobMatch(check?.data, applicationId);

	if (!check) return null;

	return (
		<PanelBody className="gap-5 pb-6">
			<ScoreSummary report={check.report} count={check.issues.length} />

			<Tabs
				value={tab}
				onValueChange={(value) => {
					if (value !== "issues" && value !== "match" && value !== "writing") return;
					useEditorStore.setState({ checkTab: value });
					void navigate({ to: ".", search: { ...search, checkTab: value }, replace: true });
				}}
				className="gap-1.5"
			>
				<TabsList aria-label={t`Check views`} className="h-9 w-full">
					<TabsTrigger value="issues" className="gap-1.5">
						<Trans>Issues</Trans>
						<span className="font-mono text-xs text-ink-3">{i18n.number(check.issues.length)}</span>
					</TabsTrigger>
					<TabsTrigger value="match" className="gap-1.5">
						<Trans>Job match</Trans>
					</TabsTrigger>
					<TabsTrigger value="writing">
						<Trans>Writing</Trans>
					</TabsTrigger>
				</TabsList>

				<TabsContent value="issues">
					<IssuesTab check={check} />
				</TabsContent>
				<TabsContent value="match">
					<JobMatchTab match={match} data={check.data} />
				</TabsContent>
				<TabsContent value="writing">
					<WritingTab data={check.data} issues={check.issues} />
				</TabsContent>
			</Tabs>
		</PanelBody>
	);
}

function ScoreSummary({ report, count }: { report: AtsReport; count: number }) {
	return (
		<header>
			<h2 className="t-page-title">
				{count > 0 ? (
					<Plural value={count} one="# thing to review" other="# things to review" />
				) : (
					<Trans>Reads cleanly</Trans>
				)}
			</h2>
			<p className="pt-1.5 t-small text-ink-3">
				<Trans>
					{ph({ passed: i18n.number(report.passedRules) })} of {ph({ total: i18n.number(report.totalRules) })} checks
					pass · updates as you edit
				</Trans>
			</p>
		</header>
	);
}

function IssuesTab({ check }: { check: CheckResult }) {
	const { report, issues, data } = check;
	const selected = useEditorStore((state) => state.checkIssue);
	const { restoreIgnored } = useCheckActions();
	const locked = useIsResumeLocked();

	return (
		<div className="grid">
			{issues.length === 0 ? (
				<div className="flex gap-2.5 rounded-xl bg-accent-soft p-3 text-[13px] leading-[19px] text-accent-text">
					<Icon name="check-circle" />
					<p>
						<Trans>
							<strong>Nothing to fix.</strong> Every check passes.
						</Trans>
					</p>
				</div>
			) : (
				<ol aria-label={t`Issues`} className="grid">
					{issues.map((issue) => (
						<IssueCard key={issue.key} issue={issue} selected={selected === issue.key} locked={locked} />
					))}
				</ol>
			)}

			<CategoryRows report={report} />

			{report.ignored.length > 0 && (
				<List>
					<ListRow
						leading={<Icon name="eye-slash" className="text-ink-3" />}
						title={<Plural value={report.ignored.length} one="# issue is ignored" other="# issues are ignored" />}
						subtitle={buildIssues({ ...report, findings: report.ignored }, data)
							.map((issue) => issue.title)
							.join(" · ")}
						trailing={
							<Button variant="ghost" size="sm" disabled={locked} onClick={restoreIgnored}>
								<Trans>Show it again</Trans>
							</Button>
						}
					/>
				</List>
			)}

			<DeepCheck data={data} />
		</div>
	);
}

type IssueCardProps = { issue: CheckIssue; selected: boolean; locked: boolean };

/** A numbered card: category, title, a plain explanation, the fix, Show on page and Ignore (or Keep). */
function IssueCard({ issue, selected, locked }: IssueCardProps) {
	const { fix, ignore, showOnPage } = useCheckActions();
	const titleId = `issue-${issue.number}-title`;
	const applies = issue.fix.kind === "apply";

	return (
		// Clicking a card picks it, outlining its line on the page; Show on page does the same from the keyboard.
		// oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- the buttons inside cover the keyboard.
		<li
			data-issue-card={issue.key}
			aria-labelledby={titleId}
			onClick={() => useEditorStore.setState({ checkIssue: issue.key })}
			className={cn("grid cursor-pointer gap-2.5 border-b border-line py-3.5", selected && "bg-hover")}
		>
			<div className="flex items-start gap-2.5">
				<span
					aria-hidden="true"
					className="mt-px grid size-5 shrink-0 place-items-center rounded-xs bg-warn-mark t-caption font-semibold text-warn-ink"
				>
					{i18n.number(issue.number)}
				</span>
				<div className="grid min-w-0 gap-[3px]">
					<h3 id={titleId} className="text-sm leading-5 font-semibold">
						<span className="sr-only">
							<Trans>Issue {i18n.number(issue.number)}:</Trans>{" "}
						</span>
						{issue.title}
					</h3>
					<p className="text-[13px] leading-[19px] text-ink-2">{issue.body}</p>
				</div>
			</div>

			{/* Touch size on phones (B1). */}
			<div className="ms-8 flex flex-wrap gap-0.5 [&_button]:max-sm:h-10 [&_button]:max-sm:px-3.5 [&_button]:max-sm:text-sm">
				<Button
					size="sm"
					variant="secondary"
					disabled={locked && applies}
					onClick={(event) => {
						event.stopPropagation();
						fix(issue);
					}}
				>
					{issue.fix.label}
				</Button>
				{issue.target && (
					<Button
						size="sm"
						variant="ghost"
						onClick={(event) => {
							event.stopPropagation();
							showOnPage(issue);
						}}
					>
						<Trans>Show on page</Trans>
					</Button>
				)}
				<Button
					size="sm"
					variant="ghost"
					disabled={locked}
					onClick={(event) => {
						event.stopPropagation();
						ignore(issue);
					}}
				>
					<Trans>Ignore</Trans>
				</Button>
			</div>
		</li>
	);
}

/** Contact details, Dates, Layout, Section headings, Writing: "n of m", open when something needs attention. */
function CategoryRows({ report }: { report: AtsReport }) {
	const [expanded, setExpanded] = useState(false);
	const [toggled, setToggled] = useState<Partial<Record<AtsCategory, boolean>>>({});
	const categories = ATS_CATEGORIES.filter((category) => report.categories[category].total > 0);
	return (
		<section>
			<List>
				<ListRow
					leading={<Icon name="check-circle" className="text-accent-text" />}
					title={<Plural value={report.passedRules} one="# check passes" other="# checks pass" />}
					subtitle={<Trans>Contact details, reading order, fonts, links</Trans>}
					caret
					render={<button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} />}
				/>
			</List>
			<Collapsible open={expanded}>
				<CollapsibleContent>
					{categories.map((category) => {
						const { total, passed } = report.categories[category];
						const failing = total - passed;
						const open = toggled[category] ?? failing > 0;
						return (
							<div key={category} className="border-t border-line">
								<button
									type="button"
									aria-expanded={open}
									aria-controls={`check-category-${category}`}
									onClick={() => setToggled((current) => ({ ...current, [category]: !open }))}
									className="flex min-h-12 w-full items-center gap-2.5 text-start t-ui"
								>
									<Icon
										name={failing ? "warning-circle" : "check-circle"}
										className={failing ? "text-warn-text" : "text-accent-text"}
									/>
									{getCategoryName(category)}
									<span className="ms-auto t-caption text-ink-3">
										{failing ? (
											<Plural value={failing} one="# to review" other="# to review" />
										) : (
											t`${passed} of ${total}`
										)}
									</span>
									<Icon name="caret-down" size={16} />
								</button>
								<Collapsible open={open}>
									<CollapsibleContent id={`check-category-${category}`}>
										<p className="ps-7 pb-3 t-small text-ink-2">{getCategoryDescription(category)}</p>
									</CollapsibleContent>
								</Collapsible>
							</div>
						);
					})}
				</CollapsibleContent>
			</Collapsible>
		</section>
	);
}

/** Renders the resume to a PDF and runs the file-level engine on it; null when either step fails. */
async function checkExportedPdf(data: ResumeData) {
	try {
		const blob = await createResumePdfBlob(data);
		return await runAtsCheck(blobToPdfFile(blob, "resume.pdf"));
	} catch {
		return null;
	}
}

/**
 * Also check the exported PDF: renders it, runs the file-level engine on it in this tab and reports in a toast.
 * What it found is pinned to the page, and its full report opens from the toast or a pin.
 */
function DeepCheck({ data }: { data: ResumeData }) {
	const [running, setRunning] = useState(false);
	const report = useEditorStore((state) => state.exportCheck?.report ?? null);
	const reportOpen = useEditorStore((state) => state.exportReportOpen);

	const run = async () => {
		setRunning(true);
		const result = await checkExportedPdf(data);
		setRunning(false);
		if (!result) {
			toast.add({ type: "error", description: t`The exported PDF couldn't be checked. Try again.` });
			return;
		}

		const problems = result.report.findings.length;
		useEditorStore.setState({ exportCheck: { report: result.report, data } });

		toast.add(
			problems === 0
				? { description: t`Exported PDF checked: it reads cleanly too.` }
				: {
						description: t`Exported PDF checked: ${problems} more to look at.`,
						actionProps: { children: t`Show`, onClick: () => useEditorStore.setState({ exportReportOpen: true }) },
					},
		);
	};

	return (
		<>
			<List>
				<ListRow
					leading={<Icon name="file-pdf" className="text-ink-3" />}
					title={running ? <Trans>Checking the exported PDF…</Trans> : <Trans>Also check the exported PDF</Trans>}
					subtitle={<Trans>Checks the file you'd send, on this device</Trans>}
					trailing={
						<Button
							variant="ghost"
							size="sm"
							aria-label={running ? t`Checking the exported PDF…` : t`Check`}
							disabled={running}
							onClick={() => void run()}
						>
							{running ? <Spinner /> : <Trans>Check</Trans>}
						</Button>
					}
				/>
			</List>

			<Dialog
				open={reportOpen && report !== null}
				onOpenChange={(open) => useEditorStore.setState({ exportReportOpen: open })}
			>
				<DialogContent closeLabel={t`Close`} className="max-h-[85svh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							<Trans>The exported PDF</Trans>
						</DialogTitle>
						<DialogDescription>
							<Trans>
								What the file-level check found in the PDF you'd send. It ran in this tab; nothing was uploaded.
							</Trans>
						</DialogDescription>
					</DialogHeader>
					{report && <AtsPdfReportView report={report} />}
					<DialogFooter>
						<Button variant="secondary" onClick={() => useEditorStore.setState({ exportReportOpen: false })}>
							<Trans>Close</Trans>
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
