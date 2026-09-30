import type { CheckIssue } from "./issues";
import type { PageMap, PageMapNode, PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { getProposalState } from "@reactive-resume/resume/proposals";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { cn } from "@reactive-resume/utils/style";
import { isSameSelection, useEditorStore } from "../store";
import { findEntry } from "../write/model";
import { scrollToIssue, useCheckActions } from "./actions";
import { useCheck } from "./use-check";
import { getPdfFindingMessage } from "@/features/ats-checker/messages";

const toTarget = (node: PageMapNode): PageMapTarget => {
	if (node.kind === "item") return { kind: "item", sectionId: node.sectionId, itemId: node.itemId };
	if (node.kind === "section") return { kind: "section", sectionId: node.sectionId };
	return { kind: "header" };
};

/** The first block drawn for a target, on whichever page it starts. */
const findNode = (pageMap: PageMap, target: PageMapTarget) =>
	pageMap.nodes.find((node) => isSameSelection(toTarget(node), target));

/**
 * A marker in the page margin, level with the top of a block: 30px left of it, but never off the page, whose
 * margins can be narrower than the marker. `stack` moves further markers on the same block down.
 */
type Box = Pick<PageMapNode, "x" | "y" | "width" | "height">;

const marginStyle = (node: Box, page: { width: number; height: number }, stack = 0): CSSProperties => ({
	left: `max(4px, calc(${(node.x / page.width) * 100}% - 30px))`,
	top: `calc(${(node.y / page.height) * 100}% - 3px + ${stack * 26}px)`,
});

/** Page-relative placement of a block, as percentages of its page. */
function boxStyle(node: Box, page: { width: number; height: number }): CSSProperties {
	return {
		left: `${(node.x / page.width) * 100}%`,
		top: `${(node.y / page.height) * 100}%`,
		width: `${(node.width / page.width) * 100}%`,
		height: `${(node.height / page.height) * 100}%`,
	};
}

const text = (value: unknown): string =>
	typeof value === "string"
		? value
		: typeof value === "object" && value
			? Object.values(value).map(text).join(" ")
			: "";

/** The blocks whose text mentions a term: the header, the summary or entries. */
function targetsMentioning(data: ResumeData, term: string): PageMapTarget[] {
	const needle = term.toLowerCase();
	const mentions = (value: unknown) => text(value).toLowerCase().includes(needle);
	const targets: PageMapTarget[] = [];

	if (mentions(data.basics)) targets.push({ kind: "header" });
	if (mentions(data.summary.content)) targets.push({ kind: "section", sectionId: "summary" });

	const sections = [
		...Object.entries(data.sections).map(([id, section]) => ({ id, items: section.items as { id: string }[] })),
		...data.customSections.map((section) => ({ id: section.id, items: section.items as { id: string }[] })),
	];
	for (const section of sections) {
		for (const item of section.items) {
			if (mentions(findEntry(data, section.id, item.id))) {
				targets.push({ kind: "item", sectionId: section.id, itemId: item.id });
			}
		}
	}

	return targets;
}

type CheckPageLayerProps = { pageIndex: number; pageMap: PageMap | undefined };

/**
 * Check's marks on one page: numbered warn pins with a wavy underline for open issues, numbered accent markers for
 * proposed edits (while Writing is open), and a highlight on the entries that mention the picked job-match term.
 */
export function CheckPageLayer({ pageIndex, pageMap }: CheckPageLayerProps) {
	const check = useCheck();
	const tab = useEditorStore((state) => state.checkTab);
	const selected = useEditorStore((state) => state.checkIssue);
	const highlightTerm = useEditorStore((state) => state.highlightTerm);
	const proposals = useEditorStore((state) => state.proposals);
	const exportCheck = useEditorStore((state) => state.exportCheck);
	const openExportReport = useEditorStore((state) => state.setExportReportOpen);
	const breakpoint = useBreakpoint();
	const page = pageMap?.pages[pageIndex];

	const highlighted = check && highlightTerm && tab === "match" ? targetsMentioning(check.data, highlightTerm) : [];

	if (!check || !pageMap || !page || page.width <= 0 || page.height <= 0) return null;

	const pickIssue = (issue: CheckIssue) => {
		const editor = useEditorStore.getState();
		editor.setCheckIssue(issue.key);
		editor.setCheckTab("issues");
		// Tablets: the drawer opens on the issue. Phones stay on the page, where the issue bar steps through them.
		if (breakpoint === "tablet") editor.setDrawerOpen(true);
		if (breakpoint !== "mobile") scrollToIssue(issue.key, "panel");
	};

	const perBlock = new Map<string, number>();
	const pins =
		tab === "writing"
			? []
			: check.issues.flatMap((issue) => {
					const node = issue.target ? findNode(pageMap, issue.target) : undefined;
					if (!node || node.page !== pageIndex) return [];
					const stack = perBlock.get(node.key) ?? 0;
					perBlock.set(node.key, stack + 1);
					return [{ issue, node, stack }];
				});

	const markers =
		tab === "writing"
			? proposals.flatMap((proposal, index) => {
					if (getProposalState(check.data, proposal) !== "pending") return [];
					const target: PageMapTarget = proposal.target.itemId
						? { kind: "item", sectionId: proposal.target.sectionId, itemId: proposal.target.itemId }
						: { kind: "section", sectionId: proposal.target.sectionId };
					const node = findNode(pageMap, target);
					return node && node.page === pageIndex ? [{ number: index + 1, node }] : [];
				})
			: [];

	// The deep check's findings, where it found them in the exported PDF: the same pages as the preview, as long as
	// the resume hasn't changed since it ran.
	const exportPins =
		tab === "issues" && exportCheck?.data === check.data
			? [...exportCheck.report.findings, ...exportCheck.report.tips].flatMap((finding, index) => {
					const { page: pageNumber, box } = finding.evidence ?? {};
					return box && pageNumber === pageIndex + 1 ? [{ finding, box, key: `${finding.code}:${index}` }] : [];
				})
			: [];

	const tinted = highlighted.flatMap((target) =>
		pageMap.nodes.filter((node) => node.page === pageIndex && isSameSelection(toTarget(node), target)),
	);

	return (
		<div data-slot="check-page-layer" className="pointer-events-none absolute inset-0">
			{tinted.map((node) => (
				<div
					key={`tint:${node.key}:${node.y}`}
					aria-hidden="true"
					className="absolute -m-[3px] rounded-[3px] bg-[#F2DE8C]/45 p-[3px] mix-blend-multiply"
					style={boxStyle(node, page)}
				/>
			))}

			{pins.map(({ issue, node, stack }) => {
				const isSelected = selected === issue.key;
				return (
					<div key={issue.key}>
						<div aria-hidden="true" className="absolute" style={boxStyle(node, page)}>
							<div
								className={cn(
									"absolute -inset-x-1.5 -inset-y-[3px] rounded-[3px] outline-[1.5px] transition-[outline-color] duration-quick outline-solid",
									isSelected ? "outline-warn" : "outline-transparent",
								)}
							/>
							{stack === 0 && <div className="wavy-underline absolute inset-x-0 -bottom-1 h-1" />}
						</div>
						<button
							type="button"
							data-issue-pin={issue.key}
							aria-label={t`Issue ${issue.number}: ${issue.title}`}
							aria-pressed={isSelected}
							onClick={() => pickIssue(issue)}
							style={marginStyle(node, page, stack)}
							className={cn(
								"pointer-events-auto absolute grid size-[22px] place-items-center rounded-full border-2 border-white bg-warn text-[11px] font-bold text-[oklch(0.22_0.03_80)] shadow-[0_1px_3px_oklch(0_0_0/0.25)]",
								isSelected && "outline-2 outline-offset-1 outline-warn",
							)}
						>
							{issue.number}
						</button>
					</div>
				);
			})}

			{exportPins.map(({ finding, box, key }) => (
				<div key={key}>
					<div
						aria-hidden="true"
						className="absolute -m-[3px] rounded-[3px] border-[1.5px] border-dashed border-info-text p-[3px]"
						style={boxStyle(box, page)}
					/>
					<button
						type="button"
						data-export-pin={finding.code}
						aria-label={t`Exported PDF: ${getPdfFindingMessage(finding.code).title}`}
						title={getPdfFindingMessage(finding.code).title}
						onClick={() => openExportReport(true)}
						style={marginStyle(box, page)}
						className="pointer-events-auto absolute grid size-[22px] place-items-center rounded-full border-2 border-white bg-info-text text-bg shadow-[0_1px_3px_oklch(0_0_0/0.25)]"
					>
						<Icon name="picture_as_pdf" size={13} />
					</button>
				</div>
			))}

			{markers.map(({ number, node }) => (
				<span
					key={`marker:${number}`}
					aria-hidden="true"
					className="absolute grid size-5 place-items-center rounded-full bg-accent text-[11px] font-bold text-on-accent"
					style={marginStyle(node, page)}
				>
					{number}
				</span>
			))}
		</div>
	);
}

/** "What a person sees / What a parser reads", floating over the canvas in Check. Switching is instant. */
export function PageViewToggle() {
	const view = useEditorStore((state) => state.pageView);
	const setView = useEditorStore((state) => state.setPageView);
	const options = [
		{ value: "page", label: t`What a person sees`, icon: "description" },
		{ value: "parser", label: t`What a parser reads`, icon: "data_object" },
	] as const;

	return (
		<fieldset className="absolute top-3.5 left-1/2 z-10 flex -translate-x-1/2 gap-0.5 rounded-[10px] border border-line bg-raised p-[3px] shadow-e1">
			<legend className="sr-only">
				<Trans>Page view</Trans>
			</legend>
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					aria-pressed={view === option.value}
					onClick={() => setView(option.value)}
					className={cn(
						"flex h-[30px] items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium whitespace-nowrap max-sm:px-2",
						view === option.value ? "bg-ink text-bg" : "text-ink-2 hover:bg-hover",
					)}
				>
					<Icon name={option.icon} size={18} />
					<span className="max-sm:sr-only">{option.label}</span>
				</button>
			))}
		</fieldset>
	);
}

