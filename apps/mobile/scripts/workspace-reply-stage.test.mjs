// Drives the shipped Messages Apply handler, Undo, account dispatch and shared tracker at their module boundaries.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { load as loadSource, mobileRequire } from "./harness.mjs";

const MOBILE = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schemaRequire = createRequire(MOBILE + "/../../packages/schema/package.json");
const { QueryClient } = mobileRequire("@tanstack/react-query");
const { ORPCError } = await import("@orpc/client");
const zod = schemaRequire("zod");

const load = (file, mocks = {}, append = "") => loadSource(file, mocks, { append });

const data = load(MOBILE + "/../../packages/schema/src/applications/data.ts", {
	zod,
	"@reactive-resume/utils/timezone": { timezoneSchema: zod.z.string() },
});
const tracker = load(MOBILE + "/../../packages/schema/src/applications/stage-baselines.ts", { "./data": data });
const replyFields = load(MOBILE + "/../../packages/schema/src/applications/reply.ts", {
	"./data": data,
	"./follow-up": { isDateOnlyFollowUp: (row) => row.followUpDateOnly ?? false },
});
const state = load(MOBILE + "/src/features/workspace/state.ts", {});

const tag = (strings, ...values) =>
	Array.isArray(strings)
		? strings.reduce((out, part, i) => out + part + (i < values.length ? values[i] : ""), "")
		: String(strings);

