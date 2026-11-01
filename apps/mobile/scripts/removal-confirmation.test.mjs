import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const tag = (parts, ...values) => parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "");

for (const kind of ["domain", "web connection"]) {
	test(`${kind}: removal waits for confirmation, cancellation preserves connection`, async () => {
		let hooks = [];
		let cursor = 0;
		let removals = 0;
		const react = {
			createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
			useState: (initial) => {
				const index = cursor++;
				if (!(index in hooks)) hooks[index] = initial;
				return [
					hooks[index],
					(next) => {
						hooks[index] = next;
					},
				];
			},
			useRef: (initial) => react.useState({ current: initial })[0],
		};
		const endpoint = (name) => ({
			queryOptions: () => ({ name, queryKey: [name] }),
			queryKey: () => [name],
			key: () => [name],
			mutationOptions: () => ({ name }),
		});
		const domain = { hostname: "resume.example.test", verified: true, records: [] };
		const dependencies = {
			react,
			"react-native": { View: "View", Linking: {} },
			"expo-clipboard": {},
			"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
			"@lingui/core/macro": { t: tag },
			"@tanstack/react-query": {
				useQueryClient: () => ({ setQueryData() {}, async invalidateQueries() {} }),
				useQuery: ({ name }) => ({
					data:
						name === "get"
							? domain
							: name === "status"
								? { configured: true, canSave: true, managed: false, provider: "firecrawl" }
								: undefined,
					isSuccess: true,
					isPending: false,
				}),
				useMutation: ({ name }) => ({
					isPending: false,
					mutate: () => {
						if (name === "remove") removals++;
					},
				}),
			},
			"@reactive-resume/resume/sharing": {},
			"@/api/client": {
				client: {
					webAccess: {
						async delete() {
							removals++;
						},
					},
				},
				orpc: {
					customDomain: Object.fromEntries(
						["get", "suggestion", "set", "verify", "remove"].map((name) => [name, endpoint(name)]),
					),
					webAccess: { status: endpoint("status") },
				},
			},
			"@/auth/session": { useSession: () => ({ status: "signed-in", server: "https://local.example.test" }) },
			"./providers": { useHasAIProvider: () => ({ hasUsableProvider: true }) },
			"./error": { aiSettingsError: () => "Synthetic failure" },
			"@/ui": {
				...Object.fromEntries(
					[
						"Banner",
						"Button",
						"ConfirmDialog",
						"Card",
						"Icon",
						"ListGroup",
						"ListRow",
						"SelectSheet",
						"Sheet",
						"Skeleton",
						"Text",
						"TextField",
					].map((name) => [name, name]),
				),
				useTheme: () => ({ space: {} }),
			},
		};
		const path = kind === "domain" ? "share/custom-domain.tsx" : "ai/web-access.tsx";
		const code = transformSync(readFileSync(new URL(`../src/features/${path}`, import.meta.url), "utf8"), {
			loader: "tsx",
			format: "cjs",
			jsx: "transform",
		}).code;
		const module = { exports: {} };
		new Function("React", "require", "module", "exports", code)(
			react,
			(name) => {
				assert.ok(name in dependencies, `Missing boundary: ${name}`);
				return dependencies[name];
			},
			module,
			module.exports,
		);
		const render = () => {
			cursor = 0;
			return kind === "domain"
				? module.exports.CustomDomain({ offline: false, suggest: false })
				: module.exports.WebAccessSettings();
		};
		const nodes = (node) =>
			!node || typeof node !== "object" ? [] : [node, ...(node.props?.children ?? []).flat(Infinity).flatMap(nodes)];
		const find = (tree, type, predicate) => nodes(tree).find((node) => node.type === type && predicate(node.props));
		let tree = render();
		const remove = () =>
			find(tree, "Button", ({ label }) => label === (kind === "domain" ? "Remove" : "Remove connection"));
		remove().props.onPress();
		assert.equal(removals, 0);
		tree = render();
		let dialog = find(tree, "ConfirmDialog", ({ open }) => open);
		assert.ok(dialog);
		assert.equal(dialog.props.cancelLabel, kind === "domain" ? "Keep domain" : "Keep connection");
		assert.match(dialog.props.message, kind === "domain" ? /stop opening your primary resume/ : /enter the key again/);
		dialog.props.onCancel();
		tree = render();
		assert.equal(
			find(tree, "ConfirmDialog", ({ open }) => open),
			undefined,
		);
		assert.equal(removals, 0);
		remove().props.onPress();
		tree = render();
		dialog = find(tree, "ConfirmDialog", ({ open }) => open);
		dialog.props.onConfirm();
		await Promise.resolve();
		assert.equal(removals, 1);
	});
}
