// Actual React state, shipped letter/shared fields and Improve panel; native input and HTTP are boundary fixtures.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { bundle, mobileRequire as req, tag } from "./harness.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const { Window } = await import(req.resolve("happy-dom"));
const window = new Window();
Object.assign(globalThis, {
	window,
	document: window.document,
	HTMLElement: window.HTMLElement,
	IS_REACT_ACT_ENVIRONMENT: true,
});
Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
const React = req("react");
const { act, cleanup, fireEvent, render, screen } = req("@testing-library/react");
const h = React.createElement;
let fixture;
const NativeInput = React.forwardRef((props, ref) => {
	React.useLayoutEffect(() => {
		fixture.input = props;
	});
	React.useImperativeHandle(
		ref,
		() => ({
			getHTML: () => fixture.read(),
			setValue: (html) => {
				fixture.html = html;
			},
			focus() {},
			blur() {},
		}),
		[],
	);
	return h("textarea", { "aria-label": props.accessibilityLabel, disabled: !props.editable });
});
const ScrollView = React.forwardRef(({ children }, ref) => {
	React.useImperativeHandle(ref, () => ({ flashScrollIndicators() {} }), []);
	return h("div", null, children);
});
const View = ({ children }) => h("div", null, children);
const Text = ({ children }) => h("span", null, children);
const Button = ({ label, onPress, disabled }) => h("button", { onClick: onPress, disabled }, label);
const deps = {
	react: React,
	"react/jsx-runtime": req("react/jsx-runtime"),
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { number: String } }) },
	"@lingui/core/macro": { plural: (count) => `${count} characters` },
	"react-native": { View, ScrollView },
	"react-native-enriched-html": { EnrichedTextInput: NativeInput },
	"react-native-safe-area-context": { useSafeAreaInsets: () => ({ bottom: 0 }) },
	"@/auth/session": { getAccountScope: () => fixture.account },
	"@/draft": {
		letterFieldFocus: { onFocus: () => fixture.letterFocus++, onBlur: () => fixture.letterBlur++ },
		resumeFieldFocus: { onFocus: () => fixture.resumeFocus++, onBlur() {} },
	},
	"@/features/ai/providers": {
		AIProviderSetupSheet: () => null,
		useHasAIProvider: () => ({
			hasAIProvider: true,
			defaultProvider: {
				id: "fixture-provider",
				label: "Fictional AI",
				model: "main",
				fastModel: "fast",
				capableModel: null,
			},
			isLoading: false,
		}),
	},
	"@/api/client": { orpc: { ai: { improve: { mutationOptions: () => ({}) } } } },
	"@tanstack/react-query": {
		useMutation: () => {
			const [data, setData] = React.useState(null);
			return {
				data,
				error: null,
				isPending: false,
				isError: false,
				mutate(input) {
					fixture.requests.push(input);
					setData(fixture.result);
				},
				reset() {
					setData(null);
				},
			};
		},
	},
	"./pickers": { PromptSheet: () => null },
	"@/ui/keyboard": { useKeyboardVisible: () => false },
	"@/ui": {
		View,
		Text,
		Button,
		IconButton: Button,
		ListRow: ({ title, onPress }) => h("button", { onClick: onPress }, title),
		TextField: () => null,
		Sheet: () => null,
		useTheme: () => ({
			colors: {},
			fonts: { ui: { 400: "Fixture" } },
			radius: {},
			space: {},
			type: { bodyLarge: { lineHeight: 24, fontSize: 16 } },
			size: { hit: 44 },
		}),
	},
};
const load = (path, extra = {}) => bundle(`../src/${path}`, { ...deps, ...extra }, { absWorkingDir: root });
const shared = load("features/write/rich-text-field.tsx");
const { LetterRichText, LetterRichTextToolbar } = load("features/letters/rich-text-field.tsx", {
	"@/features/write/rich-text-field": shared,
});

