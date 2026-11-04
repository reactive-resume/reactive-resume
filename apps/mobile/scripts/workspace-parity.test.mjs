// Run: node apps/mobile/scripts/workspace-parity.test.mjs
// Pure native workspace logic, evaluated on the host (no React Native runtime).
import assert from "node:assert/strict";
import { bundle } from "./harness.mjs";

const load = (entry, dependencies = {}, external = []) => bundle(entry, dependencies, { external });
const logic = load(new URL("../src/features/workspace/logic.ts", import.meta.url).pathname);
assert.equal(logic.clock(67, "en-US"), "1:07");
assert.equal(logic.clock(67, "ar-SA"), "١:٠٧");
assert.equal(logic.clock(0, "ar-SA"), "٠:٠٠");
const origin = load(new URL("../src/features/applications/origin.ts", import.meta.url).pathname);
const draftOwner = load(new URL("../src/features/letters/draft-owner.ts", import.meta.url).pathname);

// The real native drafting store, with only its platform/storage boundaries faked.
let draftServer = "https://rx.example";
let draftAccount = "account-1";
let letterState = { document: { id: "letter-a", revision: 1 } };
const draftStorage = new Map();
const draftDeps = {
	"expo-sqlite/kv-store": {
		__esModule: true,
		default: {
			getItem: async (key) => draftStorage.get(key) ?? null,
			setItem: async (key, value) => void draftStorage.set(key, value),
			removeItem: async (key) => void draftStorage.delete(key),
		},
	},
	"./save": { saveLetter: async () => true },
	"@/api/client": {
		streamClient: {
			coverLetters: {
				draft: async () =>
					(async function* () {
						yield "A";
						yield " draft";
					})(),
			},
		},
	},
	"@/auth/session": {
		getServer: () => draftServer,
		getAccountScope: () => draftAccount,
	},
	"@/draft": { useLetterStore: { getState: () => letterState } },
};
const drafting = load(new URL("../src/features/letters/drafting.ts", import.meta.url).pathname, draftDeps, [
	"expo-sqlite/kv-store",
	"./save",
	"@/api/client",
	"@/auth/session",
	"@/draft",
]);

// A3-06: Saved→stage is actionable and carries a receipt; an already-reached stage stays fixed.
assert.equal(logic.isFixedChange({ type: "stage", stage: "interview" }, "saved"), false);
assert.equal(logic.needsSubmission({ type: "stage", stage: "interview" }, "saved"), true);
assert.equal(logic.needsSubmission({ type: "stage", stage: "interview" }, "applied"), false);
assert.equal(logic.isFixedChange({ type: "stage", stage: "interview" }, "interview"), true);
assert.deepEqual(logic.openChanges([{ type: "stage", stage: "interview" }], "saved"), [0]);

// A3-30: only an unkept streaming/ready draft blocks leaving.
assert.equal(logic.draftNeedsLeaveGuard("ready"), true);
assert.equal(logic.draftNeedsLeaveGuard("streaming"), true);
assert.equal(logic.draftNeedsLeaveGuard("failed"), false);
assert.equal(logic.draftNeedsLeaveGuard("idle"), false);

// A3-07: only the application that links the open document may claim Back.
const app = { id: "a1", resumeId: "r1", coverLetterId: "l1" };
assert.deepEqual(origin.applicationOrigin("resume", "r1", app), { id: "a1" });
assert.deepEqual(origin.applicationOrigin("letter", "l1", app), { id: "a1" });
assert.equal(origin.applicationOrigin("resume", "other", app), null);
assert.equal(origin.applicationOrigin("resume", "r1", { ...app, resumeId: "elsewhere" }), null);
assert.equal(origin.applicationOrigin("resume", "r1", null), null);

