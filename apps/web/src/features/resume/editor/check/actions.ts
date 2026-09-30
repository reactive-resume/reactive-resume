import type { CheckIssue } from "./issues";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { t } from "@lingui/core/macro";
import { toast } from "@reactive-resume/ui/components/toast";
import { useBreakpoint } from "@reactive-resume/ui/hooks/use-breakpoint";
import { useEditorStore } from "../store";
import { useEditorMode } from "../use-editor-mode";
import { getScrollBehavior, revealSelectionInPanel } from "../write/reveal";
import { useResumeStore } from "@/features/resume/builder/draft";

/** The author's Check choices on a draft, created on first use. */
export function checkStateOf(draft: ResumeData) {
	draft.metadata.check ??= { ignored: [], hiddenTerms: [] };
	return draft.metadata.check;
}

/** One undo step, confirmed in a toast whose Undo takes it back. */
export function editWithUndo(edit: (draft: ResumeData) => void, message: string) {
	const store = useResumeStore.getState();
	store.updateResumeData(edit, { newStep: true });
	toast.add({
		description: message,
		actionProps: { children: t`Undo`, onClick: () => useResumeStore.getState().undo() },
	});
}

/** Scrolls the page to an issue's pin, or the panel to its card. */
export function scrollToIssue(key: string, where: "page" | "panel") {
	requestAnimationFrame(() => {
		const selector =
			where === "page" ? `[data-issue-pin="${CSS.escape(key)}"]` : `[data-issue-card="${CSS.escape(key)}"]`;
		document.querySelector(selector)?.scrollIntoView({ block: "center", behavior: getScrollBehavior() });
	});
}

/** What a Check card can do: fix, open the field in Write, show its line on the page, or set it aside. */
export function useCheckActions() {
	const [, setMode] = useEditorMode();
	const breakpoint = useBreakpoint();

	const showOnPage = (issue: CheckIssue) => {
		const editor = useEditorStore.getState();
		editor.setCheckIssue(issue.key);
		editor.setPageView("page");
		// The page is behind the drawer on tablets and in its own view on phones.
		if (breakpoint === "tablet") editor.setDrawerOpen(false);
		if (breakpoint === "mobile") editor.setMobileView("page");
		scrollToIssue(issue.key, "page");
	};

	const fix = (issue: CheckIssue) => {
		if (issue.fix.kind === "apply") {
			editWithUndo(issue.fix.apply, t`${issue.fix.done}. Issue resolved.`);
			useEditorStore.getState().setCheckIssue(null);
			return;
		}

		setMode("write");
		if (breakpoint === "mobile") useEditorStore.getState().setMobileView("write");
		revealSelectionInPanel(issue.fix.target);
	};

	const ignore = (issue: CheckIssue) => {
		editWithUndo(
			(draft) => {
				const state = checkStateOf(draft);
				if (!state.ignored.includes(issue.key)) state.ignored.push(issue.key);
			},
			issue.keepLabel ? t`Kept as it is` : t`Issue ignored`,
		);
		useEditorStore.getState().setCheckIssue(null);
	};

	const restoreIgnored = () =>
		editWithUndo(
			(draft) => {
				checkStateOf(draft).ignored = [];
			},
			t`Ignored issues are back`,
		);

	return { showOnPage, fix, ignore, restoreIgnored };
}
