import type { FitStep } from "./presets";
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

/** Resolves `true` once a render newer than `version` lands, or `false` when none arrived in time. */
function waitForRender(version: number) {
	return new Promise<boolean>((resolve) => {
		if (useEditorStore.getState().rendered.version > version) return resolve(true);
		const timer = setTimeout(() => {
			unsubscribe();
			resolve(false);
		}, RENDER_TIMEOUT_MS);
		const unsubscribe = useEditorStore.subscribe((state) => {
			if (state.rendered.version <= version) return;
			clearTimeout(timer);
			unsubscribe();
			resolve(true);
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
	// A step whose render never arrived was measured on the page before it: don't take the design back on that.
	let timedOut = false;

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
			if (applied && !(await waitForRender(version))) timedOut = true;
			return useEditorStore.getState().rendered.pageCount <= authored;
		},
	);

	if (!result.fits && timedOut) {
		toast.add({
			type: "warning",
			description: t`The preview took too long to update, so Fit stopped. Check the pages, and use Undo to take its changes back.`,
		});
		return;
	}
	if (!result.fits) {
		// Nothing gained: put the design back, unless something else was edited meanwhile.
		const current = useResumeStore.getState();
		const reverted = !interrupted && !timedOut && !!fitted && current.resume?.data === fitted;
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
