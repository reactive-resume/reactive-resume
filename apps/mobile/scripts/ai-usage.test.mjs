import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { load, mobileRequire, tag } from "./harness.mjs";
const { renderToStaticMarkup } = mobileRequire("react-dom/server");
const React = mobileRequire("react");
const schemaRequire = createRequire(new URL("../../../packages/schema/package.json", import.meta.url));
const schema = load("../../../packages/schema/src/ai-usage.ts", { zod: schemaRequire("zod") });
const { authorizeAiRequest } = load("../src/api/ai-consent.ts", {
	"@lingui/core/macro": { t: (parts) => parts.join("") },
	"@orpc/client": mobileRequire("@orpc/client"),
	"react-native": { Alert: { alert: () => assert.fail("History must not ask for AI sharing") } },
	"@reactive-resume/ai/task-models": {},
	"@reactive-resume/ai/types": {},
	"@/auth/session": { getAccountScope: () => "account", getServer: () => "https://fictional.invalid" },
});
test("native usage history needs no provider or sharing approval", async () => {
	let lookups = 0;
	const api = {
		aiProviders: {
			list: async () => {
				lookups++;
				return [];
			},
		},
	};
	assert.equal(await authorizeAiRequest(["ai", "usage"], {}, api, "account"), undefined);
	assert.equal(lookups, 0);
});
let locale = "en-US";
let state;
let refresh;
const text = ({ children }) => React.createElement("span", null, children);
const box = ({ children }) => React.createElement("div", null, children);
const { AiResultUsage, AiUsageSection } = load("../src/features/ai/usage.tsx", {
	"react/jsx-runtime": mobileRequire("react/jsx-runtime"),
	"@lingui/core/macro": { t: tag },
	"@lingui/react/macro": {
		useLingui: () => ({
			t: tag,
			i18n: {
				number: (n) => new Intl.NumberFormat(locale).format(n),
				date: (v, o) => new Intl.DateTimeFormat(locale, o).format(v),
			},
		}),
	},
	"@tanstack/react-query": { useQuery: () => state },
	"react-native": { View: box },
	"@reactive-resume/schema/ai-usage": schema,
	"@/api/client": { orpc: { ai: { usage: { queryOptions: () => ({}) } } } },
	"@/ui": {
		Banner: ({ message }) => React.createElement("p", { role: "alert" }, message),
		Button: (props) => {
			refresh = props;
			return React.createElement("button", null, props.label);
		},
		Card: box,
		Text: text,
		useTheme: () => ({ space: { s1: 1, s2: 2, s3: 3 } }),
	},
});
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
const row = {
	action: "reply",
	providerId: "removed",
	label: "Removed connection",
	provider: "openai",
	model: "fast",
	requests: 2,
};
const report = {
	start: new Date("2026-10-25T23:00:00Z"),
	end: new Date("2026-11-01T23:00:00Z"),
	timezone: "Europe/Berlin",
	requests: 5,
	groups: [row, { ...row, action: "answer", model: "capable", requests: 3 }],
};
test("native usage renders actual connection/action/model totals and refreshes through the visible action", async () => {
	let refreshed = 0;
	state = {
		data: report,
		isFetching: false,
		refetch: async () => {
			refreshed++;
		},
	};
	const html = render(AiUsageSection);
	assert.ok(html.includes("Removed connection · openai"));
	assert.equal(html.split("AI request attempts: 5").length - 1, 2);
	assert.ok(html.includes("Reply · fast · Removed connection · 2"));
	assert.ok(html.includes("Form answer · capable · Removed connection · 3"));
	assert.ok(html.includes("Oct 26, 2026") && html.includes("Nov 1, 2026") && html.includes("Europe/Berlin"));
	await refresh.onPress();
	assert.equal(refreshed, 1);
	state = { ...state, isError: true };
	const failed = render(AiUsageSection);
	assert.ok(failed.includes('role="alert"'));
	assert.ok(!failed.includes("AI request attempts: 5"));
	state = { ...state, isError: false, data: { ...report, requests: 0, groups: [] } };
	assert.ok(render(AiUsageSection).includes("No AI request attempts recorded this week."));
});
test("native saved provenance uses locale counts and leaves historical results unknown", () => {
	locale = "ar-SA";
	assert.ok(render(AiResultUsage, { usage: undefined }).includes("AI request history unavailable for this result."));
	const html = render(AiResultUsage, { usage: { requests: 1234, models: [row] } });
	assert.ok(html.includes(new Intl.NumberFormat("ar-SA").format(1234)));
	assert.ok(html.includes("Removed connection · openai · fast"));
	locale = "en-US";
});
