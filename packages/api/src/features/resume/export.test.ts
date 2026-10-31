import { afterAll, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
	render: vi.fn(),
	getById: vi.fn(async () => ({ name: "Resume", slug: "resume", data: { basics: { name: "" } } })),
}));
const render = mocks.render;
const previousNodeEnv = vi.hoisted(() => {
	const previous = process.env.NODE_ENV;
	process.env.NODE_ENV = "production";
	return previous;
});
afterAll(() => {
	if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
	else process.env.NODE_ENV = previousNodeEnv;
});
vi.mock("@reactive-resume/env/server", () => ({
	env: { APP_URL: "https://resume.example", FLAG_DISABLE_API_RATE_LIMIT: false },
}));
vi.mock("@reactive-resume/db/redis", () => ({
	getRedis: () => null,
	redisKey: (...parts: string[]) => parts.join(":"),
}));
vi.mock("../../context", async () => {
	const { os } = await import("@orpc/server");
	return { protectedProcedure: os.$context<{ user: { id: string }; resHeaders?: Headers }>() };
});
vi.mock("./service", () => ({ resumeService: { getById: mocks.getById } }));
vi.mock("./resume-data-validation", () => ({ parseStoredResumeData: (data: unknown) => data }));
vi.mock("@reactive-resume/pdf/server", () => ({ createResumePdfFile: render }));

import { createResumePdfDownload } from "./export";

it("limits direct and signed-link PDF rendering at the shared export owner", async () => {
	render.mockResolvedValue(new File(["%PDF"], "resume.pdf", { type: "application/pdf" }));
	const input = { id: "export-limit-resume", userId: "user-1" };
	for (let count = 0; count < 5; count++) await createResumePdfDownload(input);
	await expect(createResumePdfDownload(input)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
	expect(render).toHaveBeenCalledTimes(5);
});

it("names a signed PDF download from the resume's full name, not its internal document name", async () => {
	render.mockResolvedValue(new File(["%PDF"], "resume.pdf", { type: "application/pdf" }));
	mocks.getById.mockResolvedValueOnce({
		name: "acme-tailored-v3",
		slug: "acme-tailored-v3",
		data: { basics: { name: "Jordan Long" } },
	});

	const result = await createResumePdfDownload({ id: "named-resume", userId: "filename-user" });

	expect(render).toHaveBeenCalledWith(expect.objectContaining({ filename: "Jordan-Long-Resume.pdf" }));
	expect(result.headers["content-disposition"]).toBe('attachment; filename="Jordan-Long-Resume.pdf"');
});

it("adds an RFC 5987 UTF-8 file name for a Chinese full name", async () => {
	render.mockResolvedValue(new File(["%PDF"], "resume.pdf", { type: "application/pdf" }));
	mocks.getById.mockResolvedValueOnce({
		name: "untitled-resume",
		slug: "untitled-resume",
		data: { basics: { name: "李明" } },
	});

	const result = await createResumePdfDownload({ id: "unicode-resume", userId: "unicode-user" });

	expect(render).toHaveBeenCalledWith(expect.objectContaining({ filename: "李明-Resume.pdf" }));
	expect(result.headers["content-disposition"]).toBe(
		"attachment; filename=\"Resume.pdf\"; filename*=UTF-8''%E6%9D%8E%E6%98%8E-Resume.pdf",
	);
});
