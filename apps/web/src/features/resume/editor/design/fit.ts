import type { FitStep } from "./presets";
import type { PageMap } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import { plural, t } from "@lingui/core/macro";
import { addPageWith, spillingSections } from "@reactive-resume/resume/spill";
import { toast } from "@reactive-resume/ui/components/toast";
import { useEditorStore } from "../store";
import { applyDensity, applyMargins, applyTextSize, fitToPages, matchDensity, matchMargins } from "./presets";
import { useResumeStore } from "@/features/resume/builder/draft";
import { undoToast } from "@/features/resume/builder/undo-toast";

const RENDER_TIMEOUT_MS = 8000;

/** Resolves once a render newer than `version` is on screen (or after a timeout, so Fit never hangs). */
function waitForRender(version: number) {
	return new Promise<void>((resolve) => {
		if (useEditorStore.getState().rendered.version > version) return resolve();
		const timer = setTimeout(() => {
			unsubscribe();
			resolve();
		}, RENDER_TIMEOUT_MS);
		const unsubscribe = useEditorStore.subscribe((state) => {
			if (state.rendered.version <= version) return;
			clearTimeout(timer);
			unsubscribe();
			resolve();
		});
	});
}

function applyStep(metadata: WritableDraft<ResumeData["metadata"]>, step: FitStep) {
	if ("density" in step) applyDensity(metadata, step.density);
	else if ("margins" in step) applyMargins(metadata, step.margins);
	else applyTextSize(metadata, step.size);
}

const densityLabel = () => ({ compact: t`Compact`, normal: t`Normal`, roomy: t`Roomy` });
const marginsLabel = () => ({ narrow: t`narrow margins`, normal: t`normal margins`, wide: t`wide margins` });

/** How far the content runs past the authored pages, in lines of body text, from the page map on screen. */
export function measureOverflow(data: ResumeData, rendered: { pageCount: number; pageMap: PageMap | undefined }) {
	const authored = Math.max(1, data.metadata.layout.pages.length);
	if (rendered.pageCount <= authored) return null;

	// The extent of the content on each spill page (positions are per page), summed.
	const extents = new Map<number, { top: number; bottom: number }>();
	for (const node of rendered.pageMap?.nodes ?? []) {
		if (node.page < authored) continue;
		const extent = extents.get(node.page);
		extents.set(node.page, {
			top: Math.min(extent?.top ?? node.y, node.y),
			bottom: Math.max(extent?.bottom ?? 0, node.y + node.height),
		});
	}
	const height = [...extents.values()].reduce((sum, extent) => sum + extent.bottom - extent.top, 0);
	const lineHeight = data.metadata.typography.body.fontSize * data.metadata.typography.body.lineHeight;
	const lines = height > 0 && lineHeight > 0 ? Math.max(1, Math.round(height / lineHeight)) : null;
	return { authored, pageCount: rendered.pageCount, lines };
}

/** Adds a page after the last one and moves the sections that spill onto it, as one undo step. */
export function addSpillPage() {
	const { resume, updateResumeData } = useResumeStore.getState();
	if (!resume || resume.isLocked) return false;
	const moving = spillingSections(resume.data.metadata.layout.pages, useEditorStore.getState().rendered.pageMap?.nodes);
	if (!moving) {
		toast.add({
			type: "info",
			description: t`One section fills the last page, so there's nothing to move onto a new one. Shorten it, or split it in Design → Page → Pages and sections.`,
		});
		return false;
	}
	const page = resume.data.metadata.layout.pages.length + 1;
	updateResumeData((draft) => addPageWith(draft.metadata.layout.pages, moving), { newStep: true });
	const count = moving.main.length + moving.sidebar.length;
	undoToast(
		plural(count, {
			one: `Added page ${page} and moved # section onto it`,
			other: `Added page ${page} and moved # sections onto it`,
		}),
	);
	return true;
}

/**
 * Fit to the authored pages: tightens density, then margins, then size (never below 9 pt), waiting for the page
 * to re-render after each step. The whole run is one undo step. When even that doesn't fit, it takes its own steps
 * back and says so, offering a page instead.
 */
export async function runFit() {
	const { resume, updateResumeData } = useResumeStore.getState();
	if (!resume) return;
	const { metadata } = resume.data;
	const authored = Math.max(1, metadata.layout.pages.length);
	const key = `design.fit:${Date.now()}`;
	let version = useEditorStore.getState().rendered.version;
	let applied = false;
	let fitted: ResumeData | undefined;
	// An edit between two steps starts its own undo step, so one Undo could no longer take the whole run back.
	let expected: ResumeData | undefined = resume.data;
	let interrupted = false;

	const result = await fitToPages(
		{ density: matchDensity(metadata), margins: matchMargins(metadata), size: metadata.typography.body.fontSize },
		(step) => {
			version = useEditorStore.getState().rendered.version;
			applied = true;
			if (useResumeStore.getState().resume?.data !== expected) interrupted = true;
			updateResumeData((draft) => applyStep(draft.metadata, step), { coalesceKey: key, sameStep: true });
			fitted = useResumeStore.getState().resume?.data;
			expected = fitted;
		},
		async () => {
			if (applied) await waitForRender(version);
			return useEditorStore.getState().rendered.pageCount <= authored;
		},
	);

	if (!result.fits) {
		// Nothing gained: put the design back, unless something else was edited meanwhile.
		const current = useResumeStore.getState();
		const reverted = !interrupted && !!fitted && current.resume?.data === fitted;
		if (reverted) current.undo();
		const addPage = { children: t`Add page ${authored + 1}`, onClick: () => void addSpillPage() };
		toast.add({
			type: "warning",
			description: reverted
				? plural(authored, {
						1: "Couldn't fit on one page, even at 9 pt, so the design is back as it was. Add a page or shorten entries.",
						other:
							"Couldn't fit on # pages, even at 9 pt, so the design is back as it was. Add a page or shorten entries.",
					})
				: plural(authored, {
						1: "Couldn't fit on one page, even at 9 pt. Add a page or shorten entries.",
						other: "Couldn't fit on # pages, even at 9 pt. Add a page or shorten entries.",
					}),
			actionProps: addPage,
		});
		return;
	}
	if (!applied) return;

	const { density, margins, size } = result.state;
	const details = [density ? densityLabel()[density] : null, margins ? marginsLabel()[margins] : null, t`${size} pt`]
		.filter(Boolean)
		.join(", ");
	undoToast(plural(authored, { 1: `Fits on one page: ${details}`, other: `Fits on # pages: ${details}` }));
}
