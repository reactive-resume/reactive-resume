// Drives the shipped Messages Apply handler, Undo, account dispatch and shared tracker at their module boundaries.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const MOBILE = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const mobileRequire = createRequire(MOBILE + "/package.json");
const serverRequire = createRequire(MOBILE + "/../server/package.json");
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const schemaRequire = createRequire(MOBILE + "/../../packages/schema/package.json");
const { QueryClient } = mobileRequire("@tanstack/react-query");
const { ORPCError } = await import("@orpc/client");
const zod = schemaRequire("zod");

const source = (file) => readFileSync(file, "utf8");

function load(file, mocks = {}, append = "") {
	const module = { exports: {} };
	const code = transformSync(source(file), {
		loader: file.endsWith(".tsx") ? "tsx" : "ts",
		format: "cjs",
		jsx: "automatic",
	}).code;
	new Function("require", "module", "exports", code + append)(
		(name) => {
			assert.ok(name in mocks, "Missing boundary: " + name);
			return mocks[name];
		},
		module,
		module.exports,
	);
	return module.exports;
}

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

function harness({ lifetime = 30 } = {}) {
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
	};
	const undo = load(MOBILE + "/src/features/career/undo.ts", {
		"@lingui/core/macro": { t: tag },
		"react-native": { AppState: { addEventListener: () => ({ remove() {} }) } },
		"@/ui": {
			dismissToast: () => {},
			showToast: (toast) => (toasts.push(toast), toasts.length),
			toastLifetime: () => lifetime,
		},
	});
	const queryClient = new QueryClient();
	const listedRow = {
		id: "app-1",
		status: "applied",
		laneId: "lane-applied",
		closedReason: null,
		activity: [{ id: "e1", type: "stage", at: "2026-11-01T12:00:00.000Z", writeSequence: 1 }],
	};
	const jsx = (type, props) => ({ type, props });
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
				useState: (init) => [typeof init === "function" ? init() : init, () => {}],
				useRef: (value) => ({ current: value }),
				useEffect: () => {},
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
				useDraft: (_key, value) => ({ value }),
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
					applications: { logReply: async (...args) => env.logs.push(args) },
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
				useInvalidateApplications: () => async () => {},
			},
			"@/features/applications/stage-actions": {
				listedApplication: () => listedRow,
				offerHintFor: () => undefined,
				useOfferHints: () => ({}),
			},
			"@/features/career/offer-compare": { formatMoney: String },
			"@/features/career/offer-entry": { OfferEntry: "OfferEntry" },
			"@/features/reminders": {},
			"@/features/career/undo": undo,
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
		updatedAt: new Date(0),
	};
	const replyTree = () => messages.ReplyCard({ reply, application, readOnly: false });
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
	return { env, press, bulkStart, undoToast, toasts, replyTree };
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
	assert.match(JSON.stringify(tree), /Replace these placeholders before sending/);
	buttonIn(tree, "Copy reply").props.onPress();
	await new Promise(setImmediate);
	assert.deepEqual(h.env.copied, ["Available [Datum und Uhrzeit 1] or [slot 2]."]);
	assert.equal(h.env.logs.length, 0);
	buttonIn(tree, "Copy and log as replied").props.onPress();
	await new Promise(setImmediate);
	assert.deepEqual(h.env.logs, [
		[
			{ id: "app-1", expectedVersion: '["1970-01-01T00:00:00.000Z","applied",null,null,null,false]' },
			{ context: { scope: "acct-A" } },
		],
	]);
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

const pendingFor = (promise, ms = 200) =>
	Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve("still waiting"), ms))]);
const before = { status: "applied", laneId: "lane-applied", closedReason: null, stageEntryId: "e1" };
const savedStage = { status: "interview", laneId: "lane-interview", closedReason: null, stageEntryId: "e2" };

test("Immediate Apply, then a bulk move: the move waits and starts from the stage the server saved", async () => {
	const h = harness({ lifetime: 60 });
	let answer;
	h.env.applyReply = () => new Promise((resolve) => (answer = resolve));
	h.press();
	const start = h.bulkStart();
	assert.equal(await pendingFor(start, 20), "still waiting");
	await new Promise((resolve) => setTimeout(resolve, 120));
	assert.equal(h.env.applyCalls, 1);
	assert.equal(await pendingFor(start, 20), "still waiting");
	answer({ stages: [{ id: "app-1", ...savedStage }] });
	assert.deepEqual(await pendingFor(start), savedStage);
});

test("Undo after immediate Apply: a bulk move waits for the inverse and starts from its saved stage", async () => {
	const h = harness();
	h.env.applyReply = async () => ({ stages: [{ id: "app-1", ...savedStage }] });
	h.press();
	await new Promise(setImmediate);
	assert.equal(h.env.applyCalls, 1);
	let answer;
	h.env.undoReply = () => new Promise((resolve) => (answer = resolve));
	h.undoToast().action.onPress();
	const start = h.bulkStart();
	assert.equal(await pendingFor(start, 20), "still waiting");
	assert.equal(h.env.undoCalls, 1);
	answer({ stages: [{ id: "app-1", ...before, stageEntryId: "e3" }] });
	assert.deepEqual(await pendingFor(start), { ...before, stageEntryId: "e3" });
});

test("Undo refuses dispatch after switching accounts", async () => {
	const h = harness();
	h.env.applyReply = async () => ({ stages: [{ id: "app-1", ...savedStage }] });
	h.press();
	await new Promise(setImmediate);
	h.env.account = "acct-B";
	h.undoToast().action.onPress();
	await new Promise(setImmediate);
	assert.equal(h.env.undoCalls, 0);
});

test("Failed apply: the bulk move starts from the stage before", async () => {
	const h = harness({ lifetime: 10 });
	h.env.applyReply = async () => {
		throw new Error("offline");
	};
	h.press();
	const start = h.bulkStart();
	assert.deepEqual(await pendingFor(start), before);
	assert.equal(h.env.applyCalls, 1);
});

test("Account switched before dispatch: nothing sent, the old account's bulk start settles", async () => {
	const h = harness({ lifetime: 30 });
	h.press();
	const start = h.bulkStart();
	h.env.account = "acct-B";
	assert.deepEqual(await pendingFor(start), before);
	assert.equal(h.env.applyCalls, 0);
});

test("Old server (no stages in the answer): the bulk move starts from the stage before", async () => {
	const h = harness({ lifetime: 10 });
	h.env.applyReply = async () => undefined;
	h.press();
	assert.deepEqual(await pendingFor(h.bulkStart()), before);
	assert.equal(h.env.applyCalls, 1);
});

test("answered reply before the list reloads: dated history still follows the saved stage", async () => {
	const h = harness({ lifetime: 10 });
	h.env.applyReply = async () => ({ stages: [{ id: "app-1", ...savedStage }] });
	h.press();
	await new Promise((resolve) => setTimeout(resolve, 50));
	assert.equal(h.env.applyCalls, 1);
	assert.deepEqual(await pendingFor(h.bulkStart()), savedStage);
});
