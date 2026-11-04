import assert from "node:assert/strict";
import { test } from "node:test";
import { load, mobileRequire, tag } from "./harness.mjs";

const { ORPCError } = mobileRequire("@orpc/client");

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
			"@orpc/client": { ORPCError },
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
		const loaded = load(`../src/features/${path}`, dependencies, { jsx: "transform", globals: { React: react } });
		const render = () => {
			cursor = 0;
			return kind === "domain" ? loaded.CustomDomain({ offline: false, suggest: false }) : loaded.WebAccessSettings();
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
