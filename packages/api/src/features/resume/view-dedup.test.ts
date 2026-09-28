import { describe, expect, it } from "vitest";
import { clientKeyFromHeaders, shouldCountView } from "./view-dedup";

// `seen` is module-level state shared across tests, so each test uses a unique key.
const WINDOW_MS = 60 * 60 * 1000;

describe("shouldCountView", () => {
	it("counts the first view, skips repeats within the window, counts again after it", async () => {
		const key = "resume-1:viewer-a";
		const t0 = 1_000_000;

		expect(await shouldCountView(key, t0)).toBe(true);
		expect(await shouldCountView(key, t0 + 1)).toBe(false);
		expect(await shouldCountView(key, t0 + WINDOW_MS - 1)).toBe(false);
		// Once now is past the window, the same key counts again.
		expect(await shouldCountView(key, t0 + WINDOW_MS + 1)).toBe(true);
	});

	it("treats different keys independently", async () => {
		const t0 = 2_000_000;

		expect(await shouldCountView("resume-2:viewer-a", t0)).toBe(true);
		expect(await shouldCountView("resume-2:viewer-b", t0)).toBe(true);
		expect(await shouldCountView("resume-2:viewer-a", t0 + 1)).toBe(false);
	});
});

describe("clientKeyFromHeaders", () => {
	it("derives distinct keys from distinct trusted-IP headers", () => {
		const a = clientKeyFromHeaders(new Headers({ "X-Forwarded-For": "1.1.1.1" }));
		const b = clientKeyFromHeaders(new Headers({ "X-Forwarded-For": "2.2.2.2" }));

		expect(a).toBe("ip:1.1.1.1");
		expect(a).not.toBe(b);
	});

	it("uses the first IP from a comma-delimited proxy chain", () => {
		const key = clientKeyFromHeaders(new Headers({ "X-Forwarded-For": "3.3.3.3, 10.0.0.1" }));
		expect(key).toBe("ip:3.3.3.3");
	});

	it("falls back to a stable user-agent fingerprint when no trusted IP header is present", () => {
		const headers = new Headers({ "user-agent": "Mozilla/5.0", "accept-language": "en-US,en" });

		const first = clientKeyFromHeaders(headers);
		const second = clientKeyFromHeaders(headers);

		expect(first).toBe(second);
		expect(first.startsWith("fp:")).toBe(true);
		// A different UA yields a different fallback key.
		expect(clientKeyFromHeaders(new Headers({ "user-agent": "curl/8" }))).not.toBe(first);
	});
});
