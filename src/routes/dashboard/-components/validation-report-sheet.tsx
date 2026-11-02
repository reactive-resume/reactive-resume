import { t } from "@lingui/core/macro";
import { PrinterIcon, XIcon } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/utils/style";
import {
	formatReportDate,
	printLayout,
	type ReportScope,
	type SectionSummaryRow,
	type StudentReportRow,
	type SummaryTotals,
} from "./validation-report";

/**
 * Header fields the college prints that exist nowhere in our data — they are typed by hand on the
 * spreadsheets today. Kept per browser so a Placement Officer sets them once a semester.
 */
export type ReportHeading = {
	academicYear: string;
	programme: string;
	year: string;
	semester: string;
};

const HEADING_KEY = "resume.validationReport.heading";

export const defaultHeading: ReportHeading = {
	academicYear: "2025 - 2026",
	programme: "B.Tech.",
	year: "III Year",
	semester: "VI",
};

export function useReportHeading() {
	const [heading, setHeading] = useState<ReportHeading>(() => {
		// Browser storage is per viewer and can throw outright in a private window, so the typed
		// defaults have to stand on their own.
		try {
			const saved = localStorage.getItem(HEADING_KEY);
			return saved ? { ...defaultHeading, ...JSON.parse(saved) } : defaultHeading;
		} catch {
			return defaultHeading;
		}
	});

	const update = (next: ReportHeading) => {
		setHeading(next);
		try {
			localStorage.setItem(HEADING_KEY, JSON.stringify(next));
		} catch {
			// A viewer who blocks storage still gets a correct report, just not a remembered one.
		}
	};

	return [heading, update] as const;
}

/**
 * Print rules for both reports.
 *
 * `visibility` rather than `display` hides the app around the sheet: the sheet is nested deep in
 * the dashboard, and collapsing its ancestors would take the sheet with them.
 */
const PRINT_CSS = `
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  body * { visibility: hidden !important; }
  .print-sheet, .print-sheet * { visibility: visible !important; }
  .print-sheet {
    position: absolute !important;
    inset: 0 auto auto 0;
    width: 100%;
    padding: 0 !important;
    background: #fff !important;
    color: #000 !important;
    box-shadow: none !important;
  }
  .print-hide { display: none !important; }
  .print-sheet table { break-inside: auto; }
  .print-sheet tr { break-inside: avoid; }
}
`;

/** A4 portrait at 96dpi, less the 10mm print margins the @page rule sets. */
const A4_CONTENT_HEIGHT_PX = 1123 - (10 * 2 * 96) / 25.4;

/**
 * Shrink a sheet until it fits on one page.
 *
 * One page is a hard requirement, and the height depends on things no fixed font size can predict:
 * how many sections a batch has, how long the branch names are, how many names wrap. So the sheet
 * measures itself and steps down until it fits, instead of relying on thresholds tuned against
 * whichever cohort happened to be on hand.
 *
 * The measurement is honest because the sheet is laid out at 210mm on screen too, so what is
 * measured here is the width it will print at.
 */
function useFitToPage<T extends HTMLElement>(deps: unknown[]) {
	const ref = useRef<T>(null);
	const [scale, setScale] = useState(1);

	useLayoutEffect(() => {
		setScale(1);
	}, deps);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const height = el.scrollHeight;
		// 0.62 keeps the smallest type legible; past that the sheet is better off on two pages
		// than unreadable on one.
		if (height > A4_CONTENT_HEIGHT_PX && scale > 0.62) {
			setScale((current) => Math.max(0.62, current * Math.min(0.97, A4_CONTENT_HEIGHT_PX / height)));
		}
	}, [scale]);

	return [ref, scale] as const;
}

function Letterhead({ title }: { title: string }) {
	return (
		<div className="mb-1 text-center">
			<img
				src={`${import.meta.env.BASE_URL}reports/institute-logo.png`}
				alt=""
				className="mx-auto mb-0.5 h-9 object-contain"
			/>
			<p className="font-bold text-[13px] leading-tight">
				VNR VIGNANA JYOTHI INSTITUTE OF ENGINEERING &amp; TECHNOLOGY
			</p>
			<p className="text-[10px] leading-tight">An Autonomous Institute with A++ Grade</p>
			<p className="text-[10px] leading-tight">PRAGATHI NAGAR, NIZAMPET (S.O), HYDERABAD – 500 090</p>
			<p className="mt-1 font-semibold text-[12px] underline">{title}</p>
		</div>
	);
}

type SheetChromeProps = {
	onClose: () => void;
	children: React.ReactNode;
	note?: string;
	sheetRef?: React.Ref<HTMLDivElement>;
};

