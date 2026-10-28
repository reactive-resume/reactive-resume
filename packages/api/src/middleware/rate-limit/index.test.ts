import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const { limit, settings } = vi.hoisted(() => ({
	limit: vi.fn(),
	settings: { FLAG_DISABLE_API_RATE_LIMIT: false },
}));

vi.mock("../../redis", () => ({ createRateLimiter: () => ({ limit }) }));
vi.mock("@reactive-resume/env/server", () => ({ env: settings }));

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
	limit.mockReset();
});

describe("public resume rate limits", () => {
	it.each([false, true])("honors FLAG_DISABLE_API_RATE_LIMIT=%s in production", async (disabled) => {
		vi.stubEnv("NODE_ENV", "production");
		settings.FLAG_DISABLE_API_RATE_LIMIT = disabled;
		limit.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 60_000 });
		const { consumeResumePasswordLimit } = await import("./index");
		expect(await consumeResumePasswordLimit({ resumeId: "resume-id", trustedClient: "203.0.113.9" })).toBe(disabled);
		if (disabled) expect(limit).not.toHaveBeenCalled();
		else expect(limit).toHaveBeenCalledWith("resume-password:resume-id:ip:203.0.113.9");
	});

	it("shares one password budget for the canonical resume identity", async () => {
		vi.stubEnv("NODE_ENV", "production");
		settings.FLAG_DISABLE_API_RATE_LIMIT = false;
		limit.mockResolvedValue({ success: true, remaining: 4, reset: Date.now() + 60_000 });
		const { consumeResumePasswordLimit } = await import("./index");
		await consumeResumePasswordLimit({ resumeId: "resume-id", trustedClient: "203.0.113.9" });
		await consumeResumePasswordLimit({ resumeId: "resume-id", trustedClient: "203.0.113.9" });
		expect(limit.mock.calls.map(([key]) => key)).toEqual([
			"resume-password:resume-id:ip:203.0.113.9",
			"resume-password:resume-id:ip:203.0.113.9",
		]);
	});

	it.each([
		{
			name: "per user and resume",
			middleware: "resumeUpdatesRateLimit",
			expectedKey: "resume-updates:user-123:resume-456",
		},
		{
			name: "per user across resumes",
			middleware: "resumeUpdatesUserRateLimit",
			expectedKey: "resume-updates-user:user-123",
		},
	] as const)("rate limits resume updates subscription $name", async ({ middleware, expectedKey }) => {
		vi.stubEnv("NODE_ENV", "production");
		settings.FLAG_DISABLE_API_RATE_LIMIT = false;
		limit.mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 60_000 });
		const middlewares = await import("./index");
		const next = vi.fn(async () => "allowed");
		const request = middlewares[middleware](
			{ context: { user: { id: "user-123" } }, next } as never,
			{ id: "resume-456" },
			vi.fn(),
		);
		await expect(request).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
		expect(limit).toHaveBeenCalledWith(expectedKey);
		expect(next).not.toHaveBeenCalled();
	});
});
