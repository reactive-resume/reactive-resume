import z from "zod";
import { PDF_ATS_RULE_CODES } from "@reactive-resume/resume/ats-pdf";
const severity = z.enum(["blocker", "warning", "tip"]);
const category = z.enum(["parseability", "layout", "sections", "contact", "dates", "content"]);
const code = z.enum(PDF_ATS_RULE_CODES);
const finding = z.object({
	code,
	severity,
	category,
	params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
	evidence: z
		.object({
			snippet: z.string().optional(),
			page: z.number().optional(),
			box: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
		})
		.optional(),
});
export const jobTermSchema = z.object({
	term: z.string(),
	jdCount: z.number(),
	resumeCount: z.number(),
	weight: z.number(),
});
const jd = z.object({
	terms: z.array(jobTermSchema).readonly(),
	matchedTerms: z.array(z.string()).readonly(),
	missingTerms: z.array(z.string()).readonly(),
	totalTerms: z.number(),
	matchedCount: z.number(),
	weightedCoverage: z.number(),
	stuffedTerms: z.array(z.string()).readonly(),
	documentHasHiddenText: z.boolean(),
});
export const pdfCheckSchema = z.object({
	version: z.literal(1),
	score: z.number(),
	cappedBy: z.array(code).readonly(),
	categories: z
		.array(
			z.object({
				category: category.exclude(["content"]),
				score: z.number(),
				weight: z.number(),
				applicableChecks: z.number(),
				passedChecks: z.number(),
				skippedChecks: z.number(),
			}),
		)
		.readonly(),
	checks: z
		.array(
			z.object({
				code,
				category,
				severity,
				status: z.enum(["pass", "skip", "fail"]),
				skipReason: z
					.enum(["no-text", "no-operators", "not-english", "not-applicable", "encrypted", "insufficient-data"])
					.optional(),
				findings: z.array(finding).readonly(),
			}),
		)
		.readonly(),
	findings: z.array(finding).readonly(),
	tips: z.array(finding).readonly(),
	counts: z.object({ blocker: z.number(), warning: z.number(), tip: z.number() }),
	applicableChecks: z.number(),
	passedChecks: z.number(),
	skippedChecks: z.number(),
	jd: jd.nullable(),
	file: z.object({ name: z.string(), sizeBytes: z.number(), magicBytesOk: z.boolean() }),
	document: z.object({
		pageCount: z.number(),
		truncated: z.boolean(),
		wordCount: z.number(),
		operatorsAvailable: z.boolean(),
	}),
});
