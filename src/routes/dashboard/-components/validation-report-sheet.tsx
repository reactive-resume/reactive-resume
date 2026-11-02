import { t } from "@lingui/core/macro";
import { PrinterIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
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
};

function SheetChrome({ onClose, children, note }: SheetChromeProps) {
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
				<div className="print-sheet rounded-xl bg-white p-6 text-black shadow-lg">{children}</div>
			</div>
		</div>
	);
}

const cell = "border border-black px-1 py-0 leading-[1.15] align-middle";

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
	const { left, fontPt } = printLayout(rows);
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
	const fontPt = rows.length <= 34 ? 9 : 8;

	return (
		<SheetChrome onClose={onClose}>
			<div className="mb-1 text-center">
				<img
					src={`${import.meta.env.BASE_URL}reports/institute-logo.png`}
					alt=""
					className="mx-auto mb-0.5 h-9 object-contain"
				/>
				<p className="font-bold text-[12px]">MENTORING, TRAINING &amp; PLACEMENTS DEPARTMENT</p>
				<p className="font-semibold text-[11px]">{title}</p>
			</div>

			<table className="w-full border-collapse" style={{ fontSize: `${fontPt}pt` }}>
				<thead>
					<tr className="font-semibold">
						<th className={cn(cell, "w-[6%]")} rowSpan={2}>
							Sl. No
						</th>
						<th className={cn(cell, "text-left")} rowSpan={2}>
							Branch(No. of Sections)
						</th>
						<th className={cn(cell, "w-[16%]")} rowSpan={2}>
							Section
						</th>
						<th className={cell} colSpan={4}>
							CV validation status
						</th>
					</tr>
					<tr className="font-semibold">
						<th className={cn(cell, "w-[9%]")}>Total</th>
						<th className={cn(cell, "w-[10%]")}>Validated</th>
						<th className={cn(cell, "w-[11%]")}>Percentage</th>
						<th className={cn(cell, "w-[10%]")}>Modified</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={row.section}>
							<td className={cn(cell, "text-center")}>{row.serial}</td>
							<td className={cn(cell, "text-left")}>{row.branch ? `${row.branch}(${row.branchSectionCount})` : ""}</td>
							<td className={cn(cell, "text-left")}>{row.section}</td>
							<td className={cn(cell, "text-center")}>{row.total}</td>
							<td className={cn(cell, "text-center")}>{row.validated}</td>
							<td className={cn(cell, "text-center")}>{row.validatedPct}</td>
							<td className={cn(cell, "text-center")}>{row.modified ?? ""}</td>
						</tr>
					))}
					<tr className="font-bold">
						<td className={cell} colSpan={2} />
						<td className={cn(cell, "text-left")}>TOTAL</td>
						<td className={cn(cell, "text-center")}>{totals.total}</td>
						<td className={cn(cell, "text-center")}>{totals.validated}</td>
						<td className={cn(cell, "text-center")}>{totals.validatedPct}</td>
						<td className={cn(cell, "text-center")}>{totals.modified ?? ""}</td>
					</tr>
				</tbody>
			</table>

			<p className="mt-2 text-right text-[9px]">Generated {formatReportDate(new Date())}</p>
		</SheetChrome>
	);
}