// A3-30: a native draft belongs to one server + account + letter; no cross-letter or cross-account leak.
const draftA = draftOwner.letterDraftOwnerKey("https://rx.example", "account-1", "letter-a");
const draftB = draftOwner.letterDraftOwnerKey("https://rx.example", "account-1", "letter-b");
const otherAccount = draftOwner.letterDraftOwnerKey("https://rx.example", "account-2", "letter-a");
const otherServer = draftOwner.letterDraftOwnerKey("https://other.example", "account-1", "letter-a");
assert.notEqual(draftA, draftB);
assert.notEqual(draftA, otherAccount);
assert.notEqual(draftA, otherServer);
const readyA = { phase: "ready", text: "A's unkept draft", revision: 1, versions: [] };
const state = { owner: draftA, draft: readyA };
assert.equal(draftOwner.draftForOwner(state, draftA, { phase: "idle" }), readyA);
assert.deepEqual(draftOwner.draftForOwner(state, draftB, { phase: "idle" }), { phase: "idle" });
assert.deepEqual(draftOwner.draftForOwner(state, otherAccount, { phase: "idle" }), { phase: "idle" });

// The real store lifecycle: A→B, reopen A, leave mid-stream, and a stale Keep target.
assert.equal(drafting.letterDraftOwner("letter-a"), draftA);
drafting.useLetterDrafting.setState({ owner: draftA, draft: readyA, last: { variant: "draft" } });
draftStorage.set(draftA, JSON.stringify({ text: "A stored", variant: "draft", revision: 1 }));
letterState = { document: { id: "letter-b", revision: 1 } };
await drafting.restoreLetterDraft("letter-b");
assert.equal(drafting.useLetterDrafting.getState().owner, draftB);
assert.deepEqual(drafting.useLetterDrafting.getState().draft, { phase: "idle" });
letterState = { document: { id: "letter-a", revision: 1 } };
await drafting.restoreLetterDraft("letter-a");
assert.equal(drafting.useLetterDrafting.getState().draft.phase, "ready");
assert.equal(drafting.useLetterDrafting.getState().draft.text, "A stored");
assert.equal(drafting.useLetterDrafting.getState().draft.revision, 1);
// A ready draft from an older letter revision is not offered against newer content.
drafting.useLetterDrafting.setState({ owner: draftB, draft: { phase: "idle" }, last: { variant: "draft" } });
draftStorage.set(draftA, JSON.stringify({ text: "stale", variant: "draft", revision: 2 }));
letterState = { document: { id: "letter-a", revision: 1 } };
await drafting.restoreLetterDraft("letter-a");
assert.deepEqual(drafting.useLetterDrafting.getState().draft, { phase: "idle" });
// Leaving after a ready draft keeps it for this letter; leaving mid-stream clears the phantom card.
drafting.useLetterDrafting.setState({
	owner: draftA,
	draft: { phase: "ready", text: "A stored", revision: 1, operation: "test", versions: [] },
});
drafting.stopLetterDraft();
assert.equal(drafting.useLetterDrafting.getState().draft.phase, "ready");
drafting.useLetterDrafting.setState({
	owner: draftA,
	draft: { phase: "streaming", text: "half", revision: 1, operation: "test", versions: [] },
});
drafting.stopLetterDraft();
assert.deepEqual(drafting.useLetterDrafting.getState().draft, { phase: "idle" });
// A late stream from A cannot write into B after navigation.
letterState = { document: { id: "letter-a", revision: 1 } };
const pendingA = drafting.startLetterDraft();
letterState = { document: { id: "letter-b", revision: 1 } };
drafting.useLetterDrafting.setState({ owner: draftB, draft: { phase: "idle" }, last: { variant: "draft" } });
await pendingA;
assert.equal(drafting.useLetterDrafting.getState().owner, draftB);
assert.deepEqual(drafting.useLetterDrafting.getState().draft, { phase: "idle" });
// Discard only touches the open letter's stored draft.
drafting.useLetterDrafting.setState({
	owner: draftB,
	draft: { phase: "ready", text: "B", revision: 1, operation: "test", versions: [] },
});
draftStorage.set(draftA, JSON.stringify({ text: "A stored", variant: "draft", revision: 1 }));
draftStorage.set(draftB, JSON.stringify({ text: "B", variant: "draft", revision: 1 }));
drafting.discardLetterDraft();
assert.equal(draftStorage.has(draftB), false);
assert.equal(draftStorage.has(draftA), true);

console.log("PASS: native workspace logic, draft guard/ownership/lifecycle and application origin.");