function harness() {
	const toasts = [];
	const env = {
		account: "acct-A",
		applyReply: async () => undefined,
		applyCalls: 0,
		undoReply: async () => undefined,
		undoCalls: 0,
		copy: async () => true,
		copied: [],
		logs: [],
		logReply: async () => undefined,
		getById: async () => ({ followUpAt: null }),
		reads: [],
		draft: undefined,
		invalidations: 0,
		invalidate: async () => undefined,
		cancel: async () => undefined,
		cancelCalls: [],
		reminderVersion: 0,
		effects: [],
		clearedReminders: [],
	};
	const queryClient = new QueryClient();
	const listedRow = {
		id: "app-1",
		status: "applied",
		laneId: "lane-applied",
		closedReason: null,
		activity: [{ id: "e1", type: "stage", at: "2026-11-01T12:00:00.000Z", writeSequence: 1 }],
	};
	const jsx = (type, props) => ({ type, props });
	const hooks = [];
	let cursor = 0;
	let renderingReply = false;
	let mounted = true;
	const hook = (initial) => {
		if (!renderingReply) return initial();
		const index = cursor++;
		return (hooks[index] ??= initial());
	};
	const messages = load(
		MOBILE + "/src/features/workspace/tabs/messages.tsx",
		{
			"@lingui/core/macro": { plural: (n, forms) => forms.other.replace("#", String(n)) },
			"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { locale: "en-US" } }) },
			"@tanstack/react-query": { useQueryClient: () => queryClient },
			"@orpc/client": { ORPCError },
			"expo-clipboard": { setStringAsync: (text) => (env.copied.push(text), env.copy()) },
			"expo-router": { useLocalSearchParams: () => ({}), useRouter: () => ({}) },
			react: {
				useState: (init) => {
					const cell = hook(() => ({ value: typeof init === "function" ? init() : init }));
					return [
						cell.value,
						(value) => {
							if (!mounted) return;
							cell.value = typeof value === "function" ? value(cell.value) : value;
						},
					];
				},
				useRef: (value) => hook(() => ({ current: value })),
				useEffect: (effect, dependencies) => {
					const cell = hook(() => ({}));
					if (!cell.dependencies || dependencies.some((value, index) => !Object.is(value, cell.dependencies[index]))) {
						cell.dependencies = dependencies;
						env.effects.push(() => {
							cell.cleanup?.();
							cell.cleanup = effect();
						});
					}
				},
				useEffectEvent: (effect) => {
					const cell = hook(() => ({ current: effect }));
					cell.current = effect;
					return (cell.event ??= (...args) => cell.current(...args));
				},
				useSyncExternalStore: (_subscribe, get) => get(),
			},
			"react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
			"react-native": { View: "View" },
			"@reactive-resume/schema/applications/stage-baselines": tracker,
			"@reactive-resume/schema/applications/reply": replyFields,
			"@reactive-resume/schema/career-offer": {},
			"@reactive-resume/utils/timezone": {},
			"../hooks": {
				useWorkspace: () => ({ data: { answers: [] }, current: () => ({ answers: [] }) }),
				useDraft: (_key, value) => ({ value: env.draft ?? value }),
				useGenerate: () => ({}),
			},
			"../logic": {
				needsSubmission: () => false,
				isFixedChange: () => false,
				openChanges: (changes) => changes.map((_, index) => index),
			},
			"../parts": { AiNotice: "AiNotice", Block: "Block", CheckRow: "CheckRow", Pill: "Pill", SaveError: "SaveError" },
			"../shell": { WorkspaceScreen: "WorkspaceScreen" },
			"../state": state,
			"@/api/client": {
				client: {
					applications: {
						getById: async (...args) => {
							env.reads.push(args);
							return env.getById(...args);
						},
						logReply: async (...args) => {
							env.logs.push(args);
							return env.logReply(...args);
						},
					},
					career: {
						undoReply: (input) => {
							env.undoCalls += 1;
							return env.undoReply(input);
						},
						applyReply: (input) => {
							env.applyCalls += 1;
							return env.applyReply(input);
						},
					},
				},
				orpc: { career: { savedItems: { key: () => ["savedItems"] }, schedules: { key: () => ["schedules"] } } },
			},
			"@/auth/session": { useSession: () => ({ server: "srv" }), getAccountScope: () => env.account },
			"@/draft": { getDraftScope: async () => env.account },
			"@/features/ai/providers": { useHasAIProvider: () => ({}) },
			"@/features/application-detail/hooks": { useUserTime: () => ({ when: String, day: String, timeZone: "UTC" }) },
			"@/features/applications/lane-queries": { useApplicationLanes: () => ({ lanes: [] }) },
			"@/features/applications/lanes": { getLaneLabel: () => "Stage", resolveLane: () => ({}) },
			"@/features/applications/next-step": { describeNextStep: () => ({ title: "x" }), getNextStep: () => null },
			"@/features/applications/queries": {
				stageScope: () => "srv:" + env.account,
				useInvalidateApplications: () => async () => {
					env.invalidations++;
					await env.invalidate();
				},
			},
			"@/features/applications/stage-actions": {
				listedApplication: () => listedRow,
				offerHintFor: () => undefined,
				useOfferHints: () => ({}),
			},
			"@/features/career/offer-compare": { formatMoney: String },
			"@/features/career/offer-entry": { OfferEntry: "OfferEntry" },
			"@/features/reminders": {
				useReminders: () => ({
					captureTurnOff: (target) => {
						const version = env.reminderVersion;
						return async () => {
							if (version !== env.reminderVersion) return;
							env.cancelCalls.push(target);
							await env.cancel();
							env.clearedReminders.push(target);
						};
					},
					turnOff: async (target) => {
						env.cancelCalls.push(target);
						await env.cancel();
						env.clearedReminders.push(target);
					},
				}),
			},
			"@/ui": {
				Banner: "Banner",
				Button: "Button",
				Icon: "Icon",
				Skeleton: "Skeleton",
				Text: "Text",
				TextArea: "TextArea",
				showToast: (toast) => (toasts.push(toast), toasts.length),
				useTheme: () => ({ space: {}, colors: {} }),
			},
		},
		";module.exports.ProposalCard = ProposalCard; module.exports.ReplyCard = ReplyCard;",
	);
	const reply = {
		id: "reply-" + Math.random().toString(36).slice(2),
		data: {
			title: "Reply",
			reply: "Available [Datum und Uhrzeit 1] or [slot 2].",
			asks: [],
			changes: [{ type: "stage", stage: "interview" }],
			applied: null,
			unconfirmed: [],
			offer: null,
		},
	};
	const application = {
		id: "app-1",
		status: "applied",
		contacts: [],
		activity: [],
		followUpAt: null,
		followUpNote: null,
		replyVersion: "review-token",
		updatedAt: new Date(0),
	};
	const flushEffects = () => {
		for (const effect of env.effects.splice(0)) effect();
	};
	const replyTree = (flush = true) => {
		assert.ok(mounted, "Cannot render an unmounted reply card");
		cursor = 0;
		renderingReply = true;
		let tree;
		try {
			tree = messages.ReplyCard({ reply, application, readOnly: false });
		} finally {
			renderingReply = false;
		}
		if (flush) flushEffects();
		return tree;
	};
	const press = () => {
		const tree = messages.ProposalCard({ reply, application, now: new Date(), readOnly: false });
		const find = (node) => {
			if (!node || typeof node !== "object") return undefined;
			if (Array.isArray(node)) return node.map(find).find(Boolean);
			if (node.type === "Button" && /Apply/.test(node.props.label)) return node;
			return find(node.props?.children);
		};
		const button = find(tree);
		assert.ok(button, "Apply button rendered");
		button.props.onPress();
	};
	// A bulk move of the row chosen from the list now (as `useMoveWithUndo` does): its start.
	const bulkStart = () => {
		const { baselines } = tracker
			.stageBaselinesFor(queryClient)
			.begin("srv:" + env.account, new Map([["app-1", listedRow]]));
		return baselines.get("app-1");
	};
	const undoToast = () => toasts.find((toast) => toast.action?.label === "Undo");
	const unmount = () => {
		mounted = false;
		env.effects.length = 0;
		for (const cell of hooks) cell.cleanup?.();
	};
	return { env, press, bulkStart, undoToast, toasts, replyTree, application, flushEffects, unmount };
}

