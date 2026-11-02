import type { PostingSource } from "./data";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { postingReadReceipt } from "./posting-source";

afterEach(() => vi.useRealTimers());

it("names the retained resolved host without exposing credentials, path or tracking data", () => {
	vi.useFakeTimers().setSystemTime(new Date("2026-11-02T13:30:00Z"));
	const source: PostingSource = {
		method: "builtin",
		format: "text",
		truncated: false,
		completeness: "unknown",
		retrievedAt: "2026-11-02T13:27:00Z",
		requestedUrl: "https://redirect.example.test/job",
		resolvedUrl: "https://user:secret@jobs.example.test/private?token=secret",
	};
	expect(postingReadReceipt(source, "en-US")).toEqual({ readAt: "3 minutes ago", sourceHost: "jobs.example.test" });
	expect(postingReadReceipt({ ...source, resolvedUrl: undefined }, "en-US")?.sourceHost).toBe("redirect.example.test");
	expect(postingReadReceipt({ ...source, resolvedUrl: "javascript:alert(1)" }, "en-US")?.sourceHost).toBeNull();
	expect(postingReadReceipt({ ...source, resolvedUrl: "invalid" }, "en-US")?.sourceHost).toBeNull();
	expect(postingReadReceipt({ ...source, method: "paste" }, "en-US")).toBeNull();
	expect(postingReadReceipt({ ...source, retrievedAt: undefined }, "en-US")).toBeNull();
	expect(postingReadReceipt({ ...source, retrievedAt: "invalid" }, "en-US")).toBeNull();
	expect(postingReadReceipt(null, "en-US")).toBeNull();
});

it("uses a completed read's current instant even between client clock ticks", () => {
	vi.useFakeTimers().setSystemTime(new Date("2026-11-02T13:30:00Z"));
	const tick = Date.now();
	vi.setSystemTime(new Date("2026-11-02T13:30:30Z"));
	const source: PostingSource = {
		method: "builtin",
		format: "text",
		truncated: false,
		completeness: "unknown",
		retrievedAt: new Date().toISOString(),
	};
	expect(postingReadReceipt(source, "en-US", tick)?.readAt).toBe("now");
	vi.setSystemTime(new Date("2026-11-02T13:32:30Z"));
	expect(postingReadReceipt(source, "en-US", Date.now())?.readAt).toBe("2 minutes ago");
});
