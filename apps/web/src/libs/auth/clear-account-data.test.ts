import { expect, it, vi } from "vite-plus/test";
// @vitest-environment happy-dom
import { QueryClient } from "@tanstack/react-query";
import { clearAccountData } from "./clear-account-data";

vi.mock("@/features/resume/builder/draft", () => ({ clearResumeDrafts: vi.fn() }));
vi.mock("@/features/documents/thumbnail-store", () => ({ clearStoredThumbnails: vi.fn(async () => undefined) }));

it("removes contact snapshots, unsaved resumes, and career drafts from both browser stores", () => {
	const privateKeys = [
		"letter-sender:letter",
		"reactive-resume:unsaved:resume",
		"career-story:user",
		"career:debrief:application",
		"new-documents",
	];
	for (const storage of [localStorage, sessionStorage]) {
		for (const key of privateKeys) storage.setItem(key, "private");
		storage.setItem("theme", "dark");
	}
	const queryClient = new QueryClient();
	queryClient.setQueryData(["resume"], "private");
	clearAccountData(queryClient);
	for (const storage of [localStorage, sessionStorage]) {
		for (const key of privateKeys) expect(storage.getItem(key)).toBeNull();
		expect(storage.getItem("theme")).toBe("dark");
	}
	expect(queryClient.getQueryData(["resume"])).toBeUndefined();
});
