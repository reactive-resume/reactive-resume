import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const tag = (parts, ...values) => parts.reduce((text, part, i) => text + part + (values[i] ?? ""), "");
function load(path, dependencies, react) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(path, "utf8"), {
		loader: path.pathname.endsWith(".tsx") ? "tsx" : "ts",
		format: "cjs",
		jsx: "transform",
	}).code;
	new Function("React", "require", "module", "exports", code)(
		react,
		(name) => {
			assert.ok(name in dependencies, `Unexpected boundary: ${name}`);
			return dependencies[name];
		},
		module,
		module.exports,
	);
	return module.exports;
}
const nodes = (tree) =>
	!tree || typeof tree !== "object"
		? []
		: Array.isArray(tree)
			? tree.flatMap(nodes)
			: [tree, ...nodes(tree.props?.children)];

test("native private profile sends explicit unknowns with owner scope, retains failed draft and blocks a stale-account export", async () => {
	let cursor = 0;
	const hooks = [];
	const react = {
		createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
		useState(initial) {
			const i = cursor++;
			if (!(i in hooks)) hooks[i] = typeof initial === "function" ? initial() : initial;
			return [
				hooks[i],
				(value) => {
					hooks[i] = typeof value === "function" ? value(hooks[i]) : value;
				},
			];
		},
	};
	const z = serverRequire("zod");
	const region = {
		countryCodeSchema: z.enum(["DE", "US"]),
		SEARCH_REGION_CODES: ["DE", "US"],
		countryName: (code) => code,
	};
	const schema = load(new URL("../../../packages/schema/src/application-profile.ts", import.meta.url), {
		zod: z,
		"@reactive-resume/utils/region": region,
	});
	const amount = load(new URL("../../../packages/utils/src/amount.ts", import.meta.url), {});
	let scope = "account-A";
	const saves = [];
	let rejectSave = false;
	let releaseExport;
	let shares = 0;
	let writes = 0;
	const dependencies = {
		react,
		"react-native": { View: "View" },
		"@lingui/react/macro": { useLingui: () => ({ t: tag, i18n: { locale: "en-US", date: () => "reviewed" } }) },
		"@tanstack/react-query": {
			useQuery: () => ({ data: null, isPending: false }),
			useQueryClient: () => ({ setQueryData() {} }),
		},
		"expo-router": { useRouter: () => ({ push() {} }) },
		"expo-file-system": {
			File: class {
				constructor() {}
				write() {
					writes++;
				}
			},
			Paths: { cache: {} },
		},
		"expo-sharing": {
			isAvailableAsync: async () => true,
			shareAsync: async () => {
				shares++;
			},
		},
		"@reactive-resume/schema/application-profile": schema,
		"@reactive-resume/utils/amount": amount,
		"@reactive-resume/utils/region": region,
		"./export-cache": { clearAccountExportCache() {} },
		"./layout": { SettingsGroup: "SettingsGroup" },
		"@/api/client": {
			client: {
				applicationProfile: {
					save: async (input, options) => {
						saves.push({ input, options });
						if (rejectSave) throw new Error("Conflict");
						return { data: input.data, reviewedAt: "2030-01-01T00:00:00Z", revision: "revision-1" };
					},
					get: async () =>
						new Promise((resolve) => {
							releaseExport = resolve;
						}),
				},
			},
			orpc: { applicationProfile: { get: { key: () => ["private-profile"], queryOptions: () => ({}) } } },
		},
		"@/auth/session": { getAccountScope: () => scope, useSession: () => ({ status: "signed-in" }) },
		"@/routes": { routes: { career: () => "/career/knowledge" } },
		"@/ui": {
			...Object.fromEntries(
				["Banner", "Button", "ConfirmDialog", "SelectSheet", "Text", "TextField"].map((name) => [name, name]),
			),
			useTheme: () => ({ space: { s2: 8, s3: 12 } }),
		},
	};
	const { ApplicationProfileSection } = load(
		new URL("../src/features/settings/application-profile.tsx", import.meta.url),
		dependencies,
		react,
	);
	const form = nodes(ApplicationProfileSection()).find((node) => typeof node.type === "function");
	assert.ok(form);
	const render = () => {
		cursor = 0;
		return form.type(form.props);
	};
	let tree = render();
	const control = (label) => nodes(tree).find((node) => node.props?.label === label)?.props;
	control("Given name").onChangeText("Casey");
	tree = render();
	control("Add authorization country").onChange("DE");
	tree = render();
	assert.equal(control("Authorized to work in DE").value, "unknown");
	assert.equal(control("Needs sponsorship in DE").value, "unknown");
	assert.ok(control("Remove DE"));
	control("Add link").onPress();
	tree = render();
	assert.ok(control("Link 1 label"));
	assert.ok(control("Link 1 URL"));
	control("Add link").onPress();
	tree = render();
	assert.ok(control("Link 2 label"));
	assert.ok(control("Link 2 URL"));
	control("Remove link 2").onPress();
	tree = render();
	control("Remove link 1").onPress();
	tree = render();
	control("Add reference").onPress();
	tree = render();
	control("Add reference").onPress();
	tree = render();
	assert.ok(control("Reference 1: Reference name"));
	assert.ok(control("Reference 2: Reference name"));
	assert.ok(control("Reference 2: Company"));
	control("Remove reference 2").onPress();
	tree = render();
	control("Remove reference 1").onPress();
	tree = render();
	control("Save and mark reviewed").onPress();
	await new Promise(setImmediate);
	tree = render();
	assert.equal(saves.length, 1);
	assert.equal(saves[0].input.expectedRevision, null);
	assert.deepEqual(saves[0].options, { context: { scope: "account-A" } });
	assert.deepEqual(saves[0].input.data.workAuthorization, [
		{ countryCode: "DE", authorized: "unknown", needsSponsorship: "unknown" },
	]);
	assert.equal(saves[0].input.data.requestedSalary, null);
	control("Currency").onChangeText("eur");
	tree = render();
	control("Requested amount").onChangeText("95000");
	tree = render();
	control("Pay period").onChange("year");
	tree = render();
	control("Given name").onChangeText("Corrected");
	tree = render();
	rejectSave = true;
	control("Save and mark reviewed").onPress();
	await new Promise(setImmediate);
	tree = render();
	assert.equal(saves[1].input.expectedRevision, "revision-1");
	assert.deepEqual(saves[1].input.data.requestedSalary, { amount: 95000, currency: "EUR", period: "year" });
	assert.equal(control("Given name").value, "Corrected");
	assert.ok(nodes(tree).some((node) => node.type === "Banner" && node.props.message.includes("Your draft is kept")));
	control("Export saved profile").onPress();
	await new Promise(setImmediate);
	scope = "account-B";
	releaseExport({ data: schema.applicationProfileDataSchema.parse({ givenName: "PRIVATE" }) });
	await new Promise(setImmediate);
	assert.equal(writes, 0);
	assert.equal(shares, 0);
});