function buttonIn(node, label) {
	if (!node || typeof node !== "object") return undefined;
	if (Array.isArray(node)) return node.map((item) => buttonIn(item, label)).find(Boolean);
	if (node.type === "Button" && node.props.label === label) return node;
	return buttonIn(node.props?.children, label);
}

test("native reply copies placeholders normally; explicit logging binds the reviewed revision and account", async () => {
	const h = harness();
	const tree = h.replyTree();
	buttonIn(tree, "Copy reply").props.onPress();
	await new Promise(setImmediate);
	assert.deepEqual(h.env.copied, ["Available [Datum und Uhrzeit 1] or [slot 2]."]);
	assert.equal(h.env.logs.length, 0);
	buttonIn(tree, "Copy and log as replied").props.onPress();
	await new Promise(setImmediate);
	assert.deepEqual(h.env.logs, [[{ id: "app-1", expectedVersion: "review-token" }, { context: { scope: "acct-A" } }]]);
});

test("native reply does not log clipboard failure or a stale account, and ignores duplicate presses", async () => {
	const h = harness();
	const action = buttonIn(h.replyTree(), "Copy and log as replied");
	h.env.copy = async () => false;
	action.props.onPress();
	await new Promise(setImmediate);
	assert.equal(h.env.logs.length, 0);
	let resolveCopy;
	h.env.copy = () => new Promise((resolve) => (resolveCopy = resolve));
	action.props.onPress();
	action.props.onPress();
	assert.equal(h.env.copied.length, 2);
	h.env.account = "acct-B";
	resolveCopy(true);
	await new Promise(setImmediate);
	assert.equal(h.env.logs.length, 0);
});