/**
 * Phones (B2): with an issue picked, the page shows "Issue n of m" with ‹ › to step through them, and the card's
 * fix below, so fixing never needs the panel.
 */
export function IssueStepper() {
	const check = useCheck();
	const selected = useEditorStore((state) => state.checkIssue);
	const setCheckIssue = useEditorStore((state) => state.setCheckIssue);
	const { fix } = useCheckActions();

	const issues = check?.issues ?? [];
	const index = issues.findIndex((issue) => issue.key === selected);
	const issue = issues[index];
	if (!issue) return null;

	const go = (step: number) => {
		const next = issues[(index + step + issues.length) % issues.length];
		if (!next) return;
		setCheckIssue(next.key);
		scrollToIssue(next.key, "page");
	};

	return (
		<>
			<div className="absolute inset-x-3 top-3 z-10 flex h-11 items-center gap-1 rounded-xl bg-ink px-1 text-bg shadow-e3">
				<button
					type="button"
					aria-label={t`Close`}
					onClick={() => setCheckIssue(null)}
					className="grid size-9 place-items-center rounded-lg"
				>
					<Icon name="close" size={20} />
				</button>
				<span className="flex-1 text-center text-sm font-semibold">
					<Trans>
						Issue {issue.number} of {issues.length}
					</Trans>
				</span>
				<button
					type="button"
					aria-label={t`Previous issue`}
					onClick={() => go(-1)}
					className="grid size-9 place-items-center rounded-lg"
				>
					<Icon name="chevron_left" size={20} />
				</button>
				<button
					type="button"
					aria-label={t`Next issue`}
					onClick={() => go(1)}
					className="grid size-9 place-items-center rounded-lg"
				>
					<Icon name="chevron_right" size={20} />
				</button>
			</div>

			<section
				aria-label={t`Issue ${issue.number}`}
				className="absolute inset-x-3 bottom-3 z-10 grid gap-2 rounded-xl border border-line bg-surface p-3.5 shadow-e3"
			>
				<strong className="text-[15px] font-semibold">{issue.title}</strong>
				<p className="text-[13px] leading-[19px] text-ink-2">{issue.body}</p>
				<Button size="sm" className="h-10 w-fit px-3.5 text-sm" onClick={() => fix(issue)}>
					{issue.fix.kind === "apply" ? <Icon name={issue.fix.icon} size={18} /> : <Icon name="edit" size={18} />}
					{issue.fix.label}
				</Button>
			</section>
		</>
	);
}