function SheetChrome({ onClose, children, note, sheetRef }: SheetChromeProps) {
	return (
		<div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4">
			{/* biome-ignore lint/security/noDangerouslySetInnerHtml: print rules must be real CSS, not inline styles */}
			<style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
			<div className="mx-auto max-w-[210mm]">
				<div className="print-hide mb-3 flex items-center justify-between gap-3">
					{note ? <p className="text-[11px] text-white/80">{note}</p> : <span />}
					<div className="flex gap-2">
						<button
							type="button"
							onClick={() => window.print()}
							className="flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 font-bold text-sm text-white shadow-sm hover:bg-primary/90"
						>
							<PrinterIcon weight="duotone" className="size-4" />
							{t`Print`}
						</button>
						<button
							type="button"
							onClick={onClose}
							aria-label={t`Close`}
							className="flex items-center gap-1.5 rounded-xl bg-white px-3 py-2 font-bold text-foreground text-sm shadow-sm"
						>
							<XIcon className="size-4" />
						</button>
					</div>
				</div>
				<div ref={sheetRef} className="print-sheet rounded-xl bg-white p-6 text-black shadow-lg">
					{children}
				</div>
			</div>
		</div>
	);
}

const cell = "border border-black px-1 py-0 leading-[1.15] align-middle";
// Only the branch name is allowed to wrap; a section code broken over two lines doubles the
// height of every row, which is what pushes a full batch onto a second page.
const summaryCell = "border border-black whitespace-nowrap px-1.5 py-[2px] leading-snug align-middle";
const summaryBranchCell = "border border-black px-1.5 py-[2px] leading-snug align-middle text-left";