for (const [failure, error, message] of [
	[
		"uncertain",
		new Error("Lost response"),
		"Reply copied. Logging wasn't confirmed. Check the timeline before trying again.",
	],
	[
		"conflict",
		new ORPCError("CONFLICT"),
		"Reply copied. Nothing was logged because the application changed. Review it again before logging.",
	],
	[
		"refused",
		new ORPCError("BAD_REQUEST"),
		"Reply copied. Nothing was logged. Review the application before logging again.",
	],
]) {
	test(`native copied reply with ${failure} logging claims no log, refreshes and keeps the reminder`, async () => {
		const h = harness();
		h.application.followUpAt = new Date("2030-03-15T09:00:00Z");
		h.env.logReply = async () => {
			throw error;
		};
		buttonIn(h.replyTree(), "Copy and log as replied").props.onPress();
		await new Promise(setImmediate);
		assert.deepEqual(h.env.copied, ["Available [Datum und Uhrzeit 1] or [slot 2]."]);
		assert.equal(h.env.logs.length, 1);
		assert.equal(h.env.invalidations, 1);
		assert.equal(h.toasts.at(-1).message, message);
		assert.deepEqual(h.env.cancelCalls, []);
	});
}

test("native blank reply cannot be logged while ordinary Copy still works", async () => {
	const h = harness();
	h.application.followUpAt = new Date("2030-03-15T09:00:00Z");
	h.env.draft = " \n\t";
	const tree = h.replyTree();
	buttonIn(tree, "Copy and log as replied").props.onPress();
	await new Promise(setImmediate);
	assert.deepEqual(h.env.copied, []);
	assert.deepEqual(h.env.logs, []);
	buttonIn(tree, "Copy reply").props.onPress();
	await new Promise(setImmediate);
	assert.deepEqual(h.env.copied, [" \n\t"]);
	assert.deepEqual(h.env.cancelCalls, []);
});

test("native confirmed log stays confirmed if the later application refresh fails", async () => {
	const h = harness();
	h.application.followUpAt = new Date("2030-03-15T09:00:00Z");
	let refreshes = 0;
	h.env.invalidate = async () => {
		if (++refreshes === 1) throw new ORPCError("BAD_REQUEST");
	};
	buttonIn(h.replyTree(), "Copy and log as replied").props.onPress();
	await new Promise(setImmediate);
	assert.equal(h.env.logs.length, 1);
	assert.equal(h.env.clearedReminders.length, 1);
	assert.equal(h.toasts.at(-1).message, "Reply copied and logged as replied");
});

test("native cached cleared follow-up cannot cancel a server-confirmed replacement", async () => {
	const h = harness();
	h.env.getById = async () => ({ followUpAt: new Date("2030-03-15T09:00:00Z") });
	h.replyTree();
	await new Promise(setImmediate);
	assert.equal(h.env.reads.length, 1);
	assert.equal(h.env.reads[0][1].context.scope, "acct-A");
	assert.deepEqual(h.env.cancelCalls, []);
});

for (const change of ["read-failure", "unmount", "replacement", "account"]) {
	test(`native fresh cleared-follow-up check preserves reminder after ${change}`, async () => {
		const h = harness();
		let resolveRead;
		let rejectRead;
		h.env.getById = () =>
			new Promise((resolve, reject) => {
				resolveRead = resolve;
				rejectRead = reject;
			});
		h.replyTree();
		if (change === "read-failure") rejectRead(new Error("Offline"));
		else {
			if (change === "unmount") h.unmount();
			if (change === "replacement") h.env.reminderVersion++;
			if (change === "account") h.env.account = "acct-B";
			resolveRead({ followUpAt: null });
		}
		await new Promise(setImmediate);
		assert.deepEqual(h.env.cancelCalls, []);
	});
}

test("native reply view cancels only the cleared follow-up reminder and ignores a stale account effect", async () => {
	const h = harness();
	h.application.followUpAt = new Date("2030-03-15T09:00:00Z");
	h.replyTree();
	assert.deepEqual(h.env.clearedReminders, []);
	h.application.followUpAt = null;
	h.replyTree();
	await new Promise(setImmediate);
	assert.deepEqual(h.env.clearedReminders, [{ kind: "follow-up", applicationId: "app-1" }]);
	// Unchanged props must not rerun the cancellation effect.
	h.replyTree();
	assert.equal(h.env.clearedReminders.length, 1);
	h.application.followUpAt = new Date("2030-03-16T09:00:00Z");
	h.replyTree();
	h.application.followUpAt = null;
	h.replyTree(false);
	h.env.account = "acct-B";
	h.flushEffects();
	await new Promise(setImmediate);
	assert.equal(h.env.clearedReminders.length, 1);
});

