import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
const requireServer = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(requireServer.resolve("tsx"))("esbuild");
const { QueryClient } = createRequire(new URL("../package.json", import.meta.url))("@tanstack/react-query");
function load(path, mocks, timers) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
		loader: "ts",
		format: "cjs",
	}).code;
	new Function("require", "module", "exports", "setTimeout", "clearTimeout", code)(
		(name) => {
			assert.ok(name in mocks, name);
			return mocks[name];
		},
		module,
		module.exports,
		timers?.set,
		timers?.clear,
	);
	return module.exports;
}
const { prepareRequest } = load("../../../packages/utils/src/deferred-request.ts", {});
const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
};
function harness() {
	const notices = [];
	const pending = new Map();
	const listeners = new Set();
	let serial = 0;
	const env = { account: "alice", sent: 0, restored: 0, failures: 0, dismissed: 0 };
	const AppState = {
		currentState: "active",
		addEventListener: (_name, change) => {
			listeners.add(change);
			return { remove: () => listeners.delete(change) };
		},
	};
	const { withUndo } = load(
		"../src/features/career/undo.ts",
		{
			"@/auth/session": { getAccountScope: () => env.account },
			"@lingui/core/macro": { t: (parts) => parts.join("") },
			"react-native": { AppState },
			"@/ui": {
				showToast: (notice) => {
					notices.push(notice);
					return notices.length;
				},
				dismissToast: () => {
					env.dismissed++;
				},
				toastLifetime: (value) => value,
			},
		},
		{
			set: (run) => {
				const id = ++serial;
				pending.set(id, run);
				return id;
			},
			clear: (id) => pending.delete(id),
		},
	);
	const options = (preparing) => ({
		message: "Fact forgotten",
		prepare: () => preparing,
		onReady: () => {},
		commit: (result) => result,
		restore: () => {
			env.restored++;
		},
		failed: () => {
			env.failures++;
		},
	});
	const request = (body = Promise.resolve()) =>
		prepareRequest(async (defer) => {
			await body;
			return defer(() => {
				env.sent++;
				return Promise.resolve(new Response("erased"));
			});
		});
	return {
		env,
		notices,
		pending,
		listeners,
		withUndo,
		options,
		request,
		background: () => {
			AppState.currentState = "background";
			for (const listener of listeners) listener("background");
		},
	};
}

test("native Undo is acknowledged only after readiness and background dispatch is synchronous, once", async () => {
	const h = harness();
	const body = deferred();
	const preparing = h.request(body.promise);
	h.withUndo(h.options(preparing));
	assert.equal(h.notices.length, 0);
	assert.equal(h.env.sent, 0);
	body.resolve();
	const request = await preparing;
	assert.equal(h.notices.length, 1);
	h.background();
	assert.equal(h.env.sent, 1, "SDK transport starts before the background listener returns");
	h.background();
	await request.send();
	assert.equal(h.env.sent, 1);
	assert.equal(h.pending.size, 0);
	assert.equal(h.listeners.size, 0);
});

test("native Undo cancels before erasure and waits for canonical reconciliation", async () => {
	const h = harness();
	const canonical = deferred();
	const preparing = h.request();
	h.withUndo({
		...h.options(preparing),
		restore: async () => {
			await canonical.promise;
			h.env.restored++;
		},
	});
	const request = await preparing;
	h.notices[0].action.onPress();
	assert.equal(h.env.sent, 0);
	assert.equal(h.env.restored, 0);
	canonical.resolve();
	await canonical.promise;
	await Promise.resolve();
	assert.equal(h.env.restored, 1);
	await assert.rejects(request.send(), (error) => error.name === "AbortError");
});

test("navigation flush during preparation sends only after readiness and leaves no live notice", async () => {
	const h = harness();
	const body = deferred();
	const preparing = h.request(body.promise);
	const operation = h.withUndo(h.options(preparing));
	operation.flush();
	assert.equal(h.env.sent, 0);
	body.resolve();
	const request = await preparing;
	assert.equal(h.env.sent, 1);
	assert.equal(h.env.dismissed, 1);
	assert.equal(h.pending.size, 0);
	await request.send();
});

for (const when of ["before", "after"])
	test(`account switch ${when} readiness cannot send or reveal old state`, async () => {
		const h = harness();
		const body = deferred();
		const preparing = h.request(body.promise);
		h.withUndo(h.options(preparing));
		if (when === "before") h.env.account = "bob";
		body.resolve();
		const request = await preparing;
		if (when === "after") {
			h.env.account = "bob";
			h.background();
		}
		assert.equal(h.env.sent, 0);
		assert.equal(h.env.restored, 0);
		assert.equal(h.env.failures, 0);
		assert.equal(h.pending.size, 0);
		await assert.rejects(request.send(), (error) => error.name === "AbortError");
	});

test("failed canonical read never reports stale restoration and leaves no timer", async () => {
	const h = harness();
	const preparing = h.request();
	h.withUndo({
		...h.options(preparing),
		restore: async () => {
			throw new Error("offline");
		},
	});
	const request = await preparing;
	h.notices[0].action.onPress();
	await assert.rejects(request.send());
	await Promise.resolve();
	assert.equal(h.env.restored, 0);
	assert.equal(h.env.failures, 1);
	assert.equal(h.pending.size, 0);
});

