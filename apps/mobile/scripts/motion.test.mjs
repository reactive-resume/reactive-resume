// Node checks for gesture commits/cancellation; native timing and worklet execution still need device QA.
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
	reduced: false,
	queue: [],
	haptics: 0,
	useState(initial) {
		const current = owner;
		const index = current.cursor++;
		if (!(index in current.hooks)) current.hooks[index] = typeof initial === "function" ? initial() : initial;
		return [
			current.hooks[index],
			(value) => {
				current.writes++;
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
	useRef(initial) {
		const index = owner.cursor++;
		return (owner.hooks[index] ??= { current: initial });
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
	react: `const e=globalThis.__motionCheck;export const useState=e.useState,useEffect=e.useEffect,useLayoutEffect=e.useEffect,useRef=e.useRef,useMemo=(fn)=>fn();`,
	"react/jsx-runtime": `export const jsx=(type,props)=>({type,props});export const jsxs=jsx;`,
	"react-native": `export const View='View',Pressable='Pressable',ScrollView='ScrollView',TextInput='TextInput',ActivityIndicator='ActivityIndicator';export const I18nManager={get isRTL(){return globalThis.__motionCheck.rtl}};export const useWindowDimensions=()=>({width:402,height:874});`,
	"react-native-reanimated": `export const useSharedValue=globalThis.__motionCheck.useSharedValue,useAnimatedStyle=(fn)=>({read:fn}),withTiming=(value,_config,done)=>{done?.(true);return value},cubicBezier=()=>{};export default {View:'Animated.View',createAnimatedComponent:(type)=>type};`,
	"react-native-worklets": `export const scheduleOnRN=(fn,...args)=>globalThis.__motionCheck.queue.push(()=>fn(...args));`,
	"react-native-gesture-handler": `const e=globalThis.__motionCheck;export const Gesture={Pan:e.gesture,Tap:e.gesture,Pinch:e.gesture,Race:(...gestures)=>gestures,Simultaneous:(...gestures)=>gestures};export const GestureDetector='GestureDetector';`,
	"@lingui/core/macro": `export const plural=(n,forms)=>(n===1?forms.one:forms.other).replace("#",String(n));`,
	"@lingui/react/macro": `export const useLingui=()=>({t:(parts,...values)=>parts.reduce((s,p,i)=>s+p+(values[i]??''),'')});`,
	"expo-image": `export const Image='Image';`,
	"expo-router": `export const useRouter=()=>({});`,
	"@/routes": `export const routes={};`,
	"@/ui": `export const Banner='Banner',Button='Button',IconButton='IconButton',Switch='Switch',Text='Text';export const haptics={selection:()=>globalThis.__motionCheck.haptics++};export const useReducedMotion=()=>globalThis.__motionCheck.reduced;export const workletEaseMove=()=>{};export const useTheme=()=>({space:{s1:4,s2:8,s4:16,s6:24,s8:32},motion:{d2:200,easeMove:()=>{}},size:{hit:44},radius:{rLg:4},colors:{},shadows:{e1:{},ePage:{}}});`,
	"./motion": `export const useReducedMotion=()=>globalThis.__motionCheck.reduced;`,
	"./usePreview": `export const usePreview=()=>({result:null,displayScale:1});`,
	"./fit": `export const fitResume=()=>{};`,
};
const result = await build({
	stdin: {
		contents: [
			"src/features/design/controls.tsx",
			"src/ui/pressable.tsx",
			"src/preview/page.tsx",
			"src/preview/use-page-zoom.tsx",
			"src/preview/zoom.ts",
			"src/preview/page-image.tsx",
		]
			.map((file) => `export * from ${JSON.stringify(`${root}apps/mobile/${file}`)};`)
			.join("\n"),
		resolveDir: root,
	},
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
const { Slider, FeedbackPressable, usePageZoom, ZoomViewport, snapZoom, zoomOffset, PageImage } = await import(
	pathToFileURL(bundle).href
);
await rm(temporary, { recursive: true });
function mount(Component, props) {
	const instance = { hooks: [], effects: [], cursor: 0, writes: 0, tree: null, props };
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
const event = (x) => ({ x, scale: x });
function find(tree, type) {
	if (typeof type === "function" ? type(tree) : tree?.type === type) return tree;
	for (const child of [tree?.props?.children].flat(Infinity)) {
		const result = child && typeof child === "object" ? find(child, type) : null;
		if (result) return result;
	}
	return null;
}
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
	const feedback = env.haptics;
	slider.writes = 0;
	pan.callbacks.onStart?.(event(50));
	for (let x = 50; x <= 93; x++) pan.callbacks.onUpdate(event(x));
	assert.equal(slider.writes, 0, "drag must not rerender React");
	assert.deepEqual(changes, [], "drag must not persist intermediate edits");
	pan.callbacks.onFinalize(event(93), true);
	drain();
	assert.deepEqual(changes, [rtl ? 5 : 95], "release commits one snapped edit");
	assert.equal(env.haptics, feedback + 1, "release gives one haptic");
	pan.callbacks.onStart?.(event(50));
	pan.callbacks.onUpdate(event(0));
	pan.callbacks.onFinalize(event(0), false);
	drain();
	assert.equal(changes.length, 1, "cancel must not commit");
	assert.equal(env.haptics, feedback + 1, "cancel must not give commit feedback");
	assert.equal(find(slider.tree, "Animated.View").props.style.at(-1).read().width, "50%", "cancel restores slider");
	tap.callbacks.onEnd(event(500), true);
	drain();
	assert.equal(changes.at(-1), rtl ? 0 : 100, "tap clamps at bound");
	slider.props.disabled = true;
	slider.render();
	const before = changes.length;
	slider.tree.props.children.props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } });
	assert.equal(changes.length, before, "disabled accessibility adjustment must not edit");
}
// Exercise the shared controller/viewport used by both resume and letter previews.
const zoom = mount(usePageZoom, {});
const page = mount(ZoomViewport, { controller: zoom.tree, width: 400, pageWidth: 368, children: null });
let [pinch] = find(page.tree, "GestureDetector").props.gesture;
page.writes = 0;
zoom.writes = 0;
pinch.callbacks.onStart({ focalX: 150, focalY: 200 });
for (let scale = 1; scale <= 2; scale += 0.01) pinch.callbacks.onUpdate({ scale });
assert.equal(page.writes + zoom.writes, 0, "pinch must not rerender/rasterize per frame");
pinch.callbacks.onFinalize({}, true);
drain();
assert.equal(zoom.writes, 1, "pinch commits only on release");
zoom.render();
assert.equal(zoom.tree.zoom, 1.5, "zoom clamps at maximum");
page.props.controller = zoom.tree;
page.render();
[pinch] = find(page.tree, "GestureDetector").props.gesture;
zoom.writes = 0;
pinch.callbacks.onStart({ focalX: 150, focalY: 200 });
pinch.callbacks.onUpdate({ scale: 0.1 });
pinch.callbacks.onFinalize({}, false);
drain();
assert.equal(zoom.writes, 0, "cancelled pinch must not commit");
assert.equal(zoom.tree.live.get(), 1.5, "cancel restores preview scale");
for (const [input, expected] of [
	[1.23, 1.25],
	[1.02, null],
	[0.01, 0.6],
	[99, 1.5],
]) {
	assert.equal(snapZoom(input), expected, "committed zoom snaps to 5% and clamps");
}
assert.equal(zoomOffset(300, 200, 1, 1.25, 16), 421, "scrolled focal point stays under fingers");
assert.equal(zoomOffset(421, 200, 1.25, 1, 16), 300, "zooming back restores focal offset");
assert.equal(zoomOffset(0, 200, 1, 0.6, 16), 0, "scroll cannot pass content origin");
zoom.tree.change(1);
drain();
zoom.render();
assert.equal(zoom.tree.zoom, null, "100% collapses to the Fit state");
zoom.tree.step(0.1);
drain();
zoom.render();
assert.equal(zoom.tree.zoom, 1.1, "step starts at current effective fit zoom");
// Pinch commit restores actual scroll refs after layout, including existing scroll offsets.
const anchored = mount(usePageZoom, {});
const canvas = mount(ZoomViewport, { controller: anchored.tree, width: 400, pageWidth: 368, children: null });
const scrolls = [];
const outerScroll = find(canvas.tree, "ScrollView");
const innerScroll = find(outerScroll.props.children, "ScrollView");
outerScroll.props.ref.current = { scrollTo: (value) => scrolls.push(value) };
innerScroll.props.ref.current = { scrollTo: (value) => scrolls.push(value) };
outerScroll.props.onScroll({ nativeEvent: { contentOffset: { x: 30 } } });
innerScroll.props.onScroll({ nativeEvent: { contentOffset: { y: 300 } } });
const [anchoredPinch] = canvas.tree.props.gesture;
anchoredPinch.callbacks.onStart({ focalX: 150, focalY: 200 });
anchoredPinch.callbacks.onUpdate({ scale: 1.23 });
anchoredPinch.callbacks.onFinalize({}, true);
drain();
anchored.render();
canvas.props.controller = anchored.tree;
canvas.render();
globalThis.requestAnimationFrame = (callback) => callback();
find(canvas.tree, "ScrollView").props.onContentSizeChange();
delete globalThis.requestAnimationFrame;
assert.deepEqual(
	scrolls,
	[
		{ x: 71, animated: false },
		{ y: 421, animated: false },
	],
	"layout restores snapped focal offsets",
);
const raster = mount(PageImage, { uri: "old.png", accessible: false });
raster.tree.props.onDisplay();
raster.props.uri = "sharper.png";
raster.render();
assert.equal(raster.tree.props.source.uri, "sharper.png");
assert.equal(raster.tree.props.placeholder.uri, "old.png", "old raster remains until replacement is displayed");
raster.tree.props.onDisplay();
raster.render();
assert.equal(raster.tree.props.placeholder.uri, "sharper.png");
assert.equal(raster.tree.props.transition, 0, "raster swap never fades to blank");
for (const reduced of [false, true]) {
	env.reduced = reduced;
	let actions = 0;
	const button = mount(FeedbackPressable, { onPress: () => actions++, accessibilityLabel: "Save" });
	button.tree.props.onPressIn({});
	button.render();
	assert.equal(actions, 0, "press-in must not commit action");
	assert.equal(button.tree.props.style.at(-1).transform[0].scale, reduced ? 1 : 0.97);
	button.tree.props.onPressOut({});
	button.tree.props.onPress();
	button.render();
	assert.equal(actions, 1);
	assert.equal(button.tree.props.style.at(-1).transform[0].scale, 1);
}
delete globalThis.__motionCheck;
console.log(
	"PASS slider release/cancel/bounds/RTL/disabled accessibility, pinch release/cancel/snap/focal scroll, raster retention, press commit/reduced motion",
);
