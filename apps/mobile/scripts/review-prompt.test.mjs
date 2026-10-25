// Exercise the real hook with a virtual clock and native/store boundaries.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const code = transformSync(
	readFileSync(new URL("../src/features/reviews/use-review-prompt.ts", import.meta.url), "utf8"),
	{
		loader: "ts",
		format: "cjs",
	},
).code;

const minute = 60_000;
const day = 24 * 60 * minute;
const epoch = Date.UTC(2026, 9, 25);
const settle = async () => {
	for (let index = 0; index < 10; index++) await Promise.resolve();
};

function mount(context, stored = new Map()) {
	let ref;
	let deps;
	let cleanup;
	let pending;
	const events = new Map();
	const fixture = {
		status: "signed-in",
		scope: "account-a",
		path: "(tabs)/documents",
		platform: "ios",
		keyboard: false,
		available: async () => true,
		request: async () => {},
		read: (key) => stored.get(key) ?? null,
		write: (key, value) => stored.set(key, value),
		checks: 0,
		requests: 0,
	};
	const listen = (name, callback) => {
		events.set(name, callback);
		return { remove: () => events.delete(name) };
	};
	const appState = { currentState: "active", addEventListener: listen };
	const mocks = {
		react: {
			useRef: (initial) => (ref ??= { current: initial }),
			useEffect(effect, nextDeps) {
				if (!deps || nextDeps.some((value, index) => value !== deps[index])) {
					deps = nextDeps;
					pending = effect;
				}
			},
		},
		"expo-router": { useSegments: () => fixture.path.split("/") },
		"expo-sqlite/kv-store": {
			getItemSync: (key) => fixture.read(key),
			setItemSync: (key, value) => fixture.write(key, value),
		},
		"expo-store-review": {
			isAvailableAsync: () => {
				fixture.checks++;
				return fixture.available();
			},
			requestReview: () => {
				fixture.requests++;
				return fixture.request();
			},
		},
		"react-native": {
			AppState: appState,
			Keyboard: { isVisible: () => fixture.keyboard, addListener: listen },
			Platform: {
				get OS() {
					return fixture.platform;
				},
			},
		},
		"@/auth/session": {
			useSession: () => ({ status: fixture.status }),
			getAccountScope: () => (fixture.status === "signed-in" ? fixture.scope : null),
		},
	};
	const module = { exports: {} };
	new Function("require", "module", "exports", code)(
		(name) => {
			assert.ok(name in mocks, `Missing boundary fixture: ${name}`);
			return mocks[name];
		},
		module,
		module.exports,
	);
	fixture.render = (changes = {}) => {
		Object.assign(fixture, changes);
		module.exports.useReviewPrompt();
		if (pending) {
			cleanup?.();
			cleanup = pending();
			pending = undefined;
		}
	};
	fixture.state = (value) => {
		appState.currentState = value;
		events.get("change")?.(value);
	};
	fixture.hideKeyboard = () => {
		fixture.keyboard = false;
		events.get("keyboardDidHide")?.();
	};
	fixture.unmount = () => {
		cleanup?.();
		cleanup = undefined;
	};
	context.after(fixture.unmount);
	return fixture;
}

const clock = (context) => context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: epoch });

test("both platforms wait five minutes and persist a three-day cooldown across restarts and accounts", async (context) => {
	for (const platform of ["ios", "android"]) {
		await context.test(platform, async (context) => {
			clock(context);
			const stored = new Map();
			const first = mount(context, stored);
			first.render({ platform });
			context.mock.timers.tick(5 * minute - 1);
			await settle();
			assert.equal(first.requests, 0);
			context.mock.timers.tick(1);
			await settle();
			assert.equal(first.requests, 1);
			assert.deepEqual([...stored.values()], [String(epoch + 5 * minute + 3 * day)]);
			first.unmount();

			const reopened = mount(context, stored);
			reopened.render({ scope: "account-b", platform });
			context.mock.timers.tick(3 * day - 1);
			await settle();
			assert.equal(reopened.requests, 0);
			context.mock.timers.tick(1);
			await settle();
			assert.equal(reopened.requests, 1);
		});
	}
});

test("background time does not count, and foreground time resumes where it stopped", async (context) => {
	clock(context);
	const app = mount(context);
	app.render();
	context.mock.timers.tick(2 * minute);
	app.state("background");
	context.mock.timers.tick(day);
	await settle();
	assert.equal(app.checks, 0);
	app.state("active");
	context.mock.timers.tick(3 * minute - 1);
	await settle();
	assert.equal(app.requests, 0);
	context.mock.timers.tick(1);
	await settle();
	assert.equal(app.requests, 1);
});

test("editing and typing defer a due prompt until a main tab has its keyboard hidden", async (context) => {
	clock(context);
	const app = mount(context);
	app.render();
	context.mock.timers.tick(2 * minute);
	app.render({ path: "builder/[id]/write" });
	context.mock.timers.tick(4 * minute);
	await settle();
	assert.equal(app.checks, 0);
	app.render({ path: "(tabs)/documents", keyboard: true });
	context.mock.timers.tick(minute);
	await settle();
	assert.equal(app.checks, 0);
	app.hideKeyboard();
	context.mock.timers.tick(1);
	await settle();
	assert.equal(app.requests, 1);
});

test("signed-out, expired, and web sessions cannot prompt; switching accounts restarts the wait", async (context) => {
	clock(context);
	for (const changes of [{ status: "signed-out" }, { status: "expired" }, { platform: "web" }]) {
		const app = mount(context);
		app.render(changes);
		context.mock.timers.tick(10 * minute);
		await settle();
		assert.equal(app.checks, 0);
		app.unmount();
	}
	const app = mount(context);
	app.render();
	context.mock.timers.tick(4 * minute);
	app.render({ scope: "account-b" });
	context.mock.timers.tick(4 * minute);
	await settle();
	assert.equal(app.requests, 0);
	context.mock.timers.tick(minute);
	await settle();
	assert.equal(app.requests, 1);
});

test("an availability check cannot open a prompt after sign-out, navigation, or backgrounding", async (context) => {
	clock(context);
	for (const leave of [
		(app) => app.render({ status: "signed-out" }),
		(app) => app.render({ path: "new" }),
		(app) => app.state("background"),
	]) {
		const stored = new Map();
		const app = mount(context, stored);
		let resolve;
		app.available = () =>
			new Promise((done) => {
				resolve = done;
			});
		app.render();
		context.mock.timers.tick(5 * minute);
		assert.equal(app.checks, 1);
		leave(app);
		resolve(true);
		await settle();
		assert.equal(app.requests, 0);
		assert.equal(stored.size, 0);
		app.unmount();
	}
});

test("unavailable stores and failed native or storage operations remain silent", async (context) => {
	clock(context);
	for (const failure of ["unavailable", "availability", "request", "read", "write"]) {
		const stored = new Map();
		const app = mount(context, stored);
		if (failure === "unavailable") app.available = async () => false;
		if (failure === "availability")
			app.available = async () => {
				throw new Error("unavailable");
			};
		if (failure === "request")
			app.request = async () => {
				throw new Error("store failed");
			};
		if (failure === "read")
			app.read = () => {
				throw new Error("disk failed");
			};
		if (failure === "write")
			app.write = () => {
				throw new Error("disk failed");
			};
		app.render();
		context.mock.timers.tick(5 * minute);
		await settle();
		assert.equal(app.requests, failure === "request" ? 1 : 0);
		assert.equal(stored.size, failure === "request" ? 1 : 0);
		app.unmount();
	}
});
