import z from "zod";
import { countryCodeSchema } from "@reactive-resume/utils/region";

const text = z.string().trim().max(200);
const email = z.union([z.literal(""), z.email().max(320)]);
export const applicationAnswerSchema = z.enum(["unknown", "yes", "no"]);

/** Explicit application-only answers. Never derive these from documents or feed them to AI. */
export const applicationProfileDataSchema = z.strictObject({
	givenName: text.default(""),
	familyName: text.default(""),
	email: email.default(""),
	phone: text.default(""),
	links: z
		.array(z.strictObject({ label: text.min(1), url: z.url({ protocol: /^https?$/ }).max(2000) }))
		.max(20)
		.default([]),
	address: z
		.strictObject({
			line1: text.default(""),
			line2: text.default(""),
			city: text.default(""),
			region: text.default(""),
			postalCode: text.default(""),
			countryCode: countryCodeSchema.nullable().default(null),
		})
		.default({ line1: "", line2: "", city: "", region: "", postalCode: "", countryCode: null }),
	workAuthorization: z
		.array(
			z.strictObject({
				countryCode: countryCodeSchema,
				authorized: applicationAnswerSchema.default("unknown"),
				needsSponsorship: applicationAnswerSchema.default("unknown"),
			}),
		)
		.max(50)
		.refine((rows) => new Set(rows.map((row) => row.countryCode)).size === rows.length, "Remove duplicate countries.")
		.default([]),
	willingToRelocate: applicationAnswerSchema.default("unknown"),
	/** Requested salary is independent of Career's minimum acceptable base salary. */
	requestedSalary: z
		.strictObject({
			amount: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).multipleOf(0.01).nullable(),
			currency: z
				.string()
				.regex(/^[A-Z]{3}$/)
				.nullable(),
			period: z.enum(["hour", "month", "year"]).nullable(),
		})
		.refine(
			(salary) => salary.amount === null || (salary.currency !== null && salary.period !== null),
			"Include currency and pay period with a salary amount.",
		)
		.nullable()
		.default(null),
	references: z
		.array(
			z.strictObject({
				name: text.min(1),
				relationship: text,
				company: text,
				email,
				phone: text,
			}),
		)
		.max(10)
		.default([]),
});
export type ApplicationProfileData = z.infer<typeof applicationProfileDataSchema>;
export const applicationProfileRecordSchema = z.object({
	data: applicationProfileDataSchema,
	reviewedAt: z.iso.datetime(),
	revision: z.string().min(1).max(64),
});
export const saveApplicationProfileSchema = z.strictObject({
	data: applicationProfileDataSchema,
	expectedRevision: z.string().min(1).max(64).nullable(),
});
