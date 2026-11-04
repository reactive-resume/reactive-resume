// Node checks for slider gesture commits/cancellation; native timing and worklet execution still need device QA.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const server = createRequire(`${root}apps/server/package.json`);
const { build } = createRequire(server.resolve("tsx"))("esbuild");
let owner;
const env = {
	rtl: false,
	queue: [],
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
	useEffect(effect, deps) {
		const current = owner;
		const index = current.cursor++;
		const previous = current.hooks[index];
		if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
			current.effects.push(() => {
				previous?.cleanup?.();
				current.hooks[index] = { deps, cleanup: effect() };
			});
		}
	},
	useSharedValue(initial) {
		const index = owner.cursor++;
		return (owner.hooks[index] ??= {
			current: initial,
			get() {
				return this.current;
			},
			set(value) {
				this.current = value;
			},
		});
	},
	gesture() {
		const callbacks = {};
		const builder = new Proxy(
			{ callbacks },
			{
				get: (target, key) =>
					key === "callbacks"
						? target.callbacks
						: (value) => {
								callbacks[key] = value;
								return builder;
							},
			},
		);
		return builder;
	},
};
globalThis.__motionCheck = env;
const mocks = {
	react: `const e=globalThis.__motionCheck;export const useState=e.useState,useEffect=e.useEffect,useMemo=(fn)=>fn();`,
	"react/jsx-runtime": `export const jsx=(type,props)=>({type,props});export const jsxs=jsx;`,
	"react-native": `export const View='View',TextInput='TextInput';export const I18nManager={get isRTL(){return globalThis.__motionCheck.rtl}};`,
	"react-native-reanimated": `export const useSharedValue=globalThis.__motionCheck.useSharedValue,useAnimatedStyle=(fn)=>({read:fn});export default {View:'Animated.View'};`,
	"react-native-worklets": `export const scheduleOnRN=(fn,...args)=>globalThis.__motionCheck.queue.push(()=>fn(...args));`,
	"react-native-gesture-handler": `const e=globalThis.__motionCheck;export const Gesture={Pan:e.gesture,Tap:e.gesture,Race:(...gestures)=>gestures};export const GestureDetector='GestureDetector';`,
	"@lingui/react/macro": `export const useLingui=()=>({t:(parts,...values)=>parts.reduce((s,p,i)=>s+p+(values[i]??''),'')});`,
	"@/ui": `export const IconButton='IconButton',Switch='Switch',Text='Text';export const haptics={selection(){}};export const useTheme=()=>({space:{s1:4,s2:8,s4:16,s6:24,s8:32},size:{hit:44},radius:{rLg:4},colors:{},shadows:{e1:{}}});`,
};
const result = await build({
	entryPoints: [`${root}apps/mobile/src/features/design/controls.tsx`],
	jsx: "automatic",
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
	logLevel: "silent",
	plugins: [
		{
			name: "native-boundaries",
			setup(build) {
				build.onResolve({ filter: /.*/ }, ({ path }) => (path in mocks ? { path, namespace: "mock" } : undefined));
				build.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({ contents: mocks[path], loader: "js" }));
			},
		},
	],
});
const temporary = await mkdtemp(join(tmpdir(), "rr-motion-check-"));
const bundle = join(temporary, "check.mjs");
await writeFile(bundle, result.outputFiles[0].text);
const { Slider } = await import(pathToFileURL(bundle).href);
await rm(temporary, { recursive: true });
function mount(Component, props) {
	const instance = { hooks: [], effects: [], cursor: 0, tree: null, props };
	instance.render = () => {
		owner = instance;
		instance.cursor = 0;
		instance.tree = Component(instance.props);
		for (const effect of instance.effects.splice(0)) effect();
		return instance.tree;
	};
	instance.render();
	return instance;
}
const drain = () => {
	for (const callback of env.queue.splice(0)) callback();
};
const event = (x) => ({ x });
for (const rtl of [false, true]) {
	env.rtl = rtl;
	const changes = [];
	const slider = mount(Slider, {
		label: "Size",
		value: 50,
		min: 0,
		max: 100,
		step: 5,
		format: String,
		onChange: (value) => changes.push(value),
	});
	slider.tree.props.children.props.onLayout({ nativeEvent: { layout: { width: 100 } } });
	slider.render();
	const [pan, tap] = slider.tree.props.gesture;
	pan.callbacks.onStart?.(event(50));
	for (let x = 50; x <= 93; x++) pan.callbacks.onUpdate(event(x));
	assert.deepEqual(changes, [], "drag must not persist intermediate edits");
	pan.callbacks.onFinalize(event(93), true);
	drain();
	assert.deepEqual(changes, [rtl ? 5 : 95], "release commits one snapped edit");
	pan.callbacks.onStart?.(event(50));
	pan.callbacks.onUpdate(event(0));
	pan.callbacks.onFinalize(event(0), false);
	drain();
	assert.equal(changes.length, 1, "cancel must not commit");
	tap.callbacks.onEnd(event(500), true);
	drain();
	assert.equal(changes.at(-1), rtl ? 0 : 100, "tap clamps at bound");
	slider.props.disabled = true;
	slider.render();
	const before = changes.length;
	slider.tree.props.children.props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } });
	assert.equal(changes.length, before, "disabled accessibility adjustment must not edit");
}
delete globalThis.__motionCheck;
console.log("PASS slider release/cancel/bounds/RTL/disabled accessibility");
