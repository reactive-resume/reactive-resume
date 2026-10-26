import type { Ratelimiter } from "@orpc/experimental-ratelimit";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { isbot } from "isbot";
import { contactDetailsOf } from "@reactive-resume/resume/contact-details";
import { redactResumeForViewer, requiresPassword, shouldCountForStatistics } from "./access-policy";
import { parseStoredResumeData } from "./resume-data-validation";
import { clientKeyFromHeaders, shouldCountView } from "./view-dedup";

type PublicResumeInput = { username: string; slug: string; requestHeaders: Headers; trustedClient: string };

/** What a web page needs to know about its resume, beyond the content. */
export type WebPageSettings = {
	showDownloadButtons: boolean;
	showInSearchEngines: boolean;
	hideContactDetails: boolean;
	showContactButton: boolean;
	hasPassword: boolean;
};

export type PublicWebPage =
	| { status: "unavailable" }
	/** Locked behind a password; `locale` is the resume's language, for the form. */
	| { status: "password"; locale: string }
	/** A previous slug: the page lives at `slug` now. */
	| { status: "moved"; slug: string }
	| {
			status: "ok";
			id: string;
			slug: string;
			updatedAt: Date;
			data: ResumeData;
			settings: WebPageSettings;
			/** The verified custom domain this primary resume opens at, which search engines are pointed to. */
			customDomain: string | null;
	  };

const isCrawler = (headers: Headers) => isbot(headers.get("user-agent") ?? "");

// Created on first use, once the deployment's Redis (if any) is known.
let passwordLimiter: Ratelimiter | undefined;
let revealLimiter: Ratelimiter | undefined;

const resolveCurrentUserId = async (requestHeaders: Headers) =>
	(await import("../../context"))
		.resolveAuthenticationFromRequestHeaders(requestHeaders)
		.then((authentication) => (authentication?.permissions.includes("read") ? authentication.user.id : undefined))
		.catch(() => undefined);

const findPublicResume = async (input: { username: string; slug: string }, includePrivate = false) => {
	const [schema, { eq }, { findResumeBySlug }] = await Promise.all([
		import("@reactive-resume/db/schema"),
		import("drizzle-orm"),
		import("./slugs"),
	]);
	return findResumeBySlug(
		input,
		{
			id: schema.resume.id,
			userId: schema.resume.userId,
			slug: schema.resume.slug,
			data: schema.resume.data,
			updatedAt: schema.resume.updatedAt,
			isPrimary: schema.resume.isPrimary,
			passwordHash: schema.resume.password,
			showDownloadButtons: schema.resume.showDownloadButtons,
			showInSearchEngines: schema.resume.showInSearchEngines,
			hideContactDetails: schema.resume.hideContactDetails,
			showContactButton: schema.resume.showContactButton,
		},
		includePrivate ? undefined : eq(schema.resume.isPublic, true),
	);
};

/**
 * A public resume as its web page shows it. Every visitor, the owner included, gets the public view, so the page is
 * what the owner shares. Views count once an hour per visitor, never for the owner or for crawlers.
 */
export async function loadPublicWebPage(
	input: PublicResumeInput & { previewToken?: string | undefined },
): Promise<PublicWebPage> {
	const resume = await findPublicResume(input, Boolean(input.previewToken));
	if (!resume) return { status: "unavailable" };

	// The owner's preview link: the page as visitors will see it, published or not, without counting or indexing.
	if (input.previewToken) {
		const { isValidPreviewToken } = await import("./access");
		if (!isValidPreviewToken(input.previewToken, resume.id)) return { status: "unavailable" };
		return toPage(resume, { preview: true });
	}
	if (resume.slug !== input.slug) return { status: "moved", slug: resume.slug };

	const currentUserId = await resolveCurrentUserId(input.requestHeaders);
	const viewer = currentUserId ? { id: currentUserId } : null;
	if (requiresPassword(resume, viewer)) {
		const { hasResumeAccess } = await import("./access");
		if (!hasResumeAccess(input.requestHeaders, resume.id, resume.passwordHash))
			return { status: "password", locale: parseStoredResumeData(resume.data).metadata.page.locale };
	}

	if (shouldCountForStatistics({ ...resume, isPublic: true }, viewer) && !isCrawler(input.requestHeaders)) {
		const key = `${resume.id}:${clientKeyFromHeaders(input.trustedClient)}`;
		if (await shouldCountView(key, Date.now())) {
			const { resumeService } = await import("./service");
			await resumeService.statistics.increment({ id: resume.id, views: true });
		}
	}

	return toPage(resume, { preview: false });
}

