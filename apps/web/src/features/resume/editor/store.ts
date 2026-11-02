import type { PageMap, PageMapTarget } from "@reactive-resume/pdf/page-map";
import type { PdfAtsReport } from "@reactive-resume/resume/ats-pdf";
import type { Proposal } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { create } from "zustand/react";

export const EDITOR_MODES = ["write", "design", "check", "share"] as const;
export type EditorMode = (typeof EDITOR_MODES)[number];

/** The Download & history sheet's tabs; each entry point opens its own. */
export type SheetTab = "download" | "history";

export type CheckTab = "issues" | "match" | "writing";

/** Phones show one view at a time: the page, or one mode's panel. */
export type MobileView = "page" | EditorMode;

/** A writing note that isn't a rewrite: where it is, how much it matters, the words and what to consider. */
export type WritingNote = {
	location: string;
	impact: "high" | "medium" | "low";
	quote: string;
	rewrite?: string;
	note: string;
	target: PageMapTarget | null;
};

/** Check → Writing: the model's review. Its rewrites are the proposals. */
type WritingReview = { summary: string; strengths: readonly string[]; notes: readonly WritingNote[] };

/** What's selected in the editor: shared by the panel and the page, so each can outline the other. */
export type EditorSelection = PageMapTarget;

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.1;

type EditorStore = {
	/** The mode just picked, shown while `?mode=` catches up (every navigation refetches the session first). */
	pendingMode: EditorMode | null;
	selection: EditorSelection | null;
	/** "fit" fits the page width to the canvas; otherwise an explicit scale between 60% and 150%. */
	zoom: number | "fit";
	/** Tablet only: the panel is a drawer over the page. */
	drawerOpen: boolean;
	/** Tablet in landscape: the panel sits beside the page instead of over it. */
	drawerPinned: boolean;
	/** The open tab of the Download & history sheet, or null while it's closed. */
	sheetTab: SheetTab | null;
	/** History: the version shown on the page, read-only, instead of the current resume. */
	historyVersionId: string | null;
	assistantOpen: boolean;
	/** ⌘J toggled the assistant: its column, drawer or screen switches without a transition. */
	assistantInstant: boolean;
	/** The assistant's conversation: a thread id, "new" for a fresh one, or null for the document's latest. */
	assistantThread: string | null;
	/** A message to send once the assistant is ready, from ⌘K Ask or Job match. Never from a link. */
	assistantPrompt: string | null;
	/** Text from a link (`?ask=`) put in the composer, sent only when the user presses Send. */
	assistantDraft: string | null;
	/** The assistant's pending edits, marked on the page and counted in the outline. */
	assistantProposals: readonly Proposal[];
	/** Prepare for next step (Applications) opens the assistant with suggestions for the application. */
	assistantSuggestions: "prepare" | null;
	/** Write: sections open in the outline. */
	openSections: readonly string[];
	/** Write: sections added this visit that are still empty (a summary before any text), so they stay listed. */
	addedSections: readonly string[];
	/** Write: a new draft whose first field takes focus once it renders. */
	focusEntryId: string | null;
	/** Write: the Basics card. It collapses when an entry is picked on the page. */
	basicsOpen: boolean;
	/** Design: a template shown on the page while its thumbnail is hovered or focused, not yet applied. */
	previewTemplate: Template | null;
	/** Custom Styles: the page nodes matched by the rule the cursor is in, outlined on the page. */
	styleHighlight: readonly string[];
	/**
	 * The render on screen: physical pages, the page map and the PDF (which Check's parser view reads). `version`
	 * counts renders, so Fit can wait for one.
	 */
	rendered: { pageCount: number; pageMap: PageMap | undefined; file: Blob | undefined; version: number };
	/**
	 * The last render of the resume as it is, without proposed edits marked on it: page fit is measured on this, so
	 * struck-through old text doesn't count against the page while edits wait.
	 */
	fitRendered: { pageCount: number; pageMap: PageMap | undefined };
	/** Phones: the view on screen; null until one is picked, which shows the current mode. */
	mobileView: MobileView | null;
	checkTab: CheckTab;
	/** Check: the issue picked on its card or pin (its key). Both are outlined. */
	checkIssue: string | null;
	/** Check: the page as a person sees it, or the text a parser reads from it. */
	pageView: "page" | "parser";
	/** Check → Job match: a term whose entries are tinted on the page. */
	highlightTerm: string | null;
	/** Check → Job match: a posting pasted for this visit, for a resume with no application linked. */
	pastedPosting: string;
	/** Edits suggested for the page (Check → Writing), shown on it until accepted or rejected. */
	proposals: readonly Proposal[];
	writingReview: WritingReview | null;
	/**
	 * Check's deep check: the report on the exported PDF, and the resume it was run on. Its findings are pinned to
	 * the page only while the resume is unchanged.
	 */
	exportCheck: { report: PdfAtsReport; data: ResumeData } | null;
	exportReportOpen: boolean;
	setZoom: (zoom: number | "fit") => void;
	/** Opens the sheet on a tab, or closes it (which also returns the page to now). */
	setSheetTab: (tab: SheetTab | null) => void;
	setAssistantOpen: (open: boolean, instant?: boolean) => void;
	setSectionOpen: (sectionId: string, open: boolean) => void;
	markSectionAdded: (sectionId: string) => void;
	/** `marked`: the render shows proposed edits (or a template preview), so it doesn't measure fit. */
	setRendered: (render: { pageCount: number; pageMap: PageMap | undefined; file: Blob }, marked?: boolean) => void;
	setProposalStatus: (ids: readonly string[], status: Proposal["status"]) => void;
	reset: () => void;
};