function RosterTable({ rows, fontPt }: { rows: StudentReportRow[]; fontPt: number }) {
	return (
		<table className="w-full border-collapse" style={{ fontSize: `${fontPt}pt` }}>
			<thead>
				<tr className="font-semibold">
					<th className={cn(cell, "w-[7%]")}>S. No.</th>
					<th className={cn(cell, "text-left")}>Name of the Student</th>
					<th className={cn(cell, "w-[20%]")}>H. T. No.</th>
					<th className={cn(cell, "w-[18%]")}>CV submitted</th>
					<th className={cn(cell, "w-[15%]")}>Validation</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((row) => (
					<tr key={`${row.rollNumber}-${row.serial}`}>
						<td className={cn(cell, "text-center")}>{row.serial}</td>
						<td className={cn(cell, "text-left")}>{row.name}</td>
						<td className={cn(cell, "text-center")}>{row.rollNumber}</td>
						<td className={cn(cell, "text-center")}>{row.submittedOn}</td>
						<td className={cn(cell, "text-center")}>{row.validated ? "Done" : ""}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

export type SectionSheetProps = {
	sectionName: string;
	branch: string;
	rows: StudentReportRow[];
	scope: ReportScope;
	onClose: () => void;
};

export function SectionValidationSheet({ sectionName, branch, rows, scope, onClose }: SectionSheetProps) {
	const [heading, setHeading] = useReportHeading();
	const [sheetRef, scale] = useFitToPage<HTMLDivElement>([rows.length, sectionName]);
	const { left, fontPt: baseFontPt } = printLayout(rows);
	const fontPt = baseFontPt * scale;
	const submitted = rows.filter((r) => r.submittedOn).length;
	// "Section" on the sheet is the letter the college uses, e.g. "AE - A 2024" → "A".
	const sectionLetter = sectionName.split("-")[1]?.trim().split(" ")[0] ?? sectionName;

	const field = (label: string, key: keyof ReportHeading) => (
		<label className="print-hide flex items-center gap-1">
			<span className="text-[10px] text-muted-foreground">{label}</span>
			<input
				value={heading[key]}
				onChange={(e) => setHeading({ ...heading, [key]: e.target.value })}
				className="w-24 rounded border border-zinc-300 px-1 py-0.5 text-[11px]"
			/>
		</label>
	);

	return (
		<SheetChrome
			onClose={onClose}
			sheetRef={sheetRef}
			note={t`Academic year, class and semester are not held in the system — set them once and they are remembered.`}
		>
			<div className="print-hide mb-3 flex flex-wrap gap-3 rounded-lg bg-zinc-100 p-2">
				{field(t`Aca Year`, "academicYear")}
				{field(t`Programme`, "programme")}
				{field(t`Class`, "year")}
				{field(t`Semester`, "semester")}
			</div>

			<Letterhead title={scope === "po" ? "CV Validation status (Placement Officer)" : "CV Validation status"} />

			<table className="mb-1 w-full border-collapse text-[10px]">
				<tbody>
					<tr>
						<td className={cell}>Aca Year: {heading.academicYear}</td>
						<td className={cell} colSpan={2}>
							Programme: {heading.programme}
						</td>
					</tr>
					<tr>
						<td className={cell}>Class: {heading.year}</td>
						<td className={cell} colSpan={2}>
							Semester: {heading.semester}
						</td>
					</tr>
					<tr>
						<td className={cell}>Branch: {branch}</td>
						<td className={cell}>Section: {sectionLetter}</td>
						<td className={cell}>
							Total: {rows.length} &nbsp;&nbsp; Submitted: {submitted}
						</td>
					</tr>
				</tbody>
			</table>

			{/* Two columns so a full class fits one page at a readable size. */}
			<div className="flex items-start gap-2">
				<div className="flex-1">
					<RosterTable rows={rows.slice(0, left)} fontPt={fontPt} />
				</div>
				<div className="flex-1">
					<RosterTable rows={rows.slice(left)} fontPt={fontPt} />
				</div>
			</div>

			<p className="mt-2 text-right text-[9px]">Generated {formatReportDate(new Date())}</p>
		</SheetChrome>
	);
}

export type SummarySheetProps = {
	title: string;
	rows: SectionSummaryRow[];
	totals: SummaryTotals;
	onClose: () => void;
};

export function SummaryValidationSheet({ title, rows, totals, onClose }: SummarySheetProps) {
	// A summary of a single package is a short table on a tall page, so the type grows to fill it
	// rather than sitting as a small block of text at the top of an otherwise empty sheet.
	const [sheetRef, scale] = useFitToPage<HTMLDivElement>([rows.length, title]);
	// A starting size that suits the common cases; the fit pass takes it down if it has to.
	const fontPt = (rows.length <= 18 ? 10.5 : rows.length <= 26 ? 9.5 : rows.length <= 34 ? 8.5 : 7.5) * scale;

	const numeric = "text-center tabular-nums";

	return (
		<SheetChrome onClose={onClose} sheetRef={sheetRef}>
			<div className="mb-3 text-center">
				<img
					src={`${import.meta.env.BASE_URL}reports/institute-logo.png`}
					alt=""
					className="mx-auto mb-2 h-14 object-contain"
				/>
				<p className="font-bold text-[13px] tracking-wide">MENTORING, TRAINING &amp; PLACEMENTS DEPARTMENT</p>
				<p className="mt-1 font-semibold text-[12px] underline">{title}</p>
			</div>

			<table className="w-full border-collapse" style={{ fontSize: `${fontPt}pt` }}>
				<thead>
					<tr className="bg-zinc-100 font-semibold">
						<th className={cn(summaryCell, "w-[6%]")} rowSpan={2}>
							Sl. No
						</th>
						<th className={cn(summaryBranchCell, "w-[26%]")} rowSpan={2}>
							Branch(No. of Sections)
						</th>
						<th className={cn(summaryCell, "w-[14%]")} rowSpan={2}>
							Section
						</th>
						<th className={summaryCell} colSpan={5}>
							CV validation status
						</th>
					</tr>
					<tr className="bg-zinc-100 font-semibold">
						<th className={cn(summaryCell, "w-[8%]")}>Total</th>
						<th className={cn(summaryCell, "w-[10%]")}>Validated</th>
						<th className={cn(summaryCell, "w-[10%]")}>Percentage</th>
						<th className={cn(summaryCell, "w-[9%]")}>Modified</th>
						<th className={cn(summaryCell, "w-[11%]")}>Percentage</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.section}>
							<td className={cn(summaryCell, numeric)}>{row.serial}</td>
							{/* A branch is named once and reads down its sections, as on the department's sheet. */}
							<td className={summaryBranchCell}>{row.branch ? `${row.branch}(${row.branchSectionCount})` : ""}</td>
							<td className={cn(summaryCell, "text-left")}>{row.section}</td>
							<td className={cn(summaryCell, numeric)}>{row.total}</td>
							<td className={cn(summaryCell, numeric)}>{row.validated}</td>
							<td className={cn(summaryCell, numeric)}>{row.validatedPct}</td>
							<td className={cn(summaryCell, numeric)}>{row.modified ?? ""}</td>
							<td className={cn(summaryCell, numeric)}>{row.modifiedPct}</td>
						</tr>
					))}
					<tr className="bg-zinc-100 font-bold">
						<td className={summaryCell} colSpan={2} />
						<td className={cn(summaryCell, "text-left")}>TOTAL</td>
						<td className={cn(summaryCell, numeric)}>{totals.total}</td>
						<td className={cn(summaryCell, numeric)}>{totals.validated}</td>
						<td className={cn(summaryCell, numeric)}>{totals.validatedPct}</td>
						<td className={cn(summaryCell, numeric)}>{totals.modified ?? ""}</td>
						<td className={cn(summaryCell, numeric)}>{totals.modifiedPct}</td>
					</tr>
				</tbody>
			</table>

			{totals.modified === null && (
				<p className="mt-2 text-[9px] text-zinc-600 italic">
					Modified counts students who revised their resume after a reviewer asked for changes. It fills from the point
					this is in use; earlier edits were not recorded.
				</p>
			)}

			<p className="mt-2 text-right text-[9px]">Generated {formatReportDate(new Date())}</p>
		</SheetChrome>
	);
}
