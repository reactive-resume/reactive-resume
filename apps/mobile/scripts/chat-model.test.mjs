// Render the native model control's presentation boundary; not device execution.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const react = { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }) };
const mocks = {
	"@lingui/react/macro": {
		useLingui: () => ({ t: (parts, ...values) => parts.reduce((s, part, i) => s + part + (values[i] ?? ""), "") }),
	},
	"@orpc/client": {},
	"@tanstack/react-query": {},
	"expo-router": {},
	react,
	"react-native": { Pressable: "Pressable" },
	"./chat": {},
	"./chat-view": {},
	"@/api/client": {},
	"@/auth/session": {},
	"@/features/ai/providers": {},
	"@/features/ai/web-access": {},
	"@/routes": {},
	"@/ui": { Text: "Text", Icon: "Icon", useTheme: () => ({ colors: {}, space: {} }) },
};
const module = { exports: {} };
new Function(
	"React",
	"require",
	"module",
	"exports",
	transformSync(readFileSync(new URL("../src/features/assistant/provider.tsx", import.meta.url), "utf8"), {
		loader: "tsx",
		format: "cjs",
		jsx: "transform",
	}).code,
)(
	react,
	(name) => {
		assert.ok(name in mocks, `Unmapped native boundary ${name}`);
		return mocks[name];
	},
	module,
	module.exports,
);
const { ModelButton } = module.exports;

test("native chat model control names the selected connection and model, retaining a missing-connection fallback", () => {
	for (const [current, expected] of [
		[{ label: "Fictional Cedar AI", model: "test-model" }, "Fictional Cedar AI · test-model"],
		[undefined, "Removed connection"],
	]) {
		let opens = 0;
		const control = ModelButton({ current, label: "Removed connection", onPress: () => opens++ });
		assert.deepEqual(control.props.children[0].props.children, [expected]);
		assert.equal(control.props.accessibilityLabel, `Model: ${expected}`);
		control.props.onPress();
		assert.equal(opens, 1);
	}
});