async function toPage(
	resume: NonNullable<Awaited<ReturnType<typeof findPublicResume>>>,
	{ preview }: { preview: boolean },
): Promise<PublicWebPage> {
	const { data } = redactResumeForViewer(
		{ name: "", data: parseStoredResumeData(resume.data), hideContactDetails: resume.hideContactDetails },
		false,
	);
	const customDomain = resume.isPrimary
		? await import("../custom-domain/service").then(({ verifiedDomainOf }) => verifiedDomainOf(resume.userId))
		: null;
	return {
		status: "ok",
		customDomain,
		id: resume.id,
		slug: resume.slug,
		updatedAt: resume.updatedAt,
		data,
		settings: {
			showDownloadButtons: resume.showDownloadButtons,
			// A preview is never listed, whatever the switch says.
			showInSearchEngines: resume.showInSearchEngines && !preview,
			hideContactDetails: resume.hideContactDetails,
			showContactButton: resume.showContactButton,
			hasPassword: resume.passwordHash !== null,
		},
	};
}

/**
 * The contact details a resume hides, for a visitor who asks with the page's button. Only when the owner left the
 * button on, behind the same password gate as the page. Each visitor's reveal counts once an hour.
 */
export async function revealContactDetails(input: PublicResumeInput) {
	const { createRateLimiter } = await import("../../redis");
	revealLimiter ??= createRateLimiter("contact-reveal", { maxRequests: 20, window: 60_000 });
	if (!(await revealLimiter.limit(input.trustedClient || "unknown")).success) return null;

	const resume = await findPublicResume(input);
	if (!resume || !resume.hideContactDetails || !resume.showContactButton) return null;

	const currentUserId = await resolveCurrentUserId(input.requestHeaders);
	const viewer = currentUserId ? { id: currentUserId } : null;
	if (requiresPassword(resume, viewer)) {
		const { hasResumeAccess } = await import("./access");
		if (!hasResumeAccess(input.requestHeaders, resume.id, resume.passwordHash)) return null;
	}

	const key = `contact:${resume.id}:${clientKeyFromHeaders(input.trustedClient)}`;
	if (
		shouldCountForStatistics({ ...resume, isPublic: true }, viewer) &&
		!isCrawler(input.requestHeaders) &&
		(await shouldCountView(key, Date.now()))
	) {
		const { resumeService } = await import("./service");
		await resumeService.statistics.increment({ id: resume.id, contactReveals: true });
	}

	// Hidden sections and items stay hidden: the reveal reads the same redacted resume, minus the contact removal.
	const { data } = redactResumeForViewer({ name: "", data: parseStoredResumeData(resume.data) }, false);
	return contactDetailsOf(data);
}

/**
 * Checks a password typed into a web page's form. On success the response carries the resume's access cookie, as the
 * API's verify call does. Ten tries a minute per visitor and resume keep guessing slow.
 */
export async function verifyWebPagePassword(input: {
	username: string;
	slug: string;
	password: string;
	trustedClient: string;
	responseHeaders: Headers;
}): Promise<boolean> {
	if (input.password.length < 6 || input.password.length > 64) return false;
	const { createRateLimiter } = await import("../../redis");
	passwordLimiter ??= createRateLimiter("resume-page-password", { maxRequests: 10, window: 60_000 });
	const { success } = await passwordLimiter.limit(
		`${input.trustedClient || "unknown"}:${input.username}:${input.slug}`,
	);
	if (!success) return false;
	const { resumeService } = await import("./service");
	return resumeService
		.verifyPassword({
			username: input.username,
			slug: input.slug,
			password: input.password,
			responseHeaders: input.responseHeaders,
		})
		.catch(() => false);
}

