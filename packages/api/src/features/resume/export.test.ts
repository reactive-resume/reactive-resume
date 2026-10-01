import { afterAll, expect, it, vi } from "vitest";

const render = vi.hoisted(() => vi.fn());
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
vi.mock("./service", () => ({ resumeService: { getById: async () => ({ name: "Resume", data: {} }) } }));
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