test("preflight rejection does not display successful Undo acknowledgement", async () => {
	const h = harness();
	const preparing = deferred();
	h.withUndo(h.options(preparing.promise));
	preparing.reject(new Error("unauthorized"));
	await assert.rejects(preparing.promise);
	assert.equal(h.notices.length, 0);
	assert.equal(h.env.sent, 0);
	assert.equal(h.env.failures, 1);
	assert.equal(h.env.restored, 1);
	assert.equal(h.pending.size, 0);
});

async function rowsHarness() {
	const h = harness();
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
	const env = Object.assign(h.env, {
		server: "fixture",
		offline: false,
		canonical: [{ id: "fact", text: "Fictional private fact" }],
	});
	const key = ["career", "facts"];
	await queryClient.fetchQuery({
		queryKey: key,
		queryFn: () => {
			if (env.offline) throw new Error("offline");
			return env.canonical;
		},
	});
	const cells = [];
	const cleanup = [];
	let cursor = 0;
	const react = {
		useState: (initial) => {
			const i = cursor++;
			if (!(i in cells)) cells[i] = typeof initial === "function" ? initial() : initial;
			return [
				cells[i],
				(value) => {
					cells[i] = typeof value === "function" ? value(cells[i]) : value;
				},
			];
		},
		useRef: (initial) => {
			const i = cursor++;
			return (cells[i] ??= { current: initial });
		},
		useLayoutEffect: (run) => run(),
		useEffect: (run, deps) => {
			const i = cursor++;
			if (!(i in cells) || deps.some((value, j) => value !== cells[i][j])) {
				cleanup[i]?.();
				cells[i] = deps;
				cleanup[i] = run();
			}
		},
	};
	const { useUndoRows: readRows } = load("../src/features/career/hooks.ts", {
		react: react,
		"react-native": {},
		"@lingui/react/macro": { useLingui: () => ({ t: (parts) => parts.join("") }) },
		"@orpc/client": { ORPCError: Error },
		"@tanstack/react-query": { useQueryClient: () => queryClient },
		"./undo": { withUndo: h.withUndo },
		"@/api/client": {
			orpc: Object.fromEntries(["career", "applications", "documents"].map((name) => [name, { key: () => [name] }])),
		},
		"@/auth/session": {
			getAccountScope: () => h.env.account,
			getServer: () => env.server,
			useSession: () => ({ server: "fixture", status: "signed-in" }),
		},
		"@/features/settings/queries": {},
		"@/ui": { showToast: (notice) => h.notices.push(notice) },
	});
	function render() {
		cursor = 0;
		return readRows();
	}
	return { ...h, env, queryClient, key, render, unmount: () => cleanup.forEach((run) => run?.()) };
}
const drain = () => new Promise((resolve) => setImmediate(resolve));

test("actual native row Undo waits for canonical readback; failed read keeps stale private text hidden until Retry", async () => {
	const h = await rowsHarness();
	const preparing = h.request();
	h.render().remove("fact", "Fact forgotten", () => preparing, h.key);
	assert.deepEqual(h.render().hidden, []);
	await preparing;
	assert.deepEqual(h.render().hidden, ["fact"]);
	h.env.canonical = [];
	h.env.offline = true;
	h.notices[0].action.onPress();
	await drain();
	assert.equal(h.env.sent, 0);
	assert.deepEqual(h.render().hidden, ["fact"]);
	assert.match(h.queryClient.getQueryData(h.key)[0].text, /private fact/);
	const retry = h.notices.at(-1).action;
	assert.equal(retry.label, "Retry");
	h.env.offline = false;
	retry.onPress();
	await drain();
	assert.deepEqual(h.queryClient.getQueryData(h.key), []);
	assert.deepEqual(h.render().hidden, []);
	h.unmount();
	h.queryClient.clear();
});

test("actual native row navigation flushes a prepared deletion synchronously and rejects duplicate removal", async () => {
	const h = await rowsHarness();
	const preparing = h.request();
	let prepared = 0;
	const remove = () =>
		h.render().remove("fact", "Fact forgotten", () => {
			prepared++;
			return preparing;
		});
	remove();
	remove();
	await preparing;
	assert.equal(prepared, 1);
	h.unmount();
	assert.equal(h.env.sent, 1);
	await drain();
	h.queryClient.clear();
});

test("actual native rows discard hidden IDs when account changes before commit, and returning account sees survivor", async () => {
	const h = await rowsHarness();
	const preparing = h.request();
	h.render().remove("fact", "Fact forgotten", () => preparing, h.key);
	await preparing;
	assert.deepEqual(h.render().hidden, ["fact"]);
	h.env.account = "bob";
	h.render();
	h.background();
	await drain();
	h.env.account = "alice";
	h.render();
	assert.deepEqual(h.render().hidden, []);
	assert.equal(h.env.sent, 0);
	assert.equal(h.queryClient.getQueryData(h.key)[0].id, "fact");
	h.unmount();
	h.queryClient.clear();
});

test("actual native Undo reveals canonical list even while an unrelated Career endpoint fails", async () => {
	const h = await rowsHarness();
	await h.queryClient
		.fetchQuery({
			queryKey: ["career", "stories"],
			queryFn: () => {
				throw new Error("unrelated unavailable");
			},
		})
		.catch(() => {});
	const preparing = h.request();
	h.render().remove("fact", "Fact forgotten", () => preparing, h.key);
	await preparing;
	h.notices[0].action.onPress();
	await drain();
	assert.deepEqual(h.render().hidden, []);
	assert.equal(h.env.sent, 0);
	h.unmount();
	h.queryClient.clear();
});
