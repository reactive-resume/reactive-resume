import type { StorageService } from "../storage";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { isbot } from "isbot";
import { db } from "@reactive-resume/db/client";
import * as schema from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { generateFilename } from "@reactive-resume/utils/file";
import { matchesIfNoneMatch } from "@reactive-resume/utils/http";
import { lockUser } from "../documents/ownership";
import {
	assertCanView,
	isOwner,
	publicResumeData,
	requiresPassword,
	resolveViewer,
	shouldCountForStatistics,
} from "./access-policy";
import { publicRenderRateLimiter } from "./public-render-rate-limit";
import { findResume } from "./slugs";
import { countVisit } from "./view-dedup";

export type CreatePublicResumePdfInput = {
	username: string;
	slug: string;
	requestHeaders: Headers;
	trustedClient: string;
	/** A visitor's download (the web page's Download PDF), counted once an hour per visitor. */
	countDownload?: boolean;
};

// A cached file is re-rendered after a day, so template, font and engine fixes reach it without an edit.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Renders in progress, so a burst of visitors to one resume waits for one render instead of starting many.
const rendering = new Map<string, Promise<Uint8Array>>();

/** `body` is null when the request's `If-None-Match` already names this version (answer 304). */
export type PublicResumePdf = { body: File | null; filename: string; etag: string };

/**
 * Renders a PDF for a public resume identified by username and slug (current or unexpired redirect).
 * Enforces visibility, password access, and rate limiting before generating the file, or before confirming a
 * cached copy is current.
 */
export async function createPublicResumePdf(input: CreatePublicResumePdfInput): Promise<PublicResumePdf> {
	const resume = await findResume(
		{ username: input.username, slug: input.slug },
		{
			id: schema.resume.id,
			userId: schema.resume.userId,
			data: schema.resume.data,
			isPublic: schema.resume.isPublic,
			hideContactDetails: schema.resume.hideContactDetails,
			showDownloadButtons: schema.resume.showDownloadButtons,
			passwordHash: schema.resume.password,
		},
	);
	if (!resume) throw new ORPCError("NOT_FOUND");

	const viewer = await resolveViewer(input.requestHeaders);
	assertCanView(resume, viewer);
	// With downloads off, the PDF is the owner's alone; the web page is what everyone else sees.
	if (!resume.showDownloadButtons && !isOwner(resume, viewer)) throw new ORPCError("NOT_FOUND");
	if (
		requiresPassword(resume, viewer) &&
		!(await import("./access")).hasResumeAccess(input.requestHeaders, resume.id, resume.passwordHash)
	) {
		throw new ORPCError("NEED_PASSWORD", {
			status: 401,
			data: { username: input.username, slug: input.slug },
		});
	}

	if (input.countDownload && shouldCountForStatistics(resume, viewer) && !isbot(input.requestHeaders.get("user-agent")))
		await countVisit({ kind: "download", resumeId: resume.id, trustedClient: input.trustedClient });

	// Every visitor gets the anonymous view, so one cached file serves them all (hidden content never prints anyway).
	const data = publicResumeData(resume);
	const filename = generateFilename(data.basics.name || "Resume", "pdf");
	const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 32);
	// Under the resume's pdfs/ folder: deleted with the resume or account, and /uploads serves it only to the owner.
	const folder = `uploads/${resume.userId}/pdfs/${resume.id}`;
	const key = `${folder}/public-${hash}.pdf`;
	const etag = `"${hash}"`;
	if (matchesIfNoneMatch(input.requestHeaders.get("if-none-match"), etag)) return { body: null, filename, etag };
	// The cache is best effort: without storage, or when it fails, every request renders as before.
	const storage = await import("../storage")
		.then(({ getStorageService }) => getStorageService())
		.catch(() => undefined);

	const cached = await storage?.read(key).catch(() => null);
	const fresh = cached && (!cached.lastModified || Date.now() - cached.lastModified.getTime() < CACHE_TTL_MS);
	if (cached && fresh)
		return { body: new File([cached.data as Uint8Array<ArrayBuffer>], filename, PDF), filename, etag };

	let pending = rendering.get(key);
	if (!pending) {
		// Only a render spends the visitor's budget; a cached file is as cheap as a picture.
		await publicRenderRateLimiter.consume({ trustedClient: input.trustedClient, resumeId: resume.id });
		pending = renderAndStore(storage, {
			data,
			filename,
			folder,
			key,
			resumeId: resume.id,
			userId: resume.userId,
		});
		rendering.set(key, pending);
		void pending.finally(() => rendering.delete(key)).catch(() => undefined);
	}
	return { body: new File([(await pending) as Uint8Array<ArrayBuffer>], filename, PDF), filename, etag };
}

const PDF = { type: "application/pdf" };

async function renderAndStore(
	storage: StorageService | undefined,
	{
		data,
		filename,
		folder,
		key,
		resumeId,
		userId,
	}: { data: ResumeData; filename: string; folder: string; key: string; resumeId: string; userId: string },
): Promise<Uint8Array> {
	const { createResumePdfFile } = await import("@reactive-resume/pdf/server");
	const file = await createResumePdfFile({ data, filename, uploadOrigin: env.APP_URL });
	const bytes = new Uint8Array(await file.arrayBuffer());
	if (!storage) return bytes;

	try {
		// Publication is serialized with deletion under the same owner lock. Deletion waits for the write; if it
		// already committed, revalidation stops this late render from recreating a cleaned prefix.
		await db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const [live] = await tx
				.select({ id: schema.resume.id })
				.from(schema.resume)
				.where(and(eq(schema.resume.id, resumeId), eq(schema.resume.userId, userId), isNull(schema.resume.trashedAt)))
				.limit(1);
			if (!live) return;
			await storage.write({ key, data: bytes, contentType: "application/pdf" });
			const stale = (await storage.list(folder)).filter((name) => name !== key && name.includes("/public-"));
			await Promise.all(stale.map((name) => storage.delete(name)));
		});
	} catch (error) {
		if ((error as { code?: string } | null)?.code === "NOT_FOUND") return bytes;
		console.warn("Failed to cache public resume PDF", error);
	}
	return bytes;
}