/**
 * The address of an account's primary resume, for its short link. `null` when the account has none, or it's in
 * Trash, or the owner is banned; `isPublic` false when it exists but isn't published right now.
 */
export async function findPrimaryResume(username: string): Promise<{ slug: string; isPublic: boolean } | null> {
	const [{ db }, schema, { and, eq, isNull }, { ownerIsNotBanned }] = await Promise.all([
		import("@reactive-resume/db/client"),
		import("@reactive-resume/db/schema"),
		import("drizzle-orm"),
		import("./access-policy"),
	]);
	const [resume] = await db
		.select({ slug: schema.resume.slug, isPublic: schema.resume.isPublic })
		.from(schema.resume)
		.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
		.where(
			and(
				eq(schema.user.username, username.trim().toLowerCase()),
				eq(schema.resume.isPrimary, true),
				isNull(schema.resume.trashedAt),
				ownerIsNotBanned(),
			),
		)
		.limit(1);
	return resume ?? null;
}

/** A page of the sitemap holds at most this many addresses, the protocol's limit. */
export const SITEMAP_PAGE_SIZE = 50_000;

/**
 * Resumes whose owners let search engines list them: public, no password, outside Trash, owner not banned. A primary
 * resume with a verified custom domain is left out; its own domain is its address.
 */
export async function listIndexableResumes(page: number) {
	const [{ db }, schema, { and, asc, eq, isNull, sql }, { ownerIsNotBanned }] = await Promise.all([
		import("@reactive-resume/db/client"),
		import("@reactive-resume/db/schema"),
		import("drizzle-orm"),
		import("./access-policy"),
	]);
	return (
		db
			.select({ username: schema.user.username, slug: schema.resume.slug, updatedAt: schema.resume.updatedAt })
			.from(schema.resume)
			.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
			.where(
				and(
					eq(schema.resume.isPublic, true),
					eq(schema.resume.showInSearchEngines, true),
					isNull(schema.resume.password),
					isNull(schema.resume.trashedAt),
					ownerIsNotBanned(),
					sql`not (${schema.resume.isPrimary} and exists (select 1 from ${schema.customDomain} where ${schema.customDomain.userId} = ${schema.resume.userId} and ${schema.customDomain.verifiedAt} is not null))`,
				),
			)
			// ponytail: offset paging; switch to keyset ranges if sitemap pages get slow.
			.orderBy(asc(schema.resume.id))
			.limit(SITEMAP_PAGE_SIZE)
			.offset(page * SITEMAP_PAGE_SIZE)
	);
}

export async function countIndexableResumes(): Promise<number> {
	const [{ db }, schema, { and, count, eq, isNull }] = await Promise.all([
		import("@reactive-resume/db/client"),
		import("@reactive-resume/db/schema"),
		import("drizzle-orm"),
	]);
	const [row] = await db
		.select({ total: count() })
		.from(schema.resume)
		.where(
			and(
				eq(schema.resume.isPublic, true),
				eq(schema.resume.showInSearchEngines, true),
				isNull(schema.resume.password),
				isNull(schema.resume.trashedAt),
			),
		);
	return row?.total ?? 0;
}

/** The address of the resume `ROOT_RESUME_ID` names, for the instance's root page. */
export async function findResumeAddress(id: string): Promise<{ username: string; slug: string } | null> {
	const [{ db }, schema, { eq }] = await Promise.all([
		import("@reactive-resume/db/client"),
		import("@reactive-resume/db/schema"),
		import("drizzle-orm"),
	]);
	const [target] = await db
		.select({ username: schema.user.username, slug: schema.resume.slug })
		.from(schema.resume)
		.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
		.where(eq(schema.resume.id, id));
	return target ?? null;
}
