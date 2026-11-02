import type { FitStep } from "./presets";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import { plural, t } from "@lingui/core/macro";
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

/**
 * Fit to the authored pages: tightens density, then margins, then size (never below 9 pt), waiting for the page
 * to re-render after each step. The whole run is one undo step.
 */
export function runFit() {
	const id = useResumeStore.getState().resume?.id;
	if (!id) return Promise.resolve();
	const current = fitting.get(id);
	if (current) return current;
	const run = fitOnce().finally(() => fitting.delete(id));
	fitting.set(id, run);
	return run;
}

// One Fit at a time per resume: a second press joins the run already going instead of reading a page count that
// hasn't caught up with the first run's last step. Runs for different resumes stay apart.
const fitting = new Map<string, Promise<void>>();

async function fitOnce() {
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
			description: plural(pages, {
				one: "Still # page at 9 pt. Hide a section or shorten entries.",
				other: "Still # pages at 9 pt. Hide a section or shorten entries.",
			}),
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
		description: plural(authored, { 1: `Fits on one page: ${details}`, other: `Fits on # pages: ${details}` }),
		actionProps: undoAction,
	});
}
