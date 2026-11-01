import type { ResumeMatch } from "./slugs";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { isbot } from "isbot";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { publicResumePath } from "@reactive-resume/resume/sharing";
import { verifiedDomainColumn } from "../custom-domain/service";
import { createPreviewToken, hasResumeAccess, isValidPreviewToken } from "./access";
import {
	ownerIsNotBanned,
	publicResumeData,
	requiresPassword,
	resolveViewer,
	shouldCountForStatistics,
} from "./access-policy";
import { parseStoredResumeData } from "./resume-data-validation";
import { resumeService } from "./service";
import { findResume } from "./slugs";
import { countVisit } from "./view-dedup";

export type { ResumeMatch } from "./slugs";

export type PublicWebPage =
	| { status: "unavailable" }
	/** Locked behind a password; `locale` is the resume's language, for the form. */
	| { status: "password"; locale: string }
	/** A previous slug, or a username the owner changed in the last 30 days: the page lives at `username`/`slug` now. */
	| { status: "moved"; username: string; slug: string; isPrimary: boolean; movedBy: "username" | "slug" }
	| {
			status: "ok";
			username: string;
			slug: string;
			updatedAt: Date;
			/** What every visitor sees: hidden content and, when the owner hid them, contact details left out. */
			data: ResumeData;
			/** The account's primary resume: its own address is `/<username>`. */
			isPrimary: boolean;
			/** The verified custom domain this primary resume opens at, which search engines are pointed to. */
			customDomain: string | null;
			showDownloadButtons: boolean;
			hasPassword: boolean;
			/** Listed in search engines: the owner allows it, no password guards it, and it isn't a preview. */
			indexable: boolean;
	  };

const isCrawler = (headers: Headers) => isbot(headers.get("user-agent") ?? "");

/**
 * A public resume as its web page shows it, in one lookup. Every visitor, the owner included, gets the public view, so
 * the page is what the owner shares. Views count once an hour per visitor, never for the owner or for crawlers.
 */
export async function loadPublicWebPage(input: {
	match: ResumeMatch;
	requestHeaders: Headers;
	trustedClient: string;
	previewToken?: string | undefined;
}): Promise<PublicWebPage> {
	const { match, previewToken } = input;
	const resume = await findResume(
		match,
		{
			id: schema.resume.id,
			userId: schema.resume.userId,
			username: schema.user.username,
			slug: schema.resume.slug,
			data: schema.resume.data,
			updatedAt: schema.resume.updatedAt,
			isPrimary: schema.resume.isPrimary,
			passwordHash: schema.resume.password,
			showDownloadButtons: schema.resume.showDownloadButtons,
			showInSearchEngines: schema.resume.showInSearchEngines,
			hideContactDetails: schema.resume.hideContactDetails,
			customDomain: verifiedDomainColumn(),
		},
		previewToken ? undefined : eq(schema.resume.isPublic, true),
	);
	if (!resume) return { status: "unavailable" };

	const hasPassword = resume.passwordHash !== null;
	const page = ({ preview }: { preview: boolean }): PublicWebPage => ({
		status: "ok",
		username: resume.username,
		slug: resume.slug,
		updatedAt: resume.updatedAt,
		data: publicResumeData(resume),
		isPrimary: resume.isPrimary,
		customDomain: resume.isPrimary ? resume.customDomain : null,
		showDownloadButtons: resume.showDownloadButtons,
		hasPassword,
		// A preview is never listed, whatever the switch says.
		indexable: resume.showInSearchEngines && !hasPassword && !preview,
	});

	// The owner's preview link: the page as visitors will see it, published or not, without counting or indexing.
	if (previewToken)
		return isValidPreviewToken(previewToken, resume.id) ? page({ preview: true }) : { status: "unavailable" };
	// A previous slug, or a username the owner changed in the last 30 days: send visitors to the current address.
	// Only a slug move is a stable address; an old username expires and can later belong to someone else, so it must
	// not be cached as a permanent redirect. When both moved, the username is the one that can be reclaimed.
	const movedUsername = "username" in match && resume.username !== match.username.toLowerCase();
	if (("slug" in match && resume.slug !== match.slug) || movedUsername)
		return {
			status: "moved",
			username: resume.username,
			slug: resume.slug,
			isPrimary: "primary" in match,
			movedBy: movedUsername ? "username" : "slug",
		};

	const viewer = await resolveViewer(input.requestHeaders);
	if (requiresPassword(resume, viewer) && !hasResumeAccess(input.requestHeaders, resume.id, resume.passwordHash))
		return { status: "password", locale: parseStoredResumeData(resume.data).metadata.page.locale };

	if (shouldCountForStatistics({ ...resume, isPublic: true }, viewer) && !isCrawler(input.requestHeaders))
		await countVisit({ kind: "view", resumeId: resume.id, trustedClient: input.trustedClient });

	return page({ preview: false });
}

