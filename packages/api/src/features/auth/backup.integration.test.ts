import { randomUUID } from "node:crypto";
import { mkdtemp, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { call } from "@orpc/server";
import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { Pool } from "pg";
import { db, withDatabasePool } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { accountBackupLimits, buildAccountZip } from "@reactive-resume/utils/account-zip";

const settings = vi.hoisted(() => ({
	APP_URL: "http://localhost:3000",
	STORAGE_BACKEND: "local",
	LOCAL_STORAGE_PATH: "",
	FLAG_DISABLE_API_RATE_LIMIT: true,
}));
vi.mock("@reactive-resume/env/server", () => ({ env: settings }));
vi.mock("@reactive-resume/auth/config", () => ({
	auth: { $context: { secretConfig: "fixture" } },
	accountAuth: {},
	isCustomOAuthProviderEnabled: () => false,
}));

import { getStorageService } from "../storage/service";
import { authRouter } from "./router";
import { authService } from "./service";

const databaseUrl = process.env.OAUTH_TEST_DATABASE_URL;
it.skipIf(!databaseUrl)(
	"exports owned bytes and raw history through the router, usable after isolated account deletion",
	async () => {
		if (!databaseUrl || !new URL(databaseUrl).pathname.includes("test"))
			throw new Error("Disposable test database required");
		const pool = new Pool({ connectionString: databaseUrl });
		const ownerId = `backup-${randomUUID()}`;
		const neighborId = `${ownerId}-other`;
		settings.LOCAL_STORAGE_PATH = await mkdtemp(join(tmpdir(), "resume-backup-"));
		try {
			await withDatabasePool(pool, async () => {
				const photo = `uploads/${ownerId}/pictures/photo.png`;
				const oldPhoto = `uploads/${ownerId}/pictures/old-photo.png`;
				const large = `uploads/${ownerId}/pictures/large.pdf`;
				const missing = `uploads/${ownerId}/pictures/missing.png`;
				const foreign = `uploads/${neighborId}/pictures/private.png`;
				const liveThread = randomUUID();
				const deletedThread = randomUUID();
				const attachmentId = randomUUID();
				const attachment = `uploads/${ownerId}/agent/${liveThread}/${attachmentId}`;
				const erased = `uploads/${ownerId}/agent/${deletedThread}/${randomUUID()}`;
				const [owner] = await db
					.insert(tables.user)
					.values({
						id: ownerId,
						name: "Fictional backup owner",
						email: `${ownerId}@example.test`,
						username: ownerId,
						displayUsername: ownerId,
						image: `${settings.APP_URL}/api/${photo}`,
					})
					.returning();
				if (!owner) throw new Error("Owner fixture missing");
				await db.insert(tables.user).values({
					id: neighborId,
					name: "Neighbor",
					email: `${neighborId}@example.test`,
					username: neighborId,
					displayUsername: neighborId,
				});
				const [neighborResume] = await db
					.insert(tables.resume)
					.values({ userId: neighborId, name: "NEIGHBOR-DOCUMENT", slug: "private" })
					.returning();
				if (!neighborResume) throw new Error("Neighbor fixture missing");
				await db.insert(tables.resumeVersion).values({
					userId: neighborId,
					resumeId: neighborResume.id,
					data: defaultResumeData,
					name: "NEIGHBOR-HISTORY",
					kind: "named",
				});
				const resumeData = structuredClone(defaultResumeData);
				resumeData.picture.url = `${settings.APP_URL}/api/${photo}`;
				resumeData.basics.location = foreign;
				const [resume] = await db
					.insert(tables.resume)
					.values({
						userId: ownerId,
						name: "Current resume",
						slug: "resume",
						data: resumeData,
						password: "never-export-password",
					})
					.returning();
				if (!resume) throw new Error("Resume fixture missing");
				const oldData = { ...structuredClone(resumeData), historicalField: "Keep historical JSON verbatim" };
				oldData.picture.url = `${settings.APP_URL}/api/${oldPhoto}`;
				const [resumeVersion] = await db
					.insert(tables.resumeVersion)
					.values({ userId: ownerId, resumeId: resume.id, data: oldData, kind: "named", name: "Earlier copy" })
					.returning();
				const [secondResumeVersion] = await db
					.insert(tables.resumeVersion)
					.values({
						userId: ownerId,
						resumeId: resume.id,
						data: { ...oldData, historicalField: "Second saved snapshot" },
						kind: "named",
						name: "Second copy",
					})
					.returning();
				const letterData = {
					name: "Earlier letter",
					content: "<p>Earlier body</p>",
					recipient: large,
					style: copyCoverLetterStyle(resumeData),
					layout: "freeform" as const,
					recipientName: "",
					recipientCompany: "",
					letterDate: null,
				};
				const [letter] = await db
					.insert(tables.coverLetter)
					.values({ ...letterData, userId: ownerId })
					.returning();
				if (!letter) throw new Error("Letter fixture missing");
				const [letterVersion] = await db
					.insert(tables.coverLetterVersion)
					.values({
						userId: ownerId,
						coverLetterId: letter.id,
						data: { ...letterData, recipient: missing },
						kind: "named",
					})
					.returning();
				const [neighborLetter] = await db
					.insert(tables.coverLetter)
					.values({ ...letterData, userId: neighborId, name: "NEIGHBOR-LETTER" })
					.returning();
				if (!neighborLetter) throw new Error("Neighbor letter fixture missing");
				await db.insert(tables.coverLetterVersion).values({
					userId: neighborId,
					coverLetterId: neighborLetter.id,
					data: { ...letterData, content: "NEIGHBOR-LETTER-HISTORY" },
					kind: "named",
				});
				await db.insert(tables.agentThread).values([
					{ id: liveThread, userId: ownerId, title: "Live", scope: "career" },
					{
						id: deletedThread,
						userId: ownerId,
						title: "Deleted",
						scope: "career",
						status: "deleted",
						deletedAt: new Date(),
					},
				]);
				await db.insert(tables.agentAttachment).values({
					id: attachmentId,
					userId: ownerId,
					threadId: liveThread,
					storageKey: attachment,
					filename: "notes.bin",
					mediaType: "application/octet-stream",
					size: 4,
				});
				await db.insert(tables.agentMessage).values({
					userId: ownerId,
					threadId: liveThread,
					role: "user",
					sequence: 1,
					uiMessage: { role: "user", parts: [{ type: "text", text: erased }] },
				});
				const bytes = new Uint8Array([0, 255, 80, 75]);
				const storage = getStorageService();
				for (const key of [photo, oldPhoto, large, attachment, erased])
					await storage.write({
						key,
						data: bytes,
						contentType: "application/octet-stream",
						...(key.includes("/agent/") ? { private: true } : {}),
					});
				await storage.write({
					key: foreign,
					data: new TextEncoder().encode("NEIGHBOR-PRIVATE-BYTES"),
					contentType: "image/png",
				});
				await truncate(join(settings.LOCAL_STORAGE_PATH, large), accountBackupLimits.fileBytes + 1);
				const context = {
					locale: "en-US" as const,
					reqHeaders: new Headers({ "x-account-id": ownerId }),
					authentication: { method: "session" as const, user: owner, permissions: ["read"] as const },
				};
				const reads = vi.spyOn(storage, "read");
				await expect(
					call(authRouter.exportData, { includeUploads: true }, { context: { ...context, authentication: null } }),
				).rejects.toMatchObject({ code: "UNAUTHORIZED" });
				await expect(
					call(
						authRouter.exportData,
						{ includeUploads: true },
						{ context: { ...context, reqHeaders: new Headers({ "x-account-id": neighborId }) } },
					),
				).rejects.toMatchObject({ code: "CONFLICT" });
				await expect(
					call(
						authRouter.exportData,
						{ includeUploads: true },
						{ context: { ...context, rpcItemAccountId: neighborId } },
					),
				).rejects.toMatchObject({ code: "CONFLICT" });
				expect(reads).not.toHaveBeenCalled();
				const legacy = await call(authRouter.exportData, undefined, { context });
				expect(legacy.uploads).toBeUndefined();
				expect(reads).not.toHaveBeenCalled();
				const forgedInput = { includeUploads: true, userId: neighborId };
				const exported = await call(authRouter.exportData, forgedInput, { context });
				expect(exported.user.id).toBe(ownerId);
				expect(reads.mock.calls.some(([key]) => key === foreign || key === erased)).toBe(false);
				expect(exported.uploads?.files.map((file) => file.key).sort()).toEqual([photo, oldPhoto, attachment].sort());
				expect(exported.uploads?.skipped).toEqual(
					expect.arrayContaining([
						{ key: foreign, reason: "outside-account" },
						{ key: erased, reason: "not-live-attachment" },
						{ key: large, reason: "file-limit" },
						{ key: missing, reason: "unavailable" },
					]),
				);
				expect(exported.career.threads.map((thread) => thread.id)).toEqual([liveThread]);
				expect(JSON.stringify(exported)).not.toContain("never-export-password");
				expect(JSON.stringify(exported)).not.toContain("NEIGHBOR-DOCUMENT");
				expect(JSON.stringify(exported)).not.toContain("NEIGHBOR-HISTORY");
				expect(JSON.stringify(exported)).not.toContain("NEIGHBOR-LETTER");
				expect(exported.documentVersions?.resumes.map((version) => version.id)).toEqual(
					expect.arrayContaining([resumeVersion?.id, secondResumeVersion?.id]),
				);
				const archive = buildAccountZip(exported);
				const full = new Uint8Array(accountBackupLimits.fileBytes);
				const budgetFiles = ["budget-a.pdf", "budget-b.pdf"].map((name) => `uploads/${ownerId}/pictures/${name}`);
				for (const key of budgetFiles) await storage.write({ key, data: full, contentType: "application/pdf" });
				await db
					.update(tables.resume)
					.set({
						data: {
							...resumeData,
							basics: {
								...resumeData.basics,
								customFields: budgetFiles.map((key, index) => ({
									id: `budget-${index}`,
									icon: "",
									text: key,
									link: "",
								})),
							},
						},
					})
					.where(eq(tables.resume.id, resume.id));
				const limited = await call(authRouter.exportData, { includeUploads: true }, { context });
				expect(limited.uploads?.skipped).toContainEqual({ key: budgetFiles[1], reason: "total-limit" });
				expect(
					limited.uploads?.files.reduce((size, file) => size + Buffer.from(file.base64, "base64").byteLength, 0),
				).toBeLessThanOrEqual(accountBackupLimits.uploadBytes);
				await authService.deleteAccount({ userId: ownerId });
				expect(await storage.read(photo)).toBeNull();
				expect(await db.select().from(tables.resumeVersion).where(eq(tables.resumeVersion.userId, ownerId))).toEqual(
					[],
				);
				const files = unzipSync(archive);
				expect(
					strFromU8(files[`versions/resumes/${resume.id}/${secondResumeVersion?.id}.json`] ?? new Uint8Array()),
				).toContain("Second saved snapshot");
				for (const key of [photo, oldPhoto, attachment]) expect(files[key]).toEqual(bytes);
				expect(files).not.toHaveProperty(foreign);
				expect(files).not.toHaveProperty(erased);
				expect(
					strFromU8(files[`versions/resumes/${resume.id}/${resumeVersion?.id}.json`] ?? new Uint8Array()),
				).toContain("Keep historical JSON verbatim");
				expect(
					strFromU8(files[`versions/letters/${letter.id}/${letterVersion?.id}.json`] ?? new Uint8Array()),
				).toContain("Earlier body");
				expect(new TextDecoder().decode((await storage.read(foreign))?.data)).toBe("NEIGHBOR-PRIVATE-BYTES");
			});
		} finally {
			await pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [[ownerId, neighborId]]);
			await rm(settings.LOCAL_STORAGE_PATH, { recursive: true, force: true });
			await pool.query("DELETE FROM storage_cleanup_job WHERE owner_id = ANY($1::text[])", [[ownerId, neighborId]]);
			await pool.end();
		}
	},
);
