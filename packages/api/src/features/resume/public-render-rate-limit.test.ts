import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { publicRenderRateLimiter as limiter } from "./public-render-rate-limit";

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(0);
});

afterEach(() => {
	vi.useRealTimers();
});

// Six renders per visitor and resume a minute.
const spendBudget = async (input: { trustedClient: string; resumeId: string }) => {
	for (let i = 0; i < 6; i++) await limiter.consume(input);
};

describe("public render rate limit", () => {
	it("cannot reset a transport client's budget by rotating forwarding headers", async () => {
		const first = {
			trustedClient: "203.0.113.9",
			requestHeaders: new Headers({
				"cf-connecting-ip": "198.51.100.1",
				"x-forwarded-for": "198.51.100.2",
			}),
			resumeId: "resume-1",
		};
		const rotated = {
			...first,
			requestHeaders: new Headers({
				"cf-connecting-ip": "198.51.100.3",
				"x-forwarded-for": "198.51.100.4",
			}),
		};

		await spendBudget(first);

		await expect(limiter.consume(rotated)).rejects.toMatchObject({ code: "RATE_LIMIT_EXCEEDED", status: 429 });
	});

	it("keeps budgets separate by client IP and resume", async () => {
		await spendBudget({ trustedClient: "203.0.113.7", resumeId: "resume-1" });

		await expect(limiter.consume({ trustedClient: "203.0.113.8", resumeId: "resume-1" })).resolves.toBeUndefined();
		await expect(limiter.consume({ trustedClient: "203.0.113.7", resumeId: "resume-2" })).resolves.toBeUndefined();
	});
});
