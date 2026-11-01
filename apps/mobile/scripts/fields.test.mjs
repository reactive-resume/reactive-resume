// Host boundary proof; native layout and caret movement still need device QA.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const react = {
	createElement: (type, props, ...children) => ({ type, props: { ...props, children: children.flat(Infinity) } }),
	useRef: (current) => ({ current }),
	useState: (value) => [value, () => {}],
};
const native = {
	I18nManager: { isRTL: true },
	Platform: { OS: "ios" },
	Pressable: "Pressable",
	TextInput: "TextInput",
	View: "View",
};
const theme = { colors: {}, radius: {}, size: {}, space: {}, type: {} };
const mocks = {
	react,
	"react-native": native,
	"react-native-reanimated": {},
	"@lingui/react/macro": {},
	"@reactive-resume/utils/string": {},
	"./icon": {},
	"./layout": {},
	"./motion": {},
	"./overlays": {},
	"./switch": {},
	"./text": { Text: "Text" },
	"./theme": { useTheme: () => theme },
};
const module = { exports: {} };
const code = transformSync(readFileSync(new URL("../src/ui/fields.tsx", import.meta.url), "utf8"), {
	loader: "tsx",
	format: "cjs",
	jsx: "transform",
}).code;
new Function("React", "require", "module", "exports", code)(
	react,
	(name) => {
		assert.ok(name in mocks, `Missing boundary: ${name}`);
		return mocks[name];
	},
	module,
	module.exports,
);
function render(node) {
	if (typeof node?.type === "function") return render(node.type(node.props));
	if (!node?.props) return node;
	return { ...node, props: { ...node.props, children: node.props.children.map(render) } };
}
function find(node, type) {
	if (node?.type === type) return node;
	for (const child of node?.props?.children ?? []) {
		const found = find(child, type);
		if (found) return found;
	}
}

test("typed addresses stay LTR within an RTL native interface; ordinary text follows the interface", () => {
	for (const input of [
		{ keyboardType: "url" },
		{ keyboardType: "email-address" },
		{ keyboardType: "phone-pad" },
		{ inputMode: "url" },
		{ inputMode: "email" },
		{ inputMode: "tel" },
		{},
	]) {
		const tree = render(
			react.createElement(module.exports.TextField, {
				label: "Contact",
				value: "example.test",
				onChangeText() {},
				...input,
			}),
		);
		const address = Object.keys(input).length > 0;
		assert.equal(find(tree, "Pressable").props.style.direction, address ? "ltr" : undefined);
		assert.equal(find(tree, "TextInput").props.style.at(-1).writingDirection, address ? "ltr" : undefined);
		assert.equal(find(tree, "TextInput").props.style.at(-1).textAlign, address ? "left" : "right");
		assert.equal(find(tree, "TextInput").props.value, "example.test");
	}
});
