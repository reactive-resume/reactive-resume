import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { createPublicResumePdf } from "./public-pdf";

// The real lookup query, run against a stand-in `pg` client that records the SQL and returns `rows`.
const pg = vi.hoisted(() => ({ queries: [] as { text: string; params: unknown[] }[], rows: [] as unknown[][] }));
vi.mock("@reactive-resume/db/client", async () => {
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const client = {
		query: ({ text }: { text: string }, params: unknown[]) => {
			pg.queries.push({ text, params });
			return Promise.resolve({ rows: pg.rows });
		},
	};
	return { db: drizzle({ client: client as never }) };
});

const mocks = vi.hoisted(() => ({
	hasResumeAccess: vi.fn(),
	consume: vi.fn(),
	renderPdf: vi.fn(),
	files: new Map<string, Uint8Array>(),
}));
vi.mock("./access", () => ({ hasResumeAccess: mocks.hasResumeAccess }));
vi.mock("../../context", () => ({ resolveAuthenticationFromRequestHeaders: async () => undefined }));
vi.mock("./public-render-rate-limit", () => ({ publicRenderRateLimiter: { consume: mocks.consume } }));
vi.mock("@reactive-resume/pdf/server", () => ({ createResumePdfFile: mocks.renderPdf }));
// Storage that keeps files in memory, so tests never write to the local data folder.
vi.mock("../storage", () => ({
	getStorageService: () => ({
		list: async (prefix: string) => [...mocks.files.keys()].filter((key) => key.startsWith(prefix)),
		read: async (key: string) => {
			const data = mocks.files.get(key);
			return data ? { data, size: data.byteLength, lastModified: new Date() } : null;
		},
		write: async ({ key, data }: { key: string; data: Uint8Array }) => void mocks.files.set(key, data),
		delete: async (key: string) => mocks.files.delete(key),
	}),
}));

const requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.7" });
const input = {
	username: "jane",
	slug: "resume",
	requestHeaders,
	trustedClient: "203.0.113.9",
};

const buildResume = (overrides: Partial<{ isPublic: boolean; passwordHash: string | null }> = {}) => ({
	id: "resume-1",
	userId: "owner-1",
	data: structuredClone(defaultResumeData),
	isPublic: overrides.isPublic ?? true,
	passwordHash: overrides.passwordHash ?? null,
});

/** Makes the lookup query return `resume`. */
const found = (resume: ReturnType<typeof buildResume>) => {
	pg.rows = [[resume.id, resume.userId, resume.data, resume.isPublic, resume.passwordHash]];
	return resume;
};