test("mobile export cleanup removes account/profile and workspace exports, preserving unrelated files", () => {
	const deleted = [];
	class File {
		constructor(name) {
			this.name = name;
		}
		delete() {
			deleted.push(this.name);
		}
	}
	const { clearAccountExportCache } = load(new URL("../src/features/settings/export-cache.ts", import.meta.url), {
		"expo-file-system": {
			File,
			Paths: {
				cache: {
					list: () => [
						new File("application-profile-123.json"),
						new File("reactive-resume-456.json"),
						new File("workspace-reviewed-answers.json"),
						new File("workspace-interview-notes.md"),
						new File("resume.pdf"),
						{ name: "application-profile-789.json" },
					],
				},
			},
		},
	});
	clearAccountExportCache();
	assert.deepEqual(deleted, [
		"application-profile-123.json",
		"reactive-resume-456.json",
		"workspace-reviewed-answers.json",
		"workspace-interview-notes.md",
	]);
});

test("native account export stays bound to its account through fetch and file writing", async () => {
	for (const switchDuring of ["fetch", "write", null]) {
		let scope = "account-A";
		let mutation;
		let writes = 0;
		let deletes = 0;
		let shares = 0;
		const react = { createElement: () => null };
		const { ExportDataRow } = load(
			new URL("../src/features/settings/export.tsx", import.meta.url),
			{
				"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
				"@tanstack/react-query": {
					useMutation: (options) => {
						mutation = options.mutationFn;
						return {};
					},
				},
				"expo-file-system": {
					Paths: { cache: {} },
					File: class {
						async write() {
							writes++;
							if (switchDuring === "write") scope = "account-B";
						}
						delete() {
							deletes++;
						}
					},
				},
				"expo-sharing": {
					isAvailableAsync: async () => true,
					shareAsync: async () => shares++,
				},
				"./export-cache": { clearAccountExportCache() {} },
				"@/auth/session": { getAccountScope: () => scope },
				"@/api/client": {
					client: {
						auth: {
							exportData: async (_input, options) => {
								assert.deepEqual(options, { context: { scope: "account-A" } });
								if (switchDuring === "fetch") scope = "account-B";
								return { applicationProfile: { email: "private@example.test" } };
							},
						},
					},
				},
				"@/ui": { ListRow: "ListRow", showToast() {} },
			},
			react,
		);
		ExportDataRow();
		await mutation();
		assert.equal(writes, switchDuring === "fetch" ? 0 : 1);
		assert.equal(deletes, switchDuring === "write" ? 1 : 0);
		assert.equal(shares, switchDuring === null ? 1 : 0);
	}
});
