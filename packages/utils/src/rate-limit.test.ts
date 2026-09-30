import { describe, expect, it } from "vitest";
import { rateLimitConfig, TRUSTED_IP_HEADERS } from "./rate-limit";

describe("TRUSTED_IP_HEADERS", () => {
	it("includes Cloudflare connecting headers", () => {
		expect(TRUSTED_IP_HEADERS).toContain("CF-Connecting-IP");
		expect(TRUSTED_IP_HEADERS).toContain("CF-Connecting-IPv6");
	});

	it("includes True-Client-IP", () => {
		expect(TRUSTED_IP_HEADERS).toContain("True-Client-IP");
	});

	it("includes X-Forwarded-For and X-Real-IP", () => {
		expect(TRUSTED_IP_HEADERS).toContain("X-Forwarded-For");
		expect(TRUSTED_IP_HEADERS).toContain("X-Real-IP");
	});

	it("contains exactly the documented set of trusted headers", () => {
		expect(TRUSTED_IP_HEADERS).toHaveLength(5);
	});
});

describe("rateLimitConfig", () => {
	describe("betterAuth.global", () => {
		it("is enabled with sensible defaults", () => {
			expect(rateLimitConfig.betterAuth.global.enabled).toBe(true);
			expect(rateLimitConfig.betterAuth.global.window).toBe(60);
			expect(rateLimitConfig.betterAuth.global.max).toBe(60);
		});

		it("rate-limits sign-in/email more strictly than global default", () => {
			expect(rateLimitConfig.betterAuth.global.customRules["/sign-in/email"]).toEqual({ window: 60, max: 5 });
		});

		it("rate-limits sign-up/email even more strictly", () => {
			expect(rateLimitConfig.betterAuth.global.customRules["/sign-up/email"]).toEqual({ window: 60, max: 3 });
		});

		it("uses long window for password reset to deter abuse", () => {
			expect(rateLimitConfig.betterAuth.global.customRules["/request-password-reset"]).toEqual({
				window: 600,
				max: 3,
			});
		});

		it("rate-limits 2FA verification with longer windows", () => {
			expect(rateLimitConfig.betterAuth.global.customRules["/two-factor/verify-otp"].window).toBe(600);
			expect(rateLimitConfig.betterAuth.global.customRules["/two-factor/verify-totp"].window).toBe(600);
			expect(rateLimitConfig.betterAuth.global.customRules["/two-factor/verify-backup-code"].window).toBe(600);
		});

		it("allows generous polling for username availability", () => {
			expect(rateLimitConfig.betterAuth.global.customRules["/is-username-available"]).toEqual({
				window: 60,
				max: 20,
			});
		});
	});

	describe("betterAuth.oauthProvider", () => {
		it("rate-limits register most strictly", () => {
			expect(rateLimitConfig.betterAuth.oauthProvider.register.max).toBe(5);
		});

		it("allows higher introspect/userinfo throughput", () => {
			expect(rateLimitConfig.betterAuth.oauthProvider.introspect.max).toBe(60);
			expect(rateLimitConfig.betterAuth.oauthProvider.userinfo.max).toBe(60);
		});
	});

	describe("betterAuth.apiKey", () => {
		it("is enabled with hourly window of 1000 requests", () => {
			expect(rateLimitConfig.betterAuth.apiKey.enabled).toBe(true);
			expect(rateLimitConfig.betterAuth.apiKey.timeWindow).toBe(60 * 60 * 1000);
			expect(rateLimitConfig.betterAuth.apiKey.maxRequests).toBe(1000);
		});
	});

	describe("orpc", () => {
		it("limits resume password reset to 5 per 10 minutes", () => {
			expect(rateLimitConfig.orpc.resumePassword).toEqual({ maxRequests: 5, window: 10 * 60 * 1000 });
		});

		it("limits critique password verification to 5 per 10 minutes", () => {
			expect(rateLimitConfig.orpc.critiquePassword).toEqual({ maxRequests: 5, window: 10 * 60 * 1000 });
		});

		it("limits PDF export to 5 per minute", () => {
			expect(rateLimitConfig.orpc.pdfExport).toEqual({ maxRequests: 5, window: 60 * 1000 });
		});

		it("limits AI requests to 20 per minute", () => {
			expect(rateLimitConfig.orpc.aiRequest).toEqual({ maxRequests: 20, window: 60 * 1000 });
		});

		it("provides reasonable mutation throughput for resume edits", () => {
			expect(rateLimitConfig.orpc.resumeMutations).toEqual({ maxRequests: 300, window: 60 * 1000 });
		});

		it("limits storage uploads more strictly than deletes", () => {
			expect(rateLimitConfig.orpc.storageUpload.maxRequests).toBeLessThan(
				rateLimitConfig.orpc.storageDelete.maxRequests,
			);
		});
	});
});
