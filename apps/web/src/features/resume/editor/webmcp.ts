import type { WebMcpTool } from "@/libs/webmcp";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { WritableDraft } from "immer";
import { t } from "@lingui/core/macro";
import { isEqual } from "es-toolkit";
import { useMemo } from "react";
import z from "zod";
import { resumePatchOperationsSchema } from "@reactive-resume/ai/tools/resume-tool-contracts";
import { lintResumeForAts } from "@reactive-resume/resume/ats";
import { applyResumePatches, ResumePatchError } from "@reactive-resume/resume/patch";
import { createResumeDataJsonSchema } from "@reactive-resume/schema/resume/json-schema";
import { templateSchema } from "@reactive-resume/schema/templates";
import { buildIssues } from "./check/issues";
import { useResumeStore, useUpdateResumeData } from "@/features/resume/builder/draft";
import { undoToast } from "@/features/resume/builder/undo-toast";
import { defineWebMcpTool, useWebMcpTools } from "@/libs/webmcp";

type Container = Record<string, unknown> | unknown[];

const isContainer = (value: unknown): value is Container => typeof value === "object" && value !== null;

/**
 * Writes `next` over `target`, an Immer draft of `before`, assigning only what differs. The parts a patch left alone
 * keep their references, so the editor re-renders the edited fields instead of the whole resume.
 */
export function assignChanged(target: Container, before: Container, next: Container) {
	const draft = target as Record<string, unknown>;
	const previous = before as Record<string, unknown>;

	// Arrays only get here at equal lengths (see below), so only objects can lose keys.
	if (!Array.isArray(next)) for (const key of Object.keys(draft)) if (!Object.hasOwn(next, key)) delete draft[key];

	for (const [key, value] of Object.entries(next)) {
		const old = previous[key];
		if (isEqual(old, value)) continue;

		const sameShape =
			isContainer(old) &&
			isContainer(value) &&
			Array.isArray(old) === Array.isArray(value) &&
			(!Array.isArray(old) || old.length === (value as unknown[]).length);

		if (sameShape) assignChanged(draft[key] as Container, old, value);
		else draft[key] = value;
	}
}

function describePatchError(error: unknown): string {
	// Named by op and path: fast-json-patch reports index 0 for some failures, whichever operation it was.
	if (error instanceof ResumePatchError) {
		const { op, path } = error.operation;
		return `The ${op} operation at ${path} failed: ${error.message} Nothing was changed.`;
	}
	const message = error instanceof Error ? error.message : String(error);
	return `${message} Nothing was changed.`;
}

/** The resume this editor has open, as on screen: with edits that haven't reached the server yet. */
function getOpenResume(resumeId: string) {
	const resume = useResumeStore.getState().resume;
	if (resume?.id !== resumeId) throw new Error("The resume is no longer open in the editor.");
	return resume;
}

const noInput = z.object({});

const readResumeSchemaTool = defineWebMcpTool({
	name: "read_resume_schema",
	title: "Read resume schema",
	description:
		"Get the JSON Schema of resume data: every section, field, type and allowed value. Read it before adding entries or sections, or when apply_resume_patch rejects a value.",
	input: noInput,
	annotations: { readOnlyHint: true },
	execute: () => createResumeDataJsonSchema(),
});

function createResumeTools(
	resumeId: string,
	updateResumeData: ReturnType<typeof useUpdateResumeData>,
): readonly WebMcpTool[] {
	const readResume = defineWebMcpTool({
		name: "read_resume",
		title: "Read resume",
		description: [
			"Get the resume open in this editor as JSON, exactly as on screen (including edits not saved yet):",
			"basics (name, headline, email, phone, location, website), summary, picture, sections (experience, education,",
			"skills, projects, etc.), customSections, and metadata (template, layout, typography, design, page, notes).",
			"Read it before apply_resume_patch to find the paths and current values.",
		].join(" "),
		input: noInput,
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		execute: () => {
			const { id, name, slug, tags, isLocked, isPublic, data } = getOpenResume(resumeId);
			return { id, name, slug, tags, isLocked, isPublic: isPublic ?? false, data };
		},
	});

	const applyResumePatch = defineWebMcpTool({
		name: "apply_resume_patch",
		title: "Edit resume",
		description: [
			"Edit the resume open in this editor with JSON Patch (RFC 6902) operations: add, remove, replace, move, copy, test.",
			"The page updates at once, the change saves automatically, and the user can undo it as one step.",
			"All operations apply together, or none do. Read the resume first with read_resume.",
			"Example paths: /basics/name, /basics/headline, /summary/content (HTML),",
			"/sections/experience/items/- (append an entry), /sections/experience/items/0/description (HTML),",
			"/sections/skills/items/-, /sections/interests/hidden, /metadata/design/colors/primary (rgba string),",
			`/metadata/template (one of ${templateSchema.options.join(", ")}).`,
			"Dates: write `dates` ({ start, end, present } with years or year-months, '2022' or '2022-03'); the text in",
			"`period` (or `date`) is rewritten from it. Rich text fields take HTML (<p>, <ul><li>, <strong>, <a>).",
			"New entries need a UUID `id` and `hidden: false`; read_resume_schema lists every field.",
			"Locked resumes can't be edited: ask the user to unlock it.",
		].join(" "),
		input: z.object({ operations: resumePatchOperationsSchema }),
		execute: ({ operations }) => {
			const resume = getOpenResume(resumeId);
			if (resume.isLocked) throw new Error("This resume is locked. Ask the user to unlock it before editing.");

			const before = resume.data;
			let next: ResumeData;
			try {
				next = applyResumePatches(before, operations);
			} catch (error) {
				throw new Error(describePatchError(error), { cause: error });
			}

			if (isEqual(before, next)) return "The patch changed nothing.";

			updateResumeData((draft: WritableDraft<ResumeData>) => assignChanged(draft, before, next), { newStep: true });
			undoToast(t`Your browser's AI agent edited this resume.`, { id: "webmcp-resume-edit" });

			const count = operations.length;
			return `Applied ${count} operation${count === 1 ? "" : "s"}. The change saves automatically.`;
		},
	});

	const checkResume = defineWebMcpTool({
		name: "check_resume",
		title: "Check resume",
		description: [
			"Run the editor's Check on the open resume: whether applicant tracking systems can read it (contact details,",
			"dates, layout, section headings, writing). Returns a score (percentage of rules passed) and the open issues,",
			"most severe first, each with a JSON pointer to the value it is about, for fixing with apply_resume_patch.",
			"Issues the user chose to ignore are left out.",
		].join(" "),
		input: noInput,
		annotations: { readOnlyHint: true },
		execute: () => {
			const { data } = getOpenResume(resumeId);
			const report = lintResumeForAts(data);

			return {
				score: report.score,
				passedRules: report.passedRules,
				totalRules: report.totalRules,
				ignoredIssues: report.ignored.length,
				issues: buildIssues(report, data).map((issue) => ({
					severity: issue.finding.severity,
					category: issue.category,
					title: issue.title,
					detail: issue.body,
					pointer: issue.finding.pointer,
				})),
			};
		},
	});

	return [readResume, readResumeSchemaTool, applyResumePatch, checkResume];
}

/** Offers the open resume to the browser's AI agent while the editor is mounted. */
export function useResumeWebMcpTools(resumeId: string) {
	const updateResumeData = useUpdateResumeData();
	const tools = useMemo(() => createResumeTools(resumeId, updateResumeData), [resumeId, updateResumeData]);
	useWebMcpTools(tools);
}