function deferred() {
	let resolve;
	const promise = new Promise((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}
async function mount(props = {}) {
	fixture = {
		account: "account-A",
		html: "<p>Original line</p>",
		requests: [],
		writes: [],
		letterFocus: 0,
		letterBlur: 0,
		resumeFocus: 0,
		result: {
			text: "Reviewed replacement",
			why: "Fictional suggestion",
			addsFacts: false,
			aiOperationIds: ["reviewed-improve"],
			aiUsage: {
				requests: 2,
				models: [{ label: "Fictional Review AI", provider: "openai-compatible", model: "actual-fast" }],
			},
		},
		read: () => Promise.resolve(fixture.html),
	};
	const onChange = (html, options) => fixture.writes.push({ html, options });
	const fields = { label: "Letter body", value: "<p>Original line</p>", onChange, ...props };
	const tree = () => h(React.Fragment, null, h(LetterRichText, fields), h(LetterRichTextToolbar));
	let view;
	await act(async () => {
		view = render(tree());
	});
	await act(async () => {
		fixture.input.onChangeText({ nativeEvent: { value: "Original line" } });
		fixture.input.onFocus();
	});
	return { view, fields, tree };
}
async function choose(action) {
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: "Improve selected line" }));
	});
	await act(async () => {
		fireEvent.click(screen.getByRole("button", { name: action, exact: true }));
	});
}
test.afterEach(() => cleanup());
test.after(() => window.close());

for (const [action, label] of [
	["posting", "Tie to the posting"],
	["warmer", "Warmer"],
]) {
	test(`native letter ${action} uses canonical Improve and reviewed Replace with letter focus/history`, async () => {
		await mount({ applicationId: "owned-application" });
		assert.equal(fixture.letterFocus, 1);
		assert.equal(fixture.resumeFocus, 0);
		await choose(label);
		assert.equal(fixture.writes.length, 0, "generation must not mutate the body");
		assert.deepEqual(fixture.requests, [
			{
				aiProviderId: "fixture-provider",
				includeProvenance: true,
				action,
				line: "Original line",
				where: "Letter body",
				context: "Original line",
				...(action === "posting" ? { applicationId: "owned-application" } : {}),
			},
		]);
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Replace", exact: true }));
		});
		assert.deepEqual(fixture.writes, [
			{ html: "<p>Reviewed replacement</p>", options: { newStep: true, aiOperationIds: ["reviewed-improve"] } },
		]);
	});
}
test("source-less older Improve response stays usable without repeating generation", async () => {
	await mount();
	fixture.result = { text: "Reviewed replacement", why: "Older server", addsFacts: false };
	await choose("Warmer");
	await act(async () => fireEvent.click(screen.getByRole("button", { name: "Replace", exact: true })));
	assert.deepEqual(fixture.writes, [
		{ html: "<p>Reviewed replacement</p>", options: { newStep: true, aiOperationIds: undefined } },
	]);
	assert.equal(fixture.requests.length, 1);
});
for (const change of ["account", "unmount", "dismiss", "locked", "unrelated-edit", "read-failed"]) {
	test(`pending native letter Replace refuses ${change}`, async () => {
		const { view, fields, tree } = await mount();
		await choose("Warmer");
		const arrived = deferred();
		const held = deferred();
		fixture.read = () => {
			arrived.resolve();
			return held.promise;
		};
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Replace", exact: true }));
			await arrived.promise;
			if (change === "account") fixture.account = "account-B";
			if (change === "unmount") view.unmount();
			if (change === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Keep mine", exact: true }));
			if (change === "locked") {
				fields.disabled = true;
				view.rerender(tree());
			}
			if (change === "unrelated-edit") {
				fields.value = "<p>Original line</p><p>New authored paragraph</p>";
				view.rerender(tree());
			}
			// Apply rerenders before the pending native read resolves.
		});
		await act(async () => {
			if (change === "read-failed") held.resolve(Promise.reject(new Error("Native read failed")));
			else held.resolve("<p>Original line</p>");
		});
		assert.deepEqual(fixture.writes, []);
	});
}

test("two captured Replace presses commit one reviewed history step", async () => {
	await mount();
	await choose("Warmer");
	const held = deferred();
	let reads = 0;
	fixture.read = () => {
		reads++;
		return held.promise;
	};
	await act(async () => {
		const replace = screen.getByRole("button", { name: "Replace", exact: true });
		fireEvent.click(replace);
		fireEvent.click(replace);
	});
	assert.equal(reads, 2);
	await act(async () => {
		held.resolve("<p>Original line</p>");
	});
	assert.equal(fixture.writes.length, 1);
	assert.deepEqual(fixture.writes[0].options, { newStep: true, aiOperationIds: ["reviewed-improve"] });
});
