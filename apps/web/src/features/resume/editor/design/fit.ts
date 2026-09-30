import type { FitStep } from "./presets";
import type { PageMap } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import { t } from "@lingui/core/macro";
import { toast } from "@reactive-resume/ui/components/toast";
import { useEditorStore } from "../store";
import { applyDensity, applyMargins, applyTextSize, fitToPages, matchDensity, matchMargins } from "./presets";
import { useResumeStore } from "@/features/resume/builder/draft";

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

/**
 * Fit to the authored pages: tightens density, then margins, then size (never below 9 pt), waiting for the page
 * to re-render after each step. The whole run is one undo step.
 */
export async function runFit() {
	const { resume, updateResumeData, undo } = useResumeStore.getState();
	if (!resume) return;
	const { metadata } = resume.data;
	const authored = Math.max(1, metadata.layout.pages.length);
	const key = `design.fit:${Date.now()}`;
	let version = useEditorStore.getState().rendered.version;
	let applied = false;

	const result = await fitToPages(
		{ density: matchDensity(metadata), margins: matchMargins(metadata), size: metadata.typography.body.fontSize },
		(step) => {
			version = useEditorStore.getState().rendered.version;
			applied = true;
			updateResumeData((draft) => applyStep(draft.metadata, step), { coalesceKey: key, sameStep: true });
		},
		async () => {
			if (applied) await waitForRender(version);
			return useEditorStore.getState().rendered.pageCount <= authored;
		},
	);

	const undoAction = { children: t`Undo`, onClick: undo };
	if (!result.fits) {
		const pages = useEditorStore.getState().rendered.pageCount;
		toast.add({
			type: "warning",
			description: t`Still ${pages} pages at 9 pt. Hide a section or shorten entries.`,
			...(applied ? { actionProps: undoAction } : {}),
		});
		return;
	}
	if (!applied) return;

	const { density, margins, size } = result.state;
	const details = [density ? densityLabel()[density] : null, margins ? marginsLabel()[margins] : null, t`${size} pt`]
		.filter(Boolean)
		.join(", ");
	toast.add({
		description: authored === 1 ? t`Fits on one page: ${details}` : t`Fits on ${authored} pages: ${details}`,
		actionProps: undoAction,
	});
}
