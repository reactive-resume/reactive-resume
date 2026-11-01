// Run: node --test apps/mobile/scripts/share-short-link.test.mjs
// The native Share row uses the same short-link decision as web. Prove the offline/pending/error states never trust a
// cached other-primary row, while a primary resume still uses its own known public state.
import assert from "node:assert/strict";
import { test } from "node:test";
import { shareListState, shortLinkOpens } from "@reactive-resume/resume/sharing";

test("native Share keeps Copy off for another primary while the list is not ready", () => {
	for (const listState of ["pending", "error", "offline"]) {
		assert.equal(
			shortLinkOpens({ isPrimary: false, isPublic: false, listState, otherPrimaryIsPublic: true }),
			false,
			`${listState} must not trust cached other-primary data`,
		);
	}
	assert.equal(
		shortLinkOpens({ isPrimary: false, isPublic: false, listState: "ready", otherPrimaryIsPublic: true }),
		true,
	);
	assert.equal(
		shortLinkOpens({ isPrimary: false, isPublic: false, listState: "ready", otherPrimaryIsPublic: false }),
		false,
	);
});

test("native Share keeps a primary resume's own published decision", () => {
	for (const listState of ["pending", "error", "ready", "offline"]) {
		assert.equal(shortLinkOpens({ isPrimary: true, isPublic: true, listState, otherPrimaryIsPublic: undefined }), true);
	}
	assert.equal(
		shortLinkOpens({ isPrimary: true, isPublic: false, listState: "ready", otherPrimaryIsPublic: true }),
		false,
	);
});

test("native list state maps the query flags and offline override", () => {
	assert.equal(shareListState({ isPending: true, isError: false }), "pending");
	assert.equal(shareListState({ isPending: false, isError: true }), "error");
	assert.equal(shareListState({ isPending: false, isError: false }), "ready");
});
