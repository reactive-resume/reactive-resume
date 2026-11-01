import { describe, expect, it } from "vite-plus/test";
import { shareListState, shortLinkOpens } from "./sharing";

describe("shareListState", () => {
	it("maps query flags to the Share list state", () => {
		expect(shareListState({ isPending: true, isError: false })).toBe("pending");
		expect(shareListState({ isPending: false, isError: true })).toBe("error");
		expect(shareListState({ isPending: false, isError: false })).toBe("ready");
	});
});

describe("shortLinkOpens", () => {
	it("uses the resume's own published state when it is primary, independent of the list", () => {
		for (const listState of ["pending", "error", "ready", "offline"] as const)
			expect(shortLinkOpens({ isPrimary: true, isPublic: true, listState, otherPrimaryIsPublic: undefined })).toBe(
				true,
			);
		expect(shortLinkOpens({ isPrimary: true, isPublic: false, listState: "ready", otherPrimaryIsPublic: true })).toBe(
			false,
		);
	});

	it("offers another primary's short link only after a successful list lookup", () => {
		expect(shortLinkOpens({ isPrimary: false, isPublic: false, listState: "ready", otherPrimaryIsPublic: true })).toBe(
			true,
		);
		expect(shortLinkOpens({ isPrimary: false, isPublic: false, listState: "ready", otherPrimaryIsPublic: false })).toBe(
			false,
		);
		expect(
			shortLinkOpens({ isPrimary: false, isPublic: false, listState: "ready", otherPrimaryIsPublic: undefined }),
		).toBe(false);
	});

	it("never uses cached other-primary data while the lookup is pending, failed or offline", () => {
		for (const listState of ["pending", "error", "offline"] as const)
			expect(shortLinkOpens({ isPrimary: false, isPublic: false, listState, otherPrimaryIsPublic: true })).toBe(false);
	});
});