test("native reply completion clears its reminder after the view unmounts", async () => {
	const h = harness();
	h.application.followUpAt = new Date("2030-03-15T09:00:00Z");
	let resolveLog;
	h.env.logReply = () =>
		new Promise((resolve) => {
			resolveLog = resolve;
		});
	buttonIn(h.replyTree(), "Copy and log as replied").props.onPress();
	await new Promise(setImmediate);
	h.unmount();
	resolveLog();
	await new Promise(setImmediate);
	assert.deepEqual(h.env.clearedReminders, [{ kind: "follow-up", applicationId: "app-1" }]);
	assert.equal(h.env.invalidations, 1);
});

for (const outcome of ["cancel", "replacement", "cancel-failure"]) {
	test(`native confirmed reply completes captured reminder cleanup after account switch (${outcome})`, async () => {
		const h = harness();
		h.application.followUpAt = new Date("2030-03-15T09:00:00Z");
		let finish;
		h.env.logReply = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		buttonIn(h.replyTree(), "Copy and log as replied").props.onPress();
		await new Promise(setImmediate);
		assert.equal(h.env.logs.length, 1);
		h.env.account = "acct-B";
		h.unmount();
		if (outcome === "replacement") h.env.reminderVersion++;
		if (outcome === "cancel-failure")
			h.env.cancel = async () => {
				throw new Error("Notification service unavailable");
			};
		finish();
		await new Promise(setImmediate);
		assert.equal(h.env.cancelCalls.length, outcome === "replacement" ? 0 : 1);
		assert.deepEqual(
			h.env.clearedReminders,
			outcome === "cancel" ? [{ kind: "follow-up", applicationId: "app-1" }] : [],
		);
		assert.equal(h.env.invalidations, 0);
		assert.deepEqual(h.toasts, []);
	});
}

test("native cancellation failure offers scoped retry without logging the reply twice", async () => {
	const h = harness();
	h.application.followUpAt = new Date("2030-03-15T09:00:00Z");
	let fail = true;
	h.env.cancel = async () => {
		if (fail) {
			fail = false;
			throw new Error("Notification service unavailable");
		}
	};
	h.env.invalidate = async () => {
		throw new Error("Refresh unavailable");
	};
	buttonIn(h.replyTree(), "Copy and log as replied").props.onPress();
	await new Promise(setImmediate);
	assert.equal(h.env.logs.length, 1);
	assert.equal(h.env.invalidations, 1);
	assert.equal(
		h.toasts.at(-1).message,
		"Reply copied and logged as replied. Couldn't clear the follow-up reminder. It may still notify you.",
	);
	h.toasts.at(-1).action.onPress();
	await new Promise(setImmediate);
	assert.equal(h.env.cancelCalls.length, 2);
	assert.equal(h.env.clearedReminders.length, 1);
	assert.equal(h.env.logs.length, 1);
});

test("native failed reminder Retry preserves a newer authored follow-up", async () => {
	const h = harness();
	h.application.followUpAt = new Date("2030-03-15T09:00:00Z");
	h.env.cancel = async () => {
		throw new Error("Unavailable");
	};
	buttonIn(h.replyTree(), "Copy and log as replied").props.onPress();
	await new Promise(setImmediate);
	const retry = h.toasts.at(-1).action;
	h.env.reminderVersion++;
	h.env.cancel = async () => {};
	retry.onPress();
	await new Promise(setImmediate);
	assert.equal(h.env.clearedReminders.length, 0);
	assert.equal(h.env.logs.length, 1);
});

test("native reminder Retry refuses dispatch after account replacement", async () => {
	const h = harness();
	h.application.followUpAt = new Date("2030-03-15T09:00:00Z");
	h.env.cancel = async () => {
		throw new Error("Notification service unavailable");
	};
	buttonIn(h.replyTree(), "Copy and log as replied").props.onPress();
	await new Promise(setImmediate);
	const retry = h.toasts.at(-1).action;
	h.env.account = "acct-B";
	retry.onPress();
	await new Promise(setImmediate);
	assert.equal(h.env.cancelCalls.length, 1);
	assert.equal(h.env.logs.length, 1);
});

