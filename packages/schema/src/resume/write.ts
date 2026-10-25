import type { ResumeData } from "./data";
import z from "zod";
import { resumeDataSchema } from "./data";
import { createResumeDataJsonSchema } from "./json-schema";

const publishedInputSchema = z.fromJSONSchema(createResumeDataJsonSchema());

// Write-only caps, so stored resumes over them still load. The document cap matches the JSON Patch copy budget in
// `@reactive-resume/resume/patch`. The text cap is far beyond any real field and above the 128 KiB stylesheet limit;
// `url` values are exempt because a picture may be a data URL, which the document cap still bounds.
const MAX_DOCUMENT_CHARS = 10_000_000;
const MAX_TEXT_CHARS = 200_000;

function findOversizedText(value: unknown, path: PropertyKey[] = []): PropertyKey[] | undefined {
	if (typeof value === "string") return value.length > MAX_TEXT_CHARS ? path : undefined;
	if (typeof value !== "object" || value === null) return undefined;

	for (const [key, child] of Object.entries(value)) {
		if (key === "url") continue;
		const found = findOversizedText(child, [...path, Array.isArray(value) ? Number(key) : key]);
		if (found) return found;
	}

	return undefined;
}

/** Validate submitted values before tolerant read-time fallbacks can replace them. */
export const writableResumeDataSchema = z.transform<z.input<typeof resumeDataSchema>, ResumeData>((input, ctx) => {
	// Keep canonical diagnostics and migrations, including historical stylesheet metadata.
	const canonical = resumeDataSchema.safeParse(input);
	if (!canonical.success) {
		for (const issue of canonical.error.issues) ctx.addIssue({ ...issue });
		return z.NEVER;
	}

	// The stylesheet parser already validates strictly and removes the historical `applied` field.
	// Preserve that migration without normalizing any submitted values with catch fallbacks.
	const submitted = publishedInputSchema.safeParse({
		...input,
		metadata: {
			...input.metadata,
			// JSON Schema cannot represent the fallback on this transformed historical field.
			styleRules: input.metadata.styleRules === undefined ? [] : input.metadata.styleRules,
			stylesheet: canonical.data.metadata.stylesheet,
		},
	});
	if (!submitted.success) {
		for (const issue of submitted.error.issues) ctx.addIssue({ ...issue });
		return z.NEVER;
	}

	if (JSON.stringify(canonical.data).length > MAX_DOCUMENT_CHARS) {
		ctx.addIssue({
			code: "custom",
			message: `Shorten the resume to ${MAX_DOCUMENT_CHARS} characters or fewer.`,
			input,
		});
		return z.NEVER;
	}

	const oversized = findOversizedText(canonical.data);
	if (oversized) {
		ctx.addIssue({
			code: "custom",
			message: `Shorten this text to ${MAX_TEXT_CHARS} characters or fewer.`,
			path: oversized,
			input,
		});
		return z.NEVER;
	}

	// Use the canonical result so JSON Schema conversion cannot strip compatible extra data.
	return canonical.data;
});

export const parseResumeDataForWrite = (data: unknown): ResumeData => writableResumeDataSchema.parse(data);