const clampZoom = (zoom: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 100) / 100));

export const isSameSelection = (a: EditorSelection | null, b: EditorSelection | null) => {
	if (!a || !b) return a === b;
	if (a.kind !== b.kind) return false;
	if (a.kind === "header") return true;
	if (a.kind === "section" && b.kind === "section") return a.sectionId === b.sectionId;
	if (a.kind === "item" && b.kind === "item") return a.sectionId === b.sectionId && a.itemId === b.itemId;
	return false;
};

const initialState = {
	pendingMode: null,
	selection: null,
	zoom: "fit",
	drawerOpen: false,
	drawerPinned: false,
	sheetTab: null,
	historyVersionId: null,
	assistantOpen: false,
	assistantInstant: false,
	assistantThread: null,
	assistantPrompt: null,
	assistantDraft: null,
	assistantProposals: [],
	assistantSuggestions: null,
	openSections: [],
	addedSections: [],
	focusEntryId: null,
	basicsOpen: true,
	previewTemplate: null,
	styleHighlight: [],
	rendered: { pageCount: 0, pageMap: undefined, file: undefined, version: 0 },
	fitRendered: { pageCount: 0, pageMap: undefined },
	mobileView: null,
	checkTab: "issues",
	checkIssue: null,
	pageView: "page",
	highlightTerm: null,
	pastedPosting: "",
	proposals: [],
	writingReview: null,
	exportCheck: null,
	exportReportOpen: false,
} as const;

export const useEditorStore = create<EditorStore>()((set) => ({
	...initialState,
	setZoom: (zoom) => set({ zoom: zoom === "fit" ? "fit" : clampZoom(zoom) }),
	setSheetTab: (sheetTab) => set(sheetTab ? { sheetTab } : { sheetTab, historyVersionId: null }),
	setAssistantOpen: (assistantOpen, instant = false) => set({ assistantOpen, assistantInstant: instant }),
	setSectionOpen: (sectionId, open) =>
		set((state) => {
			const isOpen = state.openSections.includes(sectionId);
			if (isOpen === open) return state;
			return {
				openSections: open ? [...state.openSections, sectionId] : state.openSections.filter((id) => id !== sectionId),
			};
		}),
	markSectionAdded: (sectionId) =>
		set((state) =>
			state.addedSections.includes(sectionId) ? state : { addedSections: [...state.addedSections, sectionId] },
		),
	setRendered: (render, marked = false) =>
		set((state) => ({
			rendered: { ...render, version: state.rendered.version + 1 },
			...(marked ? {} : { fitRendered: { pageCount: render.pageCount, pageMap: render.pageMap } }),
		})),
	setProposalStatus: (ids, status) =>
		set((state) => ({
			proposals: state.proposals.map((proposal) => (ids.includes(proposal.id) ? { ...proposal, status } : proposal)),
		})),
	reset: () =>
		set((state) => ({ ...initialState, rendered: { ...initialState.rendered, version: state.rendered.version + 1 } })),
}));
