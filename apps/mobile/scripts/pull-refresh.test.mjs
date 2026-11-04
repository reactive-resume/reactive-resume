// Run: node --test apps/mobile/scripts/pull-refresh.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { esbuild, run } from "./harness.mjs";

const source = readFileSync(new URL("../src/ui/use-pull-refresh.ts", import.meta.url), "utf8");
const code = esbuild.transformSync(source, { loader: "ts", format: "cjs" }).code;

function hook(...refetches) {
	const values = [];
	let cursor = 0;
	const react = {
		useState(initial) {
			const index = cursor++;
			if (!(index in values)) values[index] = initial;
			return [
				values[index],
				(value) => {
					values[index] = value;
				},
			];
		},
		useRef(initial) {
			const index = cursor++;
			if (!(index in values)) values[index] = { current: initial };
			return values[index];
		},
	};
	const { usePullRefresh } = run(code, { react });
	return () => {
		cursor = 0;
		return usePullRefresh(...refetches);
	};
}

// Flush the callback and allSettled microtasks without advancing the clock.
const settle = async () => {
	for (let index = 0; index < 10; index++) await Promise.resolve();
};

test("pull feedback lasts 400 ms, settles failed callbacks, and ignores overlapping gestures", async (context) => {
	context.mock.timers.enable({ apis: ["setTimeout"] });
	let calls = 0;
	const render = hook(
		async () => {
			calls++;
		},
		() => {
			throw new Error("offline");
		},
		() => Promise.reject(new Error("request rejected")),
	);
	assert.equal(render().refreshing, false);
	const pull = render();
	const completion = pull.onRefresh();
	assert.equal(render().refreshing, true);
	await pull.onRefresh();
	await settle();
	assert.equal(calls, 1);
	context.mock.timers.tick(399);
	await settle();
	assert.equal(render().refreshing, true);
	context.mock.timers.tick(1);
	await completion;
	assert.equal(render().refreshing, false);
	const next = render().onRefresh();
	context.mock.timers.tick(400);
	await next;
	assert.equal(calls, 2);
	assert.equal(render().refreshing, false);
});