/**
 * Checks a password typed into a web page's form. On success the response carries the resume's access cookie, as the
 * API's verify call does, and both spend the same budget of tries per visitor and resume.
 */
export async function verifyWebPagePassword(input: {
	match: ResumeMatch;
	password: string;
	trustedClient: string;
	responseHeaders: Headers;
}): Promise<boolean> {
	if (input.password.length < 6 || input.password.length > 64) return false;
	// The verify call names a resume by username and slug; a page at `/<username>` or the root looks its slug up.
	const address =
		"slug" in input.match
			? input.match
			: await findResume(input.match, { username: schema.user.username, slug: schema.resume.slug });
	if (!address) return false;
	return resumeService
		.verifyPassword({
			username: address.username,
			slug: address.slug,
			password: input.password,
			trustedClient: input.trustedClient,
			responseHeaders: input.responseHeaders,
		})
		.catch(() => false);
}

/** The owner's link to a resume's web page as visitors will see it, valid for 15 minutes; `null` when it isn't theirs. */
export async function webPagePreviewUrl(id: string, userId: string): Promise<string | null> {
	const resume = await findResume(
		{ id },
		{ username: schema.user.username, slug: schema.resume.slug },
		eq(schema.resume.userId, userId),
	);
	if (!resume) return null;
	const url = new URL(publicResumePath(resume), env.APP_URL);
	url.searchParams.set("preview", createPreviewToken(id));
	return url.href;
}

/** A page of the sitemap holds at most this many addresses, the protocol's limit. */
export const SITEMAP_PAGE_SIZE = 50_000;

/**
 * Resumes whose owners let search engines list them: public, no password, outside Trash, owner not banned. A primary
 * resume with a verified custom domain is left out; its own domain is its address. Needs the `user` join.
 */
const indexableResumeWhere = () =>
	and(
		eq(schema.resume.isPublic, true),
		eq(schema.resume.showInSearchEngines, true),
		isNull(schema.resume.password),
		isNull(schema.resume.trashedAt),
		ownerIsNotBanned(),
		sql`not (${schema.resume.isPrimary} and ${verifiedDomainColumn()} is not null)`,
	);

export function listIndexableResumes(page: number) {
	return (
		db
			.select({
				username: schema.user.username,
				slug: schema.resume.slug,
				isPrimary: schema.resume.isPrimary,
				updatedAt: schema.resume.updatedAt,
			})
			.from(schema.resume)
			.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
			.where(indexableResumeWhere())
			// ponytail: offset paging; switch to keyset ranges if sitemap pages get slow.
			.orderBy(asc(schema.resume.id))
			.limit(SITEMAP_PAGE_SIZE)
			.offset(page * SITEMAP_PAGE_SIZE)
	);
}

export async function countIndexableResumes(): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(schema.resume)
		.innerJoin(schema.user, eq(schema.resume.userId, schema.user.id))
		.where(indexableResumeWhere());
	return row?.total ?? 0;
}
