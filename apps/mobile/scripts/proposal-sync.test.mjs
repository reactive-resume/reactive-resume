import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const mobileRequire = createRequire(new URL("../package.json", import.meta.url));
const { buildSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const root = fileURLToPath(new URL("../../../", import.meta.url));
function evaluate(options, boundaries = {}) {
	const code = buildSync({ bundle: true, platform: "node", format: "cjs", write: false, ...options }).outputFiles[0]
		.text;
	const module = { exports: {} };
	new Function("require", "module", "exports", "setTimeout", code)(
		(name) => {
			assert.ok(name in boundaries, name);
			return boundaries[name];
		},
		module,
		module.exports,
		() => 0,
	);
	return module.exports;
}
const { createDraftStore } = evaluate(
	{ entryPoints: [root + "apps/mobile/src/draft/store.ts"], external: ["zustand", "immer"] },
	{ zustand: mobileRequire("zustand"), immer: mobileRequire("immer") },
);
const shared = evaluate({ entryPoints: [root + "packages/resume/src/proposals.ts"] });
const fixtures = evaluate({
	stdin: {
		contents:
			'export {defaultResumeData} from "@reactive-resume/schema/resume/default"; export {copyCoverLetterStyle} from "@reactive-resume/resume/cover-letter";',
		resolveDir: root + "apps/mobile",
		loader: "ts",
	},
});
const requests = [];
let documents;
let online = true;
let fail = false;
let blocked = false;
let scope = "https://review.invalid:alice";
let responseGate = null;
// The server's answer to an unchecked content save on a document an older app could edit wrongly.
let refuseUnchecked = false;
const { ORPCError } = await import("@orpc/client");
function network(kind) {
	return {
		getById: async () => structuredClone(documents[kind]),
		update: async (input) => {
			requests.push(structuredClone({ kind, input }));
			if (responseGate) await responseGate;
			if (fail) throw new Error("offline");
			if (refuseUnchecked && !input.proposalSafety)
				throw new ORPCError(kind === "resume" ? "RESUME_VERSION_CONFLICT" : "CONFLICT", {
					data: { reason: "CURRENT_CLIENT_REQUIRED" },
				});
			const old = documents[kind];
			if (kind === "resume" && input.expectedUpdatedAt && input.expectedUpdatedAt.getTime() !== old.updatedAt.getTime())
				throw new ORPCError("RESUME_VERSION_CONFLICT");
			if (kind === "letter" && input.expectedRevision !== old.revision) throw new ORPCError("CONFLICT");
			const next = { ...old, ...input, revision: old.revision + 1, updatedAt: new Date(old.updatedAt.getTime() + 1) };
			documents[kind] = next;
			return structuredClone(next);
		},
	};
}
const adapters = evaluate(
	{
		entryPoints: [root + "apps/mobile/src/draft/adapters.ts"],
		external: ["@/api/client", "@lingui/core/macro", "@orpc/client"],
	},
	{
		"@/api/client": { client: { resume: network("resume"), coverLetters: network("letter") } },
		"@lingui/core/macro": { t: (x) => x.join("") },
		"@orpc/client": { ORPCError },
	},
);
const proposal = {
	id: "receipt",
	before: "<p>Old</p>",
	after: "<p>New</p>",
	target: { sectionId: "summary", field: "content" },
	status: "pending",
	source: "assistant",
	location: "Summary",
	why: "Rewrite",
};
function setup(kind) {
	requests.length = 0;
	online = true;
	fail = false;
	blocked = false;
	refuseUnchecked = false;
	scope = "https://review.invalid:alice";
	responseGate = null;
	const now = new Date("2026-10-31T00:00:00Z");
	const data = structuredClone(fixtures.defaultResumeData);
	data.summary.content = proposal.before;
	documents = {
		resume: {
			id: "resume",
			name: "Resume",
			slug: "resume",
			tags: [],
			data,
			isPublic: false,
			showDownloadButtons: true,
			isLocked: false,
			revision: 1,
			createdAt: now,
			updatedAt: now,
		},
		letter: {
			id: "letter",
			name: "Letter",
			recipient: "",
			content: proposal.before,
			greeting: null,
			signOff: null,
			recipientName: "",
			recipientCompany: "",
			letterDate: null,
			sourceResumeId: null,
			sourceApplicationId: null,
			senderLinked: false,
			designLinked: false,
			style: fixtures.copyCoverLetterStyle(data),
			layout: "structured",
			revision: 1,
			isLocked: false,
			createdAt: now,
			updatedAt: now,
		},
	};
	const storage = new Map();
	const environment = {
		storage: {
			getItemSync: (k) => storage.get(k) ?? null,
			setItemSync: (k, v) => {
				if (blocked) throw new Error("full");
				storage.set(k, v);
			},
			removeItemSync: (k) => storage.delete(k),
			getAllKeysSync: () => [...storage.keys()],
		},
		scope: async () => scope,
		online: () => online,
		focused: () => false,
	};
	const adapter = adapters[kind + "Adapter"];
	const owner = () => createDraftStore(adapter, environment);
	return { owner, storage, environment };
}
function accept(s, kind) {
	const applied = [];
	s().update(
		(d) => {
			const r = shared.applyProposals(
				[proposal],
				() => (kind === "resume" ? d.summary.content : d.content),
				(_, value) => {
					if (kind === "resume") d.summary.content = value;
					else d.content = value;
				},
				s().proposalApplications,
			);
			applied.push(...r.applied);
		},
		{ newStep: true, applied },
	);
}
for (const kind of ["resume", "letter"]) {
	test(`${kind} refresh must honor newer remote Undo receipt`, async () => {
		const { owner } = setup(kind);
		const o = owner();
		const s = o.store.getState;
		await s().open(kind);
		accept(s, kind);
		await s().flush();
		documents[kind] = {
			...documents[kind],
			revision: documents[kind].revision + 1,
			updatedAt: new Date(documents[kind].updatedAt.getTime() + 1),
		};
		await o.refresh();
		assert.deepEqual(s().proposalApplications, {}, "Same-content external revisions expire confirmed receipts too");
		const remote = structuredClone(documents[kind]);
		if (kind === "resume") remote.data.summary.content = proposal.before;
		else remote.content = proposal.before;
		remote.updatedAt = new Date(remote.updatedAt.getTime() + 1);
		remote.revision++;
		documents[kind] = remote;
		await o.refresh();
		const content = kind === "resume" ? s().data.summary.content : s().data.content;
		assert.equal(shared.getStateIn(content, proposal, s().proposalApplications), "pending");
	});
	test(`${kind} inflight Undo survives ack through real adapter`, async () => {
		const { owner } = setup(kind);
		const o = owner();
		const s = o.store.getState;
		await s().open(kind);
		accept(s, kind);
		let release;
		responseGate = new Promise((resolve) => {
			release = resolve;
		});
		const writing = s().flush();
		for (let i = 0; i < 10 && requests.length === 0; i++) await Promise.resolve();
		assert.equal(requests.length, 1);
		s().undo();
		responseGate = null;
		release();
		await writing;
		assert.deepEqual(
			requests.map((r) => r.input.proposalApplications),
			[{ receipt: proposal.after }, { receipt: false }],
		);
		assert.equal(kind === "resume" ? documents[kind].data.summary.content : documents[kind].content, proposal.before);
		assert.equal(s().status, "saved");
	});
	test(`${kind} unavailable storage retains unsent Undo in memory across navigation, but fresh process cannot recover it`, async () => {
		const { owner } = setup(kind);
		const o = owner();
		const s = o.store.getState;
		await s().open(kind);
		accept(s, kind);
		await s().flush();
		blocked = true;
		fail = true;
		s().undo();
		await s().flush();
		assert.equal(s().status, "error");
		await s().close();
		await s().open(kind);
		assert.equal(s().proposalApplications.receipt, false);
		// This is an explicit limit, not proof of durable restart when storage fails.
		o.suspend();
		const fresh = owner();
		await fresh.store.getState().open(kind);
		assert.equal(fresh.store.getState().proposalApplications.receipt, proposal.after);
	});
}

for (const kind of ["resume", "letter"])
	test(`${kind} restart must not advance an old Undo to a newer same-content baseline`, async () => {
		const { owner, storage } = setup(kind);
		const o = owner();
		const s = o.store.getState;
		await s().open(kind);
		accept(s, kind);
		await s().flush();
		fail = true;
		s().undo();
		await s().flush();
		o.suspend();
		// Other client Undo, reaccept, then manually restore old text. Its receipt remains accepted.
		const remote = structuredClone(documents[kind]);
		if (kind === "resume") remote.data.summary.content = proposal.before;
		else remote.content = proposal.before;
		remote.revision += 3;
		remote.updatedAt = new Date(remote.updatedAt.getTime() + 3);
		documents[kind] = adapters[kind + "Adapter"].parse(remote);
		fail = false;
		requests.length = 0;
		const fresh = owner();
		await fresh.store.getState().open(kind);
		assert.equal(requests.length, 0, "Must retain conflict/original version instead of rebasing stale decision");
		assert.ok(fresh.store.getState().conflict, "Recovery must expose an explicit conflict");
		assert.equal(fresh.store.getState().proposalApplications.receipt, false);
		const queued = JSON.parse([...storage.values()][0]);
		assert.equal(queued.baseline.revision, 2, "Queued decision retains its original revision across reload");
		fresh.suspend();
		const replay = owner();
		await replay.replay();
		assert.equal(requests.length, 1);
		assert.equal(
			kind === "resume" ? requests[0].input.expectedUpdatedAt.getTime() : requests[0].input.expectedRevision,
			kind === "resume" ? new Date(queued.baseline.updatedAt).getTime() : queued.baseline.revision,
		);
		assert.equal(documents[kind].revision, remote.revision, "Stale outbox cannot overwrite the newer decision");
		assert.deepEqual(JSON.parse([...storage.values()][0]).pendingProposalApplications, { receipt: false });
		await replay.store.getState().open(kind);
		await replay.store.getState().resolveConflict("use-theirs");
		assert.deepEqual(replay.store.getState().proposalApplications, {});
		assert.equal(replay.store.getState().conflict, null);
	});

for (const kind of ["resume", "letter"])
	test(`${kind} matching authored recovery drops confirmed receipts from the older revision`, async () => {
		const { owner } = setup(kind);
		const old = owner();
		const state = old.store.getState;
		await state().open(kind);
		accept(state, kind);
		await state().flush();
		state().update(
			(data) => {
				if (kind === "resume") data.summary.content = proposal.before;
				else data.content = proposal.before;
			},
			{ newStep: true },
		);
		fail = true;
		await state().flush();
		old.suspend();
		const remote = structuredClone(documents[kind]);
		if (kind === "resume") remote.data.summary.content = proposal.before;
		else remote.content = proposal.before;
		remote.revision += 2;
		remote.updatedAt = new Date(remote.updatedAt.getTime() + 2);
		documents[kind] = adapters[kind + "Adapter"].parse(remote);
		fail = false;
		requests.length = 0;
		const fresh = owner();
		await fresh.store.getState().open(kind);
		assert.deepEqual(fresh.store.getState().proposalApplications, {});
		assert.equal(fresh.store.getState().status, "saved");
		assert.equal(requests.length, 0);
	});

for (const kind of ["resume", "letter"])
	for (const pendingUndo of [false, true])
		test(`${kind} Keep mine resets obsolete history and preserves ${pendingUndo ? "queued Undo" : "authored content"}`, async () => {
			const { owner, storage } = setup(kind);
			const draft = owner();
			const state = draft.store.getState;
			await state().open(kind);
			accept(state, kind);
			await state().flush();
			const refine = (text) =>
				state().update(
					(data) => {
						if (kind === "resume") data.summary.content = text;
						else data.content = text;
					},
					{ newStep: true },
				);
			if (pendingUndo) state().undo();
			else {
				refine("<p>Local refinement</p>");
				refine("<p>Later refinement</p>");
				state().undo();
			}
			const expectedContent = pendingUndo ? proposal.before : "<p>Local refinement</p>";
			// Another client undoes the accepted proposal after this visit's baseline.
			const remote = structuredClone(documents[kind]);
			if (kind === "resume") remote.data.summary.content = proposal.before;
			else remote.content = proposal.before;
			remote.updatedAt = new Date(remote.updatedAt.getTime() + 1);
			remote.revision++;
			documents[kind] = remote;
			await state().flush();
			assert.ok(state().conflict);
			requests.length = 0;
			await state().resolveConflict("keep-mine");
			assert.equal(state().status, "saved");
			assert.equal(kind === "resume" ? documents[kind].data.summary.content : documents[kind].content, expectedContent);
			assert.deepEqual(
				requests.map((r) => r.input.proposalApplications),
				[pendingUndo ? { receipt: false } : undefined],
			);
			assert.deepEqual(state().proposalApplications, pendingUndo ? { receipt: false } : {});
			assert.equal(state().canUndo, false, "History from the superseded baseline must expire");
			assert.equal(state().canRedo, false);
			requests.length = 0;
			state().undo();
			state().redo();
			await state().flush();
			assert.equal(requests.length, 0, "Old history must not reaccept a remotely undone proposal");
			if (pendingUndo) assert.deepEqual(JSON.parse([...storage.values()][0]).pendingProposalApplications, {});
			refine("<p>New local step</p>");
			state().undo();
			await state().flush();
			assert.equal(kind === "resume" ? documents[kind].data.summary.content : documents[kind].content, expectedContent);
			assert.notEqual(requests.at(-1).input.proposalApplications?.receipt, proposal.after);
			draft.suspend();
		});

for (const kind of ["resume", "letter"]) {
	test(`${kind} never vouches for a draft an older app kept: it goes out unchecked until the server takes it`, async () => {
		const { owner, storage } = setup(kind);
		const baseline = structuredClone(documents[kind]);
		const document =
			kind === "resume"
				? { ...baseline, data: { ...baseline.data, summary: { ...baseline.data.summary, content: proposal.after } } }
				: { ...baseline, content: proposal.after };
		// What an older app's store left on disk while offline: no proposalSafety.
		const older = (extra = {}) =>
			storage.set(
				`reactive-resume:unsaved:${encodeURIComponent(scope)}:${kind}:${kind}`,
				JSON.stringify({
					baseline,
					document,
					sessionId: "older-visit",
					proposalApplications: { receipt: true },
					pendingProposalApplications: { receipt: true },
					...extra,
				}),
			);

		// On a document that refuses unchecked saves, opening sends it unchecked, is refused and keeps the draft aside.
		older();
		refuseUnchecked = true;
		let o = owner();
		await o.store.getState().open(kind);
		assert.equal(requests.length, 1);
		assert.equal("proposalSafety" in requests[0].input, false);
		assert.deepEqual(requests[0].input.proposalApplications, { receipt: true });
		assert.ok(o.store.getState().conflict, "The refusal leaves the draft for Keep both or Use theirs");
		assert.equal(o.store.getState().conflict.reason, "CURRENT_CLIENT_REQUIRED");
		requests.length = 0;
		await o.store.getState().resolveConflict("keep-mine");
		assert.equal(requests.length, 0, "Keep mine cannot resolve a current-client refusal");
		const kept = JSON.parse([...storage.values()][0]);
		assert.equal(kept.proposalSafety, undefined, "A refused draft stays the older app's");
		assert.equal(kept.conflictReason, "CURRENT_CLIENT_REQUIRED");
		assert.equal(kind === "resume" ? documents[kind].data.summary.content : documents[kind].content, proposal.before);
		await o.store.getState().close();
		o = owner();
		await o.store.getState().open(kind);
		assert.equal(o.store.getState().conflict.reason, "CURRENT_CLIENT_REQUIRED", "Refusal survives restart");
		assert.equal(requests.length, 0, "Known refusal does not retry on reopen");
		await o.store.getState().resolveConflict("use-theirs");
		assert.equal(o.store.getState().conflict, null);
		assert.equal(
			kind === "resume" ? o.store.getState().data.summary.content : o.store.getState().data.content,
			proposal.before,
		);
		assert.equal(storage.size, 0);
		await o.store.getState().close();

		// Where the server takes it, what's typed next is this app's own.
		setup(kind);
		storage.clear();
		older();
		o = owner();
		const s = o.store.getState;
		await s().open(kind);
		assert.equal("proposalSafety" in requests[0].input, false);
		s().update(
			(draft) => {
				if (kind === "resume") draft.summary.content = "<p>Typed after updating</p>";
				else draft.content = "<p>Typed after updating</p>";
			},
			{ newStep: true },
		);
		await s().flush();
		assert.equal(requests.at(-1).input.proposalSafety, "v1");
		await s().close();

		// This app's own draft keeps its mark across a restart.
		setup(kind);
		storage.clear();
		older({ proposalSafety: "v1" });
		o = owner();
		await o.store.getState().open(kind);
		assert.equal(requests[0].input.proposalSafety, "v1");
		await o.store.getState().close();
	});
}

test("resume: its own Share write keeps Undo and confirmed decisions; the stream echo doesn't clear them (RX-161)", async () => {
	const { owner } = setup("resume");
	const o = owner();
	const s = o.store.getState;
	await s().open("resume");
	accept(s, "resume");
	await s().flush();
	assert.equal(s().canUndo, true);
	const confirmed = s().proposalApplications;
	assert.notDeepEqual(confirmed, {});
	await o.writeMetadata(async (baseline) => ({
		...baseline,
		...(await network("resume").update({ id: "resume", isPublic: true, expectedUpdatedAt: baseline.updatedAt })),
	}));
	assert.equal(s().document.isPublic, true);
	assert.equal(s().canUndo, true);
	assert.deepEqual(s().proposalApplications, confirmed);
	await o.refresh();
	assert.equal(s().canUndo, true, "The echo of this app's own revision is not someone else's");
	assert.deepEqual(s().proposalApplications, confirmed);
	// Content saved after it builds on the Share revision instead of conflicting with it.
	s().update((d) => void (d.basics.headline = "After share"), { newStep: true });
	await s().flush();
	assert.equal(s().status, "saved");
	assert.equal(documents.resume.data.basics.headline, "After share");
	assert.equal(documents.resume.isPublic, true);
});

test("resume: a Share write after a revision from elsewhere fails its version check and keeps the draft (RX-161)", async () => {
	const { owner } = setup("resume");
	const o = owner();
	const s = o.store.getState;
	await s().open("resume");
	accept(s, "resume");
	await s().flush();
	documents.resume = { ...documents.resume, updatedAt: new Date(documents.resume.updatedAt.getTime() + 5) };
	await assert.rejects(
		o.writeMetadata(async (baseline) => ({
			...baseline,
			...(await network("resume").update({ id: "resume", isPublic: true, expectedUpdatedAt: baseline.updatedAt })),
		})),
	);
	assert.equal(s().document.isPublic, false);
	// The foreign revision still reaches the draft the usual way, and clears what it can't vouch for.
	await o.refresh();
	assert.equal(s().canUndo, false);
	assert.deepEqual(s().proposalApplications, {});
});
