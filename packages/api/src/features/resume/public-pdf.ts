import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { ORPCError } from "@orpc/server";
import { env } from "@reactive-resume/env/server";
import { generateFilename } from "@reactive-resume/utils/file";
import { assertCanView } from "./access-policy";
import { publicRenderRateLimiter } from "./public-render-rate-limit";
import { parseStoredResumeData } from "./resume-data-validation";

type PublicRenderResume = {
	id: string;
	userId: string;
	data: ResumeData;
	isPublic: boolean;
	passwordHash: string | null;
};

export type CreatePublicResumePdfInput = {
	username: string;
	slug: string;
	requestHeaders: Headers;
	trustedClient: string;
};

export type PublicResumePdfDependencies = {
	findResume(input: Pick<CreatePublicResumePdfInput, "username" | "slug">): Promise<PublicRenderResume | null>;
	hasPasswordAccess(requestHeaders: Headers, resumeId: string, passwordHash: string | null): boolean | Promise<boolean>;
	resolveCurrentUserId(requestHeaders: Headers): Promise<string | undefined>;
	rateLimiter: { consume(input: { trustedClient: string; resumeId: string }): void | Promise<void> };
	renderPdf(input: { data: ResumeData; filename: string }): Promise<File>;
};

const findResume = async ({ username, slug }: Pick<CreatePublicResumePdfInput, "username" | "slug">) => {
	const [{ db }, schema, { and, eq, isNull }] = await Promise.all([
		import("@reactive-resume/db/client"),
		import("@reactive-resume/db/schema"),
		import("drizzle-orm"),
	]);
	const [resume] = await db
		.select({
			id: schema.resume.id,
			userId: schema.resume.userId,
			data: schema.resume.data,
			isPublic: schema.resume.isPublic,
			passwordHash: schema.resume.password,
		})
		.from(schema.resume)
		.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
		.where(and(eq(schema.resume.slug, slug), eq(schema.user.username, username), isNull(schema.resume.trashedAt)));
	return resume ?? null;
};

const defaultDependencies: PublicResumePdfDependencies = {
	findResume,
	hasPasswordAccess: async (requestHeaders, resumeId, passwordHash) =>
		(await import("./access")).hasResumeAccess(requestHeaders, resumeId, passwordHash),
	resolveCurrentUserId: async (requestHeaders) =>
		(await import("../../context")).resolveUserFromRequestHeaders(requestHeaders).then((user) => user?.id),
	rateLimiter: publicRenderRateLimiter,
	renderPdf: async (input) =>
		(await import("@reactive-resume/pdf/server")).createResumePdfFile({ ...input, uploadOrigin: env.APP_URL }),
};

export async function createPublicResumePdf(
	input: CreatePublicResumePdfInput,
	dependencies: PublicResumePdfDependencies = defaultDependencies,
): Promise<{ body: File; filename: string }> {
	const resume = await dependencies.findResume(input);
	if (!resume) throw new ORPCError("NOT_FOUND");

	const currentUserId = await dependencies.resolveCurrentUserId(input.requestHeaders);
	assertCanView(resume, currentUserId ? { id: currentUserId } : null);
	if (
		resume.passwordHash &&
		!(await dependencies.hasPasswordAccess(input.requestHeaders, resume.id, resume.passwordHash))
	) {
		throw new ORPCError("NEED_PASSWORD", {
			status: 401,
			data: { username: input.username, slug: input.slug },
		});
	}

	const data = parseStoredResumeData(resume.data);
	await dependencies.rateLimiter.consume({ trustedClient: input.trustedClient, resumeId: resume.id });
	const filename = generateFilename(data.basics.name || "Resume", "pdf");
	return { body: await dependencies.renderPdf({ data, filename }), filename };
}
