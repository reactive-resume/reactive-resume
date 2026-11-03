// Host lifecycle/SDK-boundary proof; native worklet execution and gesture feel need device QA.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const server = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(server.resolve("tsx"))("esbuild");
let owner;
const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
const react = {
	createElement: (type, props) => ({ type, props }),
	useRef(value) {
		const index = owner.cursor++;
		return (owner.hooks[index] ??= { current: value });
	},
	useState(initial) {
		const current = owner;
		const index = current.cursor++;
		if (!(index in current.hooks)) current.hooks[index] = typeof initial === "function" ? initial() : initial;
		return [
			current.hooks[index],
			(value) => {
				current.hooks[index] = typeof value === "function" ? value(current.hooks[index]) : value;
			},
		];
	},
	useMemo(make, deps) {
		const index = owner.cursor++;
		if (!same(owner.hooks[index]?.deps, deps)) owner.hooks[index] = { deps, value: make() };
		return owner.hooks[index].value;
	},
	useCallback(fn, deps) {
		return react.useMemo(() => fn, deps);
	},
	useEffect(effect, deps) {
		const current = owner;
		const index = current.cursor++;
		const previous = current.hooks[index];
		if (!same(previous?.deps, deps))
			current.effects.push(() => {
				previous?.cleanup?.();
				current.hooks[index] = { deps, cleanup: effect() };
			});
	},
};
react.useLayoutEffect = react.useEffect;
function mount(render, props) {
	const instance = { hooks: [], effects: [], cursor: 0, props };
	instance.render = (next = instance.props) => {
		instance.props = next;
		instance.cursor = 0;
		owner = instance;
		instance.value = render(next);
		for (const effect of instance.effects.splice(0)) effect();
		return instance.value;
	};
	instance.render();
	return instance;
}
function load(path, mocks) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"), {
		loader: path.endsWith(".tsx") ? "tsx" : "ts",
		format: "cjs",
		jsx: "transform",
	}).code;
	new Function("React", "require", "module", "exports", code)(
		react,
		(name) => {
			assert.ok(name in mocks, `Missing native boundary: ${name}`);
			return mocks[name];
		},
		module,
		module.exports,
	);
	return module.exports;
}
const tick = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

function fixture(reduced = false) {
	let blur;
	const handlers = new Set();
	const app = {
		currentState: "active",
		addEventListener: (_event, handler) => {
			handlers.add(handler);
			return { remove: () => handlers.delete(handler) };
		},
	};
	const animations = [];
	const shared = (initial) => {
		const ref = react.useRef();
		return (ref.current ??= {
			value: initial,
			get() {
				return this.value;
			},
			set(value) {
				if (value?.timing) {
					this.animation = value;
					animations.push({
						...value,
						finish: () => {
							this.value = value.value;
							value.done?.(true);
						},
					});
				} else this.value = value;
			},
		});
	};
	const native = load("features/documents/removal-motion.tsx", {
		react,
		"expo-router": {
			useFocusEffect: (callback) =>
				react.useEffect(() => {
					blur = callback();
					return blur;
				}, [callback]),
		},
		"react-native": { AppState: app },
		"react-native-reanimated": {
			default: { View: "Animated.View" },
			ReduceMotion: { Never: "never", System: "system" },
			useSharedValue: shared,
			useAnimatedStyle: (read) => ({ read }),
			withTiming: (value, config, done) => ({ timing: true, value, config, done }),
			cancelAnimation: (value) => {
				value.animation?.done?.(false);
				value.animation = null;
			},
		},
		"react-native-worklets": { scheduleOnRN: (fn) => fn() },
		"@/ui/motion": { useReducedMotion: () => reduced },
		"@/ui/tokens": { motion: { d1: 120, d2: 200 } },
	});
	const collection = mount(({ scope }) => native.useDocumentRemovalMotion(scope, false, null, false), {
		scope: "account/library",
	});
	const frame = mount(native.DocumentMotionFrame, { itemKey: "resume:one", register: collection.value.register });
	const writes = [];
	let refreshes = 0;
	const api = load("features/documents/queries.ts", {
		react,
		"@lingui/core/macro": {
			t: (parts, ...values) => parts.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
			plural: (n, options) => options[n === 1 ? "one" : "other"].replace("#", n),
		},
		"@orpc/client": { ORPCError: class extends Error {} },
		"@tanstack/react-query": {
			useQueryClient: () => ({
				invalidateQueries: async () => {
					refreshes++;
				},
			}),
		},
		"expo-network": { getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }) },
		"@reactive-resume/schema/applications/errors": {},
		"./filter": { documentRef: ({ type, id }) => ({ type, id }) },
		"@/api/client": {
			client: {
				documents: {
					trash: async ({ id }) => {
						if (id === "failed") throw new Error("offline");
						writes.push(id);
					},
				},
			},
			orpc: Object.fromEntries(
				["documents", "resume", "coverLetters", "applications"].map((key) => [key, { key: () => [key] }]),
			),
		},
		"@/auth/session": { useSession: () => ({ status: "signed-in", server: "local" }), getServer: () => "local" },
		"@/lib/undone": {},
		"@/ui": { showToast() {} },
	});
	const operations = mount(() => api.useDocumentOperations(true, collection.value.onEffect)).value;
	return {
		blur: () => blur?.(),
		collection,
		frame,
		operations,
		animations,
		writes,
		get refreshes() {
			return refreshes;
		},
		background() {
			app.currentState = "background";
			for (const handler of handlers) handler("background");
		},
	};
}

for (const cancellation of ["scope", "background", "navigation"])
	test(`native ${cancellation} cancellation releases accepted removal and refreshes`, async () => {
		const f = fixture();
		const pending = f.operations.trash([{ type: "resume", id: "one", isLocked: false }]);
		await tick();
		assert.deepEqual(f.writes, ["one"]);
		assert.equal(f.refreshes, 0, "refetch waits for the visible removal");
		assert.equal(f.animations.length, 2);
		if (cancellation === "scope") f.collection.render({ scope: "other-filter" });
		else if (cancellation === "background") f.background();
		else f.blur();
		assert.equal(await pending, true);
		assert.equal(f.refreshes, 4);
		assert.equal(f.frame.value.props.style.at(-1).read().opacity, 1);
	});

test("native reduced removal animates opacity alone; failed writes never animate", async () => {
	const f = fixture(true);
	assert.equal(await f.operations.trash([{ type: "resume", id: "failed", isLocked: false }]), false);
	assert.equal(f.animations.length, 0);
	const before = f.refreshes;
	const pending = f.operations.trash([{ type: "resume", id: "one", isLocked: false }]);
	await tick();
	assert.equal(f.refreshes, before);
	assert.equal(f.animations.length, 1);
	assert.equal(f.animations[0].value, 0);
	assert.deepEqual(f.animations[0].config, { duration: 120, reduceMotion: "never" });
	f.animations[0].finish();
	assert.equal(await pending, true);
	assert.equal(f.refreshes, before + 4);
});

test("native animation failure cannot report an accepted write as failed", async () => {
	const f = fixture();
	f.collection.value.register("resume:one", {
		fade: () => {
			throw new Error("animation unavailable");
		},
		reset() {},
	});
	assert.equal(await f.operations.trash([{ type: "resume", id: "one", isLocked: false }]), true);
	assert.deepEqual(f.writes, ["one"]);
	assert.equal(f.refreshes, 4);
});