test("native older-server reply keeps Copy and refuses explicit logging", async () => {
	const h = harness();
	delete h.application.replyVersion;
	const view = h.replyTree();
	buttonIn(view, "Copy and log as replied").props.onPress();
	await new Promise(setImmediate);
	assert.equal(h.env.logs.length, 0);
	buttonIn(view, "Copy reply").props.onPress();
	await new Promise(setImmediate);
	assert.equal(h.env.copied.length, 1);
	assert.equal(h.env.logs.length, 0);
});

test("native reply cannot show a success toast to an account replaced during invalidation", async () => {
	const h = harness();
	h.application.followUpAt = new Date("2030-03-15T09:00:00Z");
	let resolveInvalidation;
	h.env.invalidate = () =>
		new Promise((resolve) => {
			resolveInvalidation = resolve;
		});
	buttonIn(h.replyTree(), "Copy and log as replied").props.onPress();
	await new Promise(setImmediate);
	h.env.account = "acct-B";
	resolveInvalidation();
	await new Promise(setImmediate);
	assert.deepEqual(h.toasts, []);
});

const drain = () => new Promise((resolve) => setImmediate(resolve));
/** The promise's value once pending work has run, or "still waiting" when it hasn't settled. */
async function settled(promise) {
	let outcome = "still waiting";
	void promise.then((value) => (outcome = value));
	await drain();
	return outcome;
}
const before = { status: "applied", laneId: "lane-applied", closedReason: null, stageEntryId: "e1" };
const savedStage = { status: "interview", laneId: "lane-interview", closedReason: null, stageEntryId: "e2" };

test("Immediate Apply, then a bulk move: the move waits and starts from the stage the server saved", async () => {
	const h = harness();
	let answer;
	h.env.applyReply = () => new Promise((resolve) => (answer = resolve));
	h.press();
	const start = h.bulkStart();
	assert.equal(await settled(start), "still waiting");
	assert.equal(h.env.applyCalls, 1);
	answer({ stages: [{ id: "app-1", ...savedStage }] });
	assert.deepEqual(await settled(start), savedStage);
});

test("Undo after immediate Apply: a bulk move waits for the inverse and starts from its saved stage", async () => {
	const h = harness();
	h.env.applyReply = async () => ({ stages: [{ id: "app-1", ...savedStage }] });
	h.press();
	await drain();
	assert.equal(h.env.applyCalls, 1);
	let answer;
	h.env.undoReply = () => new Promise((resolve) => (answer = resolve));
	h.undoToast().action.onPress();
	const start = h.bulkStart();
	assert.equal(await settled(start), "still waiting");
	assert.equal(h.env.undoCalls, 1);
	answer({ stages: [{ id: "app-1", ...before, stageEntryId: "e3" }] });
	assert.deepEqual(await settled(start), { ...before, stageEntryId: "e3" });
});

test("Undo refuses dispatch after switching accounts", async () => {
	const h = harness();
	h.env.applyReply = async () => ({ stages: [{ id: "app-1", ...savedStage }] });
	h.press();
	await drain();
	h.env.account = "acct-B";
	h.undoToast().action.onPress();
	await drain();
	assert.equal(h.env.undoCalls, 0);
});

test("Failed apply: the bulk move starts from the stage before", async () => {
	const h = harness();
	h.env.applyReply = async () => {
		throw new Error("offline");
	};
	h.press();
	const start = h.bulkStart();
	assert.deepEqual(await settled(start), before);
	assert.equal(h.env.applyCalls, 1);
});

test("Account switched before dispatch: nothing sent, the old account's bulk start settles", async () => {
	const h = harness();
	h.press();
	const start = h.bulkStart();
	h.env.account = "acct-B";
	assert.deepEqual(await settled(start), before);
	assert.equal(h.env.applyCalls, 0);
});
