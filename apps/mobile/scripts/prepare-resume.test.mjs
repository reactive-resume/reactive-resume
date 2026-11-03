// Shipped add form and copy helper; React state is real, native UI and network are boundary fixtures.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const req = createRequire(`${root}/apps/mobile/package.json`);
const serverReq = createRequire(`${root}/apps/server/package.json`);
const { buildSync } = createRequire(serverReq.resolve("tsx"))("esbuild");
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
const tag = (parts, ...values) =>
	Array.isArray(parts) ? parts.reduce((text, part, i) => text + part + (values[i] ?? ""), "") : parts.message;
const View = ({ children }) => h("div", null, children);
const Text = ({ children }) => h("span", null, children);
const Button = ({ label, onPress, disabled, loading }) =>
	h("button", { onClick: onPress, disabled: disabled || loading }, label);
const TextField = ({ label, value, onChangeText, editable }) =>
	h("input", {
		"aria-label": label,
		value,
		disabled: editable === false,
		onChange: (e) => onChangeText(e.target.value),
	});
let fixture;
const lane = { id: "saved", category: "saved", label: "Saved" };
class SessionChangedError extends Error {
	constructor() {
		super("Session changed");
		this.name = "SessionChangedError";
	}
}
const client = {
	documents: {
		copyForJob: async (input, options) => {
			fixture.copies.push({ input, options });
			return fixture.copy(input);
		},
	},
};
const deps = {
	react: React,
	"react/jsx-runtime": req("react/jsx-runtime"),
	"react-native": { View, Platform: { OS: "android" } },
	"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { locale: "en-US", number: String } }) },
	"@orpc/client": { ORPCError: class extends Error {} },
	"@tanstack/react-query": {
		useQueryClient: () => ({ invalidateQueries: async () => {} }),
		useQuery: ({ queryKey }) => ({
			data: queryKey[0] === "documents" ? fixture.documents : queryKey[0] === "duplicate" ? fixture.duplicate : {},
			isPending: false,
		}),
	},
	"expo-router": { useRouter: () => ({ push: (href) => fixture.navigation.push(href) }) },
	"@reactive-resume/schema/applications/posting-source": { postingReadReceipt: () => null },
	"./date": { parseDateOnly: () => new Date() },
	"./error": { applicationError: String },
	"./lane-notice": { LaneNotice: () => null },
	"./lane-queries": { useApplicationLanes: () => ({ lanes: [lane], active: [lane], ready: true, supported: true }) },
	"./lanes": {
		getLaneLabel: (l) => l.label,
		laneInput: () => ({ status: "saved", laneId: "saved" }),
		resolveLane: () => lane,
	},
	"./prior-no-response": { PriorNoResponse: () => null },
	"./queries": {
		useApplicationMutations: () => ({
			create: {
				mutateAsync: async (input) => {
					fixture.jobs.push(input);
					return fixture.create();
				},
			},
			update: {},
		}),
	},
	"./stages": { CLOSED_REASONS: [], getClosedReasonLabel: String },
	"@/api/client": {
		client,
		SessionChangedError,
		orpc: {
			documents: { key: () => ["documents"], list: { queryOptions: () => ({ queryKey: ["documents"] }) } },
			applications: { findPosting: { queryOptions: () => ({ queryKey: ["duplicate"] }) } },
			webAccess: { status: { queryOptions: () => ({ queryKey: ["web"] }) } },
		},
	},
	"@/auth/session": {
		getAccountScope: () => fixture.account,
		getServer: () => "fixture",
		useSession: () => ({ server: "fixture" }),
	},
	"@/features/ai/providers": {
		AIProviderSetupSheet: () => null,
		useHasAIProvider: () => ({ hasAIProvider: fixture.provider }),
	},
	"@/features/ai/web-access": { WebAccessAttention: () => null, webSearchFailure: () => undefined },
	"@/features/application-detail/date-field": { WallClockField: () => null },
	"@/features/application-detail/hooks": { useNow: () => new Date(), useUserTime: () => ({ timeZone: "UTC" }) },
	"@/features/documents/new-documents": { useNewDocuments: { getState: () => ({ markOpened() {} }) } },
	"@/ui": {
		View,
		Text,
		Button,
		TextField,
		TextArea: TextField,
		EditorSheet: ({ children, footer, ...props }) => {
			fixture.sheet = props;
			return h("div", null, children, footer);
		},
		Banner: ({ message }) => h("span", null, message),
		ChipInput: () => null,
		ConfirmDialog: () => null,
		ListRow: () => null,
		Segmented: () => null,
		SelectSheet: ({ label, value, options, onChange, disabled }) =>
			h(
				"select",
				{ "aria-label": label, value, disabled, onChange: (event) => onChange(event.target.value) },
				options.map((option) => h("option", { key: option.value, value: option.value }, option.label)),
			),
		showToast: ({ message }) => fixture.toasts.push(message),
		useTheme: () => ({ space: {} }),
	},
};
const code = buildSync({
	entryPoints: [`${root}/apps/mobile/src/features/applications/add-sheet.tsx`],
	absWorkingDir: root,
	bundle: true,
	platform: "node",
	format: "cjs",
	jsx: "automatic",
	write: false,
	external: Object.keys(deps),
}).outputFiles[0].text;
const module = { exports: {} };
new Function("require", "module", "exports", code)(
	(name) => {
		if (name.startsWith("node:")) return req(name);
		assert.ok(name in deps, `Unexpected boundary: ${name}`);
		return deps[name];
	},
	module,
	module.exports,
);
const { AddApplicationSheet } = module.exports;
function deferred() {
	let resolve;
	const promise = new Promise((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}
async function mount(options = {}, props = {}) {
	fixture = {
		account: "account-A",
		provider: false,
		duplicate: null,
		documents: [
			{ id: "base", type: "resume", name: "Base — Earlier company", application: null, updatedAt: new Date() },
		],
		jobs: [],
		copies: [],
		navigation: [],
		toasts: [],
		closed: 0,
		copy: (input) => input.newId,
		create: () => "saved-job",
		...options,
	};
	let view;
	await act(async () => {
		view = render(
			h(AddApplicationSheet, {
				initialCapture: { company: "Fictional", role: "Engineer", description: "Posting" },
				onClose: () => fixture.closed++,
				...props,
			}),
		);
	});
	return view;
}
const click = async (name) =>
	act(async () => {
		fireEvent.click(screen.getByRole("button", { name, exact: true }));
	});
test.afterEach(() => cleanup());
test.after(() => window.close());

test("Save and prepare copies the selected resume and opens Write without any AI provider", async () => {
	await mount();
	assert.equal(fixture.sheet.dirty, true);
	await click("Save and prepare resume");
	assert.equal(fixture.jobs.length, 1);
	assert.equal(fixture.jobs[0].resumeId, "base");
	assert.equal(fixture.copies.length, 1);
	const { input, options } = fixture.copies[0];
	assert.equal(input.resumeId, "base");
	assert.equal(input.applicationId, "saved-job");
	assert.equal(input.name, "Base — Fictional");
	assert.equal(options.context.scope, "account-A");
	assert.deepEqual(fixture.navigation, [`/builder/${input.newId}/write`]);
	assert.equal(fixture.closed, 1);
});
test("a connected provider opens existing prepare suggestions without sending an ask", async () => {
	await mount({ provider: true });
	await click("Save and prepare resume");
	const id = fixture.copies[0].input.newId;
	assert.deepEqual(fixture.navigation, [
		`/builder/${id}/write`,
		{ pathname: `/builder/${id}/assistant`, params: { prepare: "1" } },
	]);
});

test("the source explicitly selected in More details is copied instead of the default", async () => {
	await mount({
		documents: [
			{ id: "base", type: "resume", name: "Base", application: null, updatedAt: new Date() },
			{ id: "chosen", type: "resume", name: "Chosen", application: null, updatedAt: new Date(0) },
		],
	});
	await click("More details");
	await act(async () => {
		fireEvent.change(screen.getByLabelText("Resume"), { target: { value: "chosen" } });
	});
	await click("Save and prepare resume");
	assert.equal(fixture.jobs[0].resumeId, "chosen");
	assert.equal(fixture.copies[0].input.resumeId, "chosen");
	assert.equal(fixture.copies[0].input.name, "Chosen — Fictional");
});
test("ordinary Save job keeps the existing detail flow and does not copy", async () => {
	await mount();
	await click("Save job");
	assert.equal(fixture.jobs.length, 1);
	assert.equal(fixture.copies.length, 0);
	assert.deepEqual(fixture.navigation, ["/applications/saved-job/details"]);
});
test("picker saves return the job without a preparation action or navigation", async () => {
	const selected = [];
	await mount({}, { onAdded: (id) => selected.push(id) });
	assert.equal(screen.queryByRole("button", { name: "Save and prepare resume" }), null);
	await click("Save job");
	assert.deepEqual(selected, ["saved-job"]);
	assert.deepEqual(fixture.navigation, []);
});
test("no base resume opens existing copy/import flow for the confirmed saved job", async () => {
	await mount({ documents: [] });
	await click("Save and prepare resume");
	assert.equal(fixture.jobs.length, 1);
	assert.equal(fixture.copies.length, 0);
	assert.deepEqual(fixture.navigation, [{ pathname: "/new", params: { step: "copy", applicationId: "saved-job" } }]);
});
test("failed copy keeps the confirmed job and offers existing recovery with its selected source", async () => {
	await mount({
		copy: () => {
			throw new TypeError("Network failed");
		},
	});
	await click("Save and prepare resume");
	assert.equal(fixture.jobs.length, 1);
	assert.equal(fixture.copies.length, 1);
	assert.deepEqual(fixture.navigation, [
		{ pathname: "/new", params: { step: "copy", applicationId: "saved-job", sourceResumeId: "base" } },
	]);
	assert.deepEqual(fixture.toasts, ["Couldn't copy the resume. Choose it again to prepare it."]);
});
for (const change of ["account", "unmount"]) {
	test(`late job save after ${change} cannot copy or navigate`, async () => {
		const held = deferred();
		const view = await mount({ create: () => held.promise });
		await click("Save and prepare resume");
		assert.equal(fixture.sheet.pending, true);
		if (change === "account") fixture.account = "account-B";
		else view.unmount();
		await act(async () => {
			held.resolve("saved-job");
		});
		assert.equal(fixture.jobs.length, 1);
		assert.equal(fixture.copies.length, 0);
		assert.deepEqual(fixture.navigation, []);
		assert.equal(fixture.closed, 0);
	});
}
test("account replacement during copy cannot navigate or show recovery to the new account", async () => {
	const held = deferred();
	await mount({ copy: () => held.promise });
	await click("Save and prepare resume");
	fixture.account = "account-B";
	await act(async () => {
		held.resolve("copy");
	});
	assert.deepEqual(fixture.navigation, []);
	assert.deepEqual(fixture.toasts, []);
	assert.equal(fixture.closed, 0);
});
test("two captured preparation presses while save is held create and copy once", async () => {
	const held = deferred();
	await mount({ create: () => held.promise });
	await act(async () => {
		const button = screen.getByRole("button", { name: "Save and prepare resume" });
		fireEvent.click(button);
		fireEvent.click(button);
	});
	assert.equal(fixture.jobs.length, 1);
	await act(async () => {
		held.resolve("saved-job");
	});
	assert.equal(fixture.copies.length, 1);
	assert.equal(fixture.closed, 1);
});