describe("createPublicResumePdf", () => {
	beforeEach(() => {
		pg.queries = [];
		pg.rows = [];
		mocks.files.clear();
		mocks.consume.mockReset();
		mocks.hasResumeAccess.mockReset().mockReturnValue(false);
		mocks.renderPdf.mockReset().mockResolvedValue(new File(["%PDF"], "resume.pdf", { type: "application/pdf" }));
	});

	it("authorizes private and password-protected resumes before budget or render", async () => {
		found(buildResume({ isPublic: false }));
		await expect(createPublicResumePdf(input)).rejects.toMatchObject({ code: "NOT_FOUND" });

		found(buildResume({ passwordHash: "hash" }));
		await expect(createPublicResumePdf(input)).rejects.toMatchObject({ code: "NEED_PASSWORD" });
		expect(mocks.consume).not.toHaveBeenCalled();
		expect(mocks.renderPdf).not.toHaveBeenCalled();
	});

	it("does not look in Trash, so a trashed resume's link stops serving its PDF", async () => {
		await expect(createPublicResumePdf(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
		expect(pg.queries.at(-1)?.text).toContain('"resume"."trashed_at" is null');
	});

	it("matches renamed slugs via resumeSlugRedirect and returns rendered PDF", async () => {
		const resume = buildResume();
		resume.data.basics.name = "Ada Lovelace";
		found(resume);

		const result = await createPublicResumePdf({ ...input, slug: "old-slug" });

		const [query] = pg.queries;
		expect(query?.text).toContain('"resume_slug_redirect"');
		expect(query?.text).toContain('"resume_slug_redirect"."expires_at" > now()');
		expect(query?.text).toContain('"resume_slug_redirect"."user_id" = "resume"."user_id"');
		expect(query?.text).toContain('order by "resume"."slug" = $4 desc');
		expect(query?.params[0]).toBe("old-slug");
		expect(query?.params[1]).toBe("old-slug");
		expect(query?.params[2]).toBe("jane");
		expect(query?.params[3]).toBe("old-slug");
		expect(mocks.consume).toHaveBeenCalledWith({ trustedClient: input.trustedClient, resumeId: resume.id });
		expect(mocks.renderPdf).toHaveBeenCalledWith(
			expect.objectContaining({ data: resume.data, filename: "ada-lovelace.pdf" }),
		);
		expect(result.filename).toBe("ada-lovelace.pdf");
		expect(result.body).toBeInstanceOf(File);
	});

	it("requires password when downloading via renamed slug", async () => {
		found(buildResume({ passwordHash: "hash" }));

		await expect(createPublicResumePdf({ ...input, slug: "old-slug" })).rejects.toMatchObject({
			code: "NEED_PASSWORD",
			data: { username: "jane", slug: "old-slug" },
		});
	});

	it("rejects with NOT_FOUND when redirect or resume does not exist", async () => {
		await expect(createPublicResumePdf({ ...input, slug: "missing-slug" })).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("renders on demand with canonical public stylesheet source", async () => {
		const resume = buildResume();
		resume.data.basics.name = "Ada Lovelace";
		resume.data.metadata.stylesheet = {
			mode: "semantic",
			source: { languageVersion: 1, text: "@version 1;\nname { color: blue; }\n" },
		};
		found(resume);

		const result = await createPublicResumePdf(input);

		expect(result.filename).toBe("ada-lovelace.pdf");
		expect(mocks.consume).toHaveBeenCalledWith({ trustedClient: input.trustedClient, resumeId: resume.id });
		expect(mocks.renderPdf).toHaveBeenCalledWith(
			expect.objectContaining({ data: resume.data, filename: "ada-lovelace.pdf" }),
		);
	});

	it("renders a resume once per version: repeat visits get the stored file without spending the render budget", async () => {
		const resume = found(buildResume());

		await createPublicResumePdf(input);
		const again = await createPublicResumePdf(input);

		expect(await again.body?.text()).toBe("%PDF");
		expect(mocks.renderPdf).toHaveBeenCalledTimes(1);
		expect(mocks.consume).toHaveBeenCalledTimes(1);
		const [first] = mocks.files.keys();
		expect(first).toMatch(/^uploads\/owner-1\/pdfs\/resume-1\/public-[0-9a-f]+\.pdf$/);

		// An edit renders the new version and drops the old file.
		resume.data.basics.name = "Ada Lovelace";
		await createPublicResumePdf(input);
		expect(mocks.renderPdf).toHaveBeenCalledTimes(2);
		expect([...mocks.files.keys()]).toHaveLength(1);
		expect(mocks.files.has(first ?? "")).toBe(false);
	});

	it("confirms a visitor's copy is current only after the access checks pass", async () => {
		found(buildResume({ passwordHash: "hash" }));
		mocks.hasResumeAccess.mockReturnValue(true);
		const { etag } = await createPublicResumePdf(input);
		const conditional = { ...input, requestHeaders: new Headers({ "if-none-match": `W/${etag}, "other"` }) };

		const current = await createPublicResumePdf(conditional);
		expect(current).toMatchObject({ body: null, etag });
		expect(mocks.renderPdf).toHaveBeenCalledTimes(1);

		// Once the password access lapses, knowing the version reveals nothing.
		mocks.hasResumeAccess.mockReturnValue(false);
		await expect(createPublicResumePdf(conditional)).rejects.toMatchObject({ code: "NEED_PASSWORD" });
	});
});
