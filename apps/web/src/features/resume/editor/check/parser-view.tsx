import type { CheckIssue } from "./issues";
import type { AtsRuleCode } from "@reactive-resume/resume/ats";
import type { ExtractedDocument, ResumeSemantics } from "@reactive-resume/resume/ats-pdf";
import { i18n } from "@lingui/core";
import { ph, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Spinner } from "@reactive-resume/ui/components/spinner";
import { cn } from "@reactive-resume/utils/style";
import { useEditorStore } from "../store";
import { useCheck } from "./use-check";
import { extractPdf } from "@/features/ats-checker/extract-client";
import { blobToPdfFile } from "@/features/ats-checker/run-ats-check";
import { useCurrentBuilderResumeSelector } from "@/features/resume/builder/draft";

type Parsed = { doc: ExtractedDocument; semantics: ResumeSemantics };

/** Reads the PDF on the page the way a parser does: its text layer in reading order, and what it recognises. */
async function parseRenderedPdf(file: Blob): Promise<Parsed> {
	// The operator pass (hidden text, images of text) feeds the full check, not this view, so it's skipped.
	const engine = import("@reactive-resume/resume/ats-pdf");
	engine.catch(() => {}); // Awaited below; see run-ats-check.ts.
	const raw = await extractPdf(blobToPdfFile(file, "resume.pdf"), { operatorBudgetMs: 0 });
	const { buildExtractedDocument, buildResumeSemantics } = await engine;
	const doc = buildExtractedDocument(raw);

	return { doc, semantics: buildResumeSemantics(raw, doc, { now: new Date() }) };
}

/** Which live checks each field of the parser view reflects. */
const FIELD_CODES: Record<string, readonly AtsRuleCode[]> = {
	name: ["MISSING_NAME"],
	email: ["MISSING_EMAIL", "MALFORMED_EMAIL"],
	phone: ["MISSING_PHONE"],
	location: ["MISSING_LOCATION"],
	links: ["MALFORMED_URL"],
	sections: ["NON_STANDARD_SECTION_TITLE", "NO_VISIBLE_EXPERIENCE", "SECTION_MISSING_FROM_LAYOUT", "FRAGMENTED_ENTRY"],
	dates: ["EMPTY_PERIOD", "UNPARSEABLE_PERIOD", "UNPARSEABLE_DATE", "REVERSED_PERIOD", "FUTURE_DATED_PERIOD"],
};

const issueFor = (issues: readonly CheckIssue[], codes: readonly AtsRuleCode[]) =>
	issues.find((issue) => codes.includes(issue.finding.code));

/** The issue whose text shows on a line, such as a link written without https:// or an unreadable date. */
const issueOnLine = (issues: readonly CheckIssue[], line: string) =>
	issues.find((issue) => {
		const value = issue.finding.params?.value;
		return typeof value === "string" && value.length > 2 && line.includes(value);
	});

function IssueChip({ issue }: { issue: CheckIssue }) {
	return (
		<span className="h-[18px] shrink-0 rounded-sm bg-warn-soft px-1.5 font-sans text-[11px] leading-[18px] font-semibold whitespace-nowrap text-warn-text">
			<Trans>issue {i18n.number(issue.number)}</Trans>
		</span>
	);
}

/**
 * "What a parser reads": the text extracted from the PDF on the page, in reading order, with the fields a parser
 * recognises and the lines behind open issues highlighted.
 */
export function ParserView() {
	const resumeId = useCurrentBuilderResumeSelector((resume) => resume.id);
	const { file, version } = useEditorStore((state) => state.rendered);
	const issues = useCheck()?.issues ?? [];
	const { data, isError } = useQuery({
		queryKey: ["check-parser-view", resumeId, version],
		queryFn: () => {
			if (!file) throw new Error("The page hasn't rendered yet.");
			return parseRenderedPdf(file);
		},
		enabled: !!file,
		placeholderData: (previous, query) => (query?.queryKey[1] === resumeId ? previous : undefined),
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 60_000,
		retry: false,
	});

	return (
		<div
			role="document"
			aria-label={t`What a parser reads`}
			className="mx-auto w-[700px] max-w-full shrink-0 self-start rounded-md border border-line bg-surface px-8 pt-[26px] pb-10 font-mono text-[12px] leading-[19px] text-ink-2 max-sm:px-4"
		>
			{isError ? (
				<p className="font-sans text-sm text-danger-text">
					<Trans>The page's PDF couldn't be read. Edit anything to render it again.</Trans>
				</p>
			) : !data ? (
				<p className="flex items-center gap-2 font-sans text-sm text-ink-2">
					<Spinner />
					<Trans>Reading the PDF…</Trans>
				</p>
			) : (
				<ParsedText parsed={data} issues={issues} />
			)}
		</div>
	);
}

