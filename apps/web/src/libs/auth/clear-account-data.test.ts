import { expect, it, vi } from "vite-plus/test";
// @vitest-environment happy-dom
import { QueryClient } from "@tanstack/react-query";
import { getAccountGeneration, getAccountId, setAccountScope } from "./account-scope";
import { clearAccountData, syncAccountDataAcrossTabs } from "./clear-account-data";

vi.mock("@/features/resume/builder/draft", () => ({ clearResumeDrafts: vi.fn() }));
vi.mock("@/features/documents/thumbnail-store", () => ({ clearStoredThumbnails: vi.fn(async () => undefined) }));

it("removes contact snapshots, unsaved resumes, and career drafts from both browser stores", () => {
	const privateKeys = [
		"letter-sender:letter",
		"reactive-resume:unsaved:resume",
		"reactive-resume:unsaved:letter:letter:session",
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

it("signing out fences saves queued for the old account and tells other tabs", () => {
	setAccountScope("alice");
	const generation = getAccountGeneration();
	const queryClient = new QueryClient();
	clearAccountData(queryClient);
	expect(getAccountId()).toBeNull();
	expect(getAccountGeneration()).toBe(generation + 1);
	expect(localStorage.getItem("reactive-resume:account-change")).not.toBeNull();
});

it("a sign-out in another tab drops this tab's account data and reloads into the new session", () => {
	const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
	setAccountScope("alice");
	const generation = getAccountGeneration();
	const queryClient = new QueryClient();
	queryClient.setQueryData(["preferences"], "Alice private priorities");
	syncAccountDataAcrossTabs(queryClient);
	window.dispatchEvent(new StorageEvent("storage", { key: "reactive-resume:account-change", newValue: "1" }));
	expect(queryClient.getQueryData(["preferences"])).toBeUndefined();
	expect(getAccountGeneration()).toBeGreaterThan(generation);
	expect(reload).toHaveBeenCalledOnce();
	reload.mockRestore();
});
