import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { i18n } from "@lingui/core";

const require = createRequire(new URL("../../server/package.json", import.meta.url));
const { buildSync, transformSync } = createRequire(require.resolve("tsx"))("esbuild");
i18n.loadAndActivate({ locale: "en-US", messages: {} });
function domain(path) {
	const code = buildSync({
		entryPoints: [new URL(path, import.meta.url).pathname],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
	}).outputFiles[0].text;
	const module = { exports: {} };
	new Function("require", "module", "exports", code)(require, module, module.exports);
	return module.exports;
}
const model = domain("../src/features/write/model.ts");
const { defaultResumeData } = domain("../../../packages/schema/src/resume/default.ts");

for (const via of ["inline options", "entry screen"]) {
	test(`native opened section keeps its Add action after final deletion via ${via}`, () => {
		const data = structuredClone(defaultResumeData);
		const entry = model.createEntry("experience");
		entry.position = "Fictional engineer";
		data.sections.experience.items = [entry];
		const before = JSON.stringify(data);
		let slots = [];
		let cursor = 0;
		const react = {
			createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
			useMemo: (make) => make(),
			useState(initial) {
				const index = cursor++;
				if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
				const owner = slots;
				return [
					owner[index],
					(next) => {
						owner[index] = typeof next === "function" ? next(owner[index]) : next;
					},
				];
			},
		};
		const tag = (parts, ...values) => parts.reduce((text, part, i) => text + part + (values[i] ?? ""), "");
		const ui = Object.fromEntries(
			["Banner", "Button", "Chip", "Icon", "IconButton", "ListRow", "Sheet", "SortableList", "Text"].map((name) => [
				name,
				name,
			]),
		);
		ui.useTheme = () => ({ space: { s2: 8, s3: 12, s4: 16 } });
		const boundary = {
			react,
			"react-native": { Pressable: "Pressable", View: "View" },
			"@lingui/core": { i18n },
			"@lingui/core/macro": {
				plural: (count, forms) => (count === 1 ? forms.one : forms.other).replace("#", String(count)),
			},
			"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
			"expo-image": { Image: "Image" },
			"expo-router": { useRouter: () => ({ push() {} }) },
			"@reactive-resume/utils/string": { getInitials: () => "FE" },
			"./entry-sheet": { EntrySheet: "EntrySheet" },
			"./fields": { ADD_LABELS: {}, SECTION_ICONS: {}, SECTION_TITLES: {} },
			"./hooks": {
				useWriteData: (select) => select(data),
				edit: (write) => write(data),
				addEntry() {},
				requestFocus() {},
			},
			"./model": model,
			"./picture-screen": { resolvePictureUrl: (url) => url },
			"./resume-language": { ResumeLanguage: "ResumeLanguage" },
			"./section-sheet": { SectionSheet: "SectionSheet" },
			"@/auth/session": { useSession: () => ({ server: "https://fictional.example.test" }) },
			"@/draft": { useIsResumeLocked: () => false },
			"@/features/write/unlock": { useUnlockResume: () => ({ unlock() {}, isPending: false }) },
			"@/routes": { routes: { entry: () => "/fictional-entry" } },
			"@/ui": ui,
		};
		const module = { exports: {} };
		const code = transformSync(readFileSync(new URL("../src/features/write/outline.tsx", import.meta.url), "utf8"), {
			loader: "tsx",
			format: "cjs",
			jsx: "transform",
		}).code;
		new Function("React", "require", "module", "exports", code)(
			react,
			(name) => {
				assert.ok(name in boundary, `Missing boundary: ${name}`);
				return boundary[name];
			},
			module,
			module.exports,
		);
		const { Outline } = module.exports;
		const nodes = (tree) =>
			!tree || typeof tree !== "object"
				? []
				: Array.isArray(tree)
					? tree.flatMap(nodes)
					: [tree, ...nodes(tree.props.children)];
		const render = () => {
			cursor = 0;
			return Outline({ resumeId: "fictional-resume" });
		};
		const list = () => nodes(render()).find((node) => node.type === "SortableList").props;
		const row = (kind) => {
			const current = list();
			const item = current.data.find(
				(item) => item.kind === kind && (kind === "section" ? item.row.id : item.sectionId) === "experience",
			);
			assert.ok(item, `Missing ${kind}`);
			return current.renderItem({ item, drag() {}, isActive: false });
		};
		row("section").props.onToggle();
		if (via === "entry screen") row("entry").props.onOpen();
		else {
			row("entry").props.onOptions();
			const sheet = nodes(render()).find((node) => node.type === "EntrySheet");
			assert.ok(sheet);
			// EntrySheet calls this existing lifecycle callback before deleting or moving the entry.
			sheet.props.onGone?.();
		}
		assert.equal(JSON.stringify(data), before, "opening and retaining a section never changes the resume");
		// The unchanged deletion owner supplies an empty section; exercise the actual Outline/model consumer.
		data.sections.experience.items = [];
		assert.ok(list().data.some((item) => item.kind === "section" && item.row.id === "experience"));
		assert.ok(list().data.some((item) => item.kind === "add" && item.sectionId === "experience"));
		assert.equal(data.sections.experience.items.length, 0, "retention must not create a fake entry");
		slots = [];
		assert.ok(
			!list().data.some((item) => item.kind === "section" && item.row.id === "experience"),
			"a new visit resets ephemeral retention",
		);
	});
}