function ParsedText({ parsed, issues }: { parsed: Parsed; issues: readonly CheckIssue[] }) {
	const { doc, semantics } = parsed;
	const columns = doc.pages.some((page) => page.gutter) ? 2 : 1;
	const notFound = t`not found`;

	if (doc.charCount === 0) {
		return (
			<p className="font-sans text-sm text-warn-text">
				<Trans>This PDF has no text layer, so a parser reads nothing from it.</Trans>
			</p>
		);
	}

	const { contact } = semantics;
	const links = [...new Set([...contact.textUrls, ...contact.annotationUrls])];
	const unreadable = semantics.dates.filter((date) => !date.parsed).length;
	const fields = [
		{ id: "name", label: t`Name`, value: contact.nameLine },
		{ id: "email", label: t`Email`, value: contact.emails.join(", ") },
		{ id: "phone", label: t`Phone`, value: contact.phones.join(", ") },
		{ id: "location", label: t`Location`, value: contact.locationLine },
		{ id: "links", label: t`Links`, value: links.join(", ") },
		{ id: "sections", label: t`Sections`, value: semantics.headings.map((heading) => heading.text).join(", ") },
		{
			id: "dates",
			label: t`Dates`,
			value:
				semantics.dates.length === 0
					? ""
					: unreadable > 0
						? t`${i18n.number(semantics.dates.length)} found, ${ph({ unreadable: i18n.number(unreadable) })} unreadable`
						: t`${i18n.number(semantics.dates.length)} found`,
		},
	];

	// Only standalone headings replace a text line; fused columns must retain the full line in reading order.
	const headingAt = new Map(semantics.headings.map((heading) => [heading.lineIndex, heading.text]));
	const groups: { heading: string | null; lines: string[] }[] = [{ heading: null, lines: [] }];
	doc.lines.forEach((line, index) => {
		const heading = headingAt.get(index);
		if (heading === line.text.trim()) groups.push({ heading, lines: [] });
		else if (heading !== undefined) groups.push({ heading: null, lines: [line.text] });
		else groups.at(-1)?.lines.push(line.text);
	});

	return (
		<>
			<div className="flex justify-between gap-2 font-medium text-ink-3">
				<span>
					<Trans>Extracted from the PDF on the page · reading order</Trans>
				</span>
				<span>
					{columns === 1 ? <Trans>text layer found · 1 column</Trans> : <Trans>text layer found · 2 columns</Trans>}
				</span>
			</div>

			<dl className="my-3.5 grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-[3px] max-sm:grid-cols-[84px_minmax(0,1fr)]">
				{fields.map((field) => {
					const issue = issueFor(issues, FIELD_CODES[field.id] ?? []);
					return (
						<div key={field.id} className="contents">
							<dt className="text-ink-3">{field.label}</dt>
							<dd
								className={cn(
									"flex min-w-0 items-center gap-2",
									issue ? "text-warn-text" : field.value ? "text-ink" : "text-ink-3",
								)}
							>
								<span className={cn("min-w-0 break-words", field.id !== "dates" && "flex-1")}>
									{field.value || notFound}
								</span>
								{issue && <IssueChip issue={issue} />}
							</dd>
						</div>
					);
				})}
			</dl>

			<hr className="border-line" />

			{groups.map((group, index) =>
				group.heading === null && group.lines.length === 0 ? null : (
					<section key={`${index}:${group.heading ?? ""}`} className="mt-3">
						{group.heading !== null && <h3 className="font-medium text-accent-text">▸ {group.heading}</h3>}
						{group.lines.map((line, lineIndex) => {
							const issue = issueOnLine(issues, line);
							return (
								<p
									key={`${lineIndex}:${line}`}
									className={cn("flex items-start gap-2 ps-3.5", issue ? "text-warn-text" : "text-ink-2")}
								>
									<span className="min-w-0 break-words">{line}</span>
									{issue && <IssueChip issue={issue} />}
								</p>
							);
						})}
					</section>
				),
			)}
		</>
	);
}
