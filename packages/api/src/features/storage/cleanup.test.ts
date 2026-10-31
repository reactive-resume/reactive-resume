import { afterEach, expect, it, vi } from "vite-plus/test";
import { reportStorageCleanupSummary } from "./cleanup";

afterEach(() => vi.restoreAllMocks());

it("emits a sanitized aggregate when cleanup work remains", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	reportStorageCleanupSummary({ completed: 2, missing: 1, failed: 3, partial: 4, abandoned: 1 });

	expect(warn).toHaveBeenCalledOnce();
	const [message, summary] = warn.mock.calls[0] ?? [];
	expect(message).toContain("docs/contributing/storage-cleanup.mdx");
	expect(summary).toEqual({ completed: 2, missing: 1, failed: 3, partial: 4, abandoned: 1 });
	expect(JSON.stringify(warn.mock.calls)).not.toContain("uploads/");
});

it("stays quiet when every job completed", () => {
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	reportStorageCleanupSummary({ completed: 2, missing: 1, failed: 0, partial: 0, abandoned: 0 });
	expect(warn).not.toHaveBeenCalled();
});
