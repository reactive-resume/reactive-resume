import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const serverRequire = createRequire(`${root}/apps/server/package.json`);
const { buildSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
const jsx = (type, props) => ({ type, props });
const tag = (parts, ...values) => parts.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
const nodes = (node) =>
	Array.isArray(node)
		? node.flatMap(nodes)
		: node && typeof node === "object"
			? [node, ...nodes(node.props?.children)]
			: [];
const posting = {
	sourceUrl: "https://jobs.example/role",
	jobDescription: "<script>untrusted posting</script>",
	postingSource: {
		method: "builtin",
		format: "text",
		retrievedAt: "2026-11-03T00:00:00Z",
		truncated: false,
		completeness: "unknown",
	},
};

function fixture() {
	const states = [];
	let cursor = 0;
	const effects = [];
	let scope = "owner";
	let document = { id: "resume", updatedAt: new Date(0) };
	let locked = false;
	const calls = [];
	const saved = [];
	let create = async () => "new-job";
	let link = async () => ({ ...document, applicationId: "new-job" });
	let flush = async () => document;
	let read = async () => ({ ...document, applicationId: null });
	const pending = new Map();
	const dependencies = {
		"react/jsx-runtime": { jsx, jsxs: jsx },
		react: {
			useState(value) {
				const i = cursor++;
				if (!(i in states)) states[i] = typeof value === "function" ? value() : value;
				return [
					states[i],
					(next) => {
						states[i] = typeof next === "function" ? next(states[i]) : next;
					},
				];
			},
			useRef(value) {
				const i = cursor++;
				return (states[i] ??= { current: value });
			},
			useEffect(work) {
				const i = cursor++;
				if (!(i in states)) {
					states[i] = true;
					effects.push(work());
				}
			},
		},
		"react-native": { View: "View" },
		"@lingui/react/macro": { useLingui: () => ({ t: tag }) },
		"@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: () => {} }) },
		"@reactive-resume/utils/string": {
			pendingRequestId: (key) => {
				if (!pending.has(key)) pending.set(key, `receipt-${pending.size}`);
				return pending.get(key);
			},
			settleRequestId: (key) => pending.delete(key),
		},
		"@/api/client": {
			SessionChangedError: class extends Error {},
			client: {
				resume: {
					getById: async (...args) => {
						calls.push(["read", ...args]);
						return read(...args);
					},
				},
				applications: {
					create: async (...args) => {
						calls.push(["create", ...args]);
						return create(...args);
					},
				},
				documents: {
					linkApplication: async (...args) => {
						calls.push(["link", ...args]);
						return link(...args);
					},
				},
			},
			orpc: { applications: { key: () => ["applications"] }, documents: { key: () => ["documents"] } },
		},
		"@/auth/session": { getAccountScope: () => scope },
		"@/draft": { useResumeStore: { getState: () => ({ document, locked }) } },
		"@/draft/runtime": {
			resume: {
				writeMetadata: async (work, options) => {
					calls.push(["metadata", options]);
					document = await work(document);
				},
			},
		},
		"@/features/share/document": {
			flushResume: async (id) => {
				calls.push(["flush", id]);
				return flush();
			},
		},
		"@/ui": { Button: "Button", Text: "Text", TextField: "TextField", useTheme: () => ({ space: {} }) },
	};
	const code = buildSync({
		entryPoints: [`${root}/apps/mobile/src/features/assistant/save-posting.tsx`],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
		jsx: "automatic",
		external: Object.keys(dependencies),
	}).outputFiles[0].text;
	const module = { exports: {} };
	new Function("require", "module", "exports", code)(
		(name) => {
			assert.ok(name in dependencies, name);
			return dependencies[name];
		},
		module,
		module.exports,
	);
	const render = () => {
		cursor = 0;
		return module.exports.SavePosting({
			posting,
			resumeId: "resume",
			disabled: false,
			onSaved: (value) => saved.push(value),
		});
	};
	const button = (label) => nodes(render()).find((node) => node.type === "Button" && node.props.label === label);
	const field = (label) => nodes(render()).find((node) => node.type === "TextField" && node.props.label === label);
	return {
		calls,
		saved,
		render,
		button,
		field,
		open() {
			button("Save as a job…").props.onPress();
		},
		fill() {
			field("Company").props.onChangeText("Fictional Labs");
			field("Role").props.onChangeText("Engineer");
		},
		setCreate: (value) => {
			create = value;
		},
		setRead: (value) => {
			read = value;
		},
		setLink: (value) => {
			link = value;
		},
		setFlush: (value) => {
			flush = value;
		},
		switchAccount: () => {
			scope = "other";
		},
		switchDocument: () => {
			document = { id: "other" };
		},
		lock: () => {
			locked = true;
		},
		unmount: () => effects.forEach((cleanup) => cleanup?.()),
	};
}
const settled = () => new Promise(setImmediate);

test("native confirms a committed link after its response is lost through an account-bound read", async () => {
	const f = fixture();
	f.setLink(async () => {
		throw new Error("response lost after commit");
	});
	f.setRead(async () => ({ id: "resume", updatedAt: new Date(1), applicationId: "new-job", isLocked: false }));
	f.open();
	f.fill();
	f.button("Save and link this resume").props.onPress();
	await settled();
	assert.equal(f.saved.length, 1);
	assert.equal(f.calls.filter(([kind]) => kind === "create").length, 1);
	assert.equal(f.calls.filter(([kind]) => kind === "link").length, 1);
	assert.deepEqual(f.calls.find(([kind]) => kind === "read")[2].context, { scope: "owner" });
	assert.deepEqual(f.calls.find(([kind]) => kind === "metadata")[1], { conditional: false });
});

test("native retry reconciles uncertain link before flushing newer edits, without a second write", async () => {
	const f = fixture();
	let reads = 0;
	f.setLink(async () => {
		throw new Error("lost response");
	});
	f.setRead(async () => {
		if (++reads === 1) throw new Error("readback unavailable");
		return { id: "resume", updatedAt: new Date(1), applicationId: "new-job", isLocked: false };
	});
	f.open();
	f.fill();
	f.button("Save and link this resume").props.onPress();
	await settled();
	assert.equal(f.saved.length, 0);
	f.setFlush(async () => {
		throw new Error("Old revision cannot flush newer edits");
	});
	f.button("Save and link this resume").props.onPress();
	await settled();
	assert.equal(f.saved.length, 1);
	assert.equal(f.calls.filter(([kind]) => kind === "flush").length, 1);
	assert.equal(f.calls.filter(([kind]) => kind === "create").length, 1);
	assert.equal(f.calls.filter(([kind]) => kind === "link").length, 1);
});

test("native retries conditional linking when pre-link readback is unavailable", async () => {
	const f = fixture();
	f.setLink(async () => {
		throw new Error("link unavailable");
	});
	f.setRead(async () => {
		throw new Error("readback unavailable");
	});
	f.open();
	f.fill();
	f.button("Save and link this resume").props.onPress();
	await settled();
	f.setLink(async () => ({ id: "resume", applicationId: "new-job", updatedAt: new Date(1) }));
	f.button("Save and link this resume").props.onPress();
	await settled();
	assert.equal(f.saved.length, 1);
	assert.equal(f.calls.filter(([kind]) => kind === "create").length, 1);
	const links = f.calls.filter(([kind]) => kind === "link");
	assert.equal(links.length, 2);
	assert.deepEqual(links[1][1], {
		type: "resume",
		id: "resume",
		applicationId: "new-job",
		expectedUpdatedAt: new Date(0),
	});
});

test("native failed retry readback cannot bypass account, document, lock, unmount or abort", async () => {
	for (const change of ["switchAccount", "switchDocument", "lock", "unmount", "abort"]) {
		const f = fixture();
		f.setLink(async () => {
			throw new Error("link unavailable");
		});
		f.setRead(async () => {
			throw new Error("readback unavailable");
		});
		f.open();
		f.fill();
		f.button("Save and link this resume").props.onPress();
		await settled();
		f.setRead(async () => {
			if (change !== "abort") f[change]();
			throw new DOMException("unavailable", change === "abort" ? "AbortError" : "NetworkError");
		});
		f.button("Save and link this resume").props.onPress();
		await settled();
		assert.equal(f.saved.length, 0, change);
		assert.equal(f.calls.filter(([kind]) => kind === "create").length, 1, change);
		assert.equal(f.calls.filter(([kind]) => kind === "link").length, 1, change);
	}
});

test("native never confirms mismatched, locked or account-switched readback", async () => {
	for (const change of ["application", "document", "locked", "account"]) {
		const f = fixture();
		f.setLink(async () => {
			throw new Error("link failed");
		});
		f.setRead(async () => {
			if (change === "account") f.switchAccount();
			return {
				id: change === "document" ? "other" : "resume",
				applicationId: change === "application" ? "other" : "new-job",
				isLocked: change === "locked",
			};
		});
		f.open();
		f.fill();
		f.button("Save and link this resume").props.onPress();
		await settled();
		assert.equal(f.saved.length, 0, change);
	}
});

test("native posting save requires confirmation, keeps snapshot, pins account and revision; double taps create once", async () => {
	const f = fixture();
	f.open();
	assert.equal(f.button("Save and link this resume").props.disabled, true);
	f.fill();
	f.button("Cancel").props.onPress();
	await settled();
	assert.deepEqual(f.calls, []);
	f.open();
	f.fill();
	const button = f.button("Save and link this resume");
	button.props.onPress();
	button.props.onPress();
	await settled();
	assert.equal(f.calls.filter(([kind]) => kind === "create").length, 1);
	const created = f.calls.find(([kind]) => kind === "create");
	assert.deepEqual(created[1], {
		...posting,
		company: "Fictional Labs",
		role: "Engineer",
		resumeId: "resume",
		newId: "receipt-0",
	});
	assert.deepEqual(created[2].context, { scope: "owner" });
	assert.deepEqual(f.calls.find(([kind]) => kind === "link")[1], {
		type: "resume",
		id: "resume",
		applicationId: "new-job",
		expectedUpdatedAt: new Date(0),
	});
	assert.deepEqual(f.saved, [{ id: "new-job", company: "Fictional Labs", role: "Engineer" }]);
});

test("native lost response retains receipt and failed link retries existing application without enabling context", async () => {
	const f = fixture();
	let attempts = 0;
	f.setCreate(async () => {
		if (++attempts === 1) throw new Error("lost response");
		return "new-job";
	});
	f.setLink(async () => {
		throw new Error("conflict");
	});
	f.open();
	f.fill();
	f.button("Save and link this resume").props.onPress();
	await settled();
	assert.deepEqual(f.saved, []);
	assert.equal(f.field("Company").props.editable, false);
	f.button("Save and link this resume").props.onPress();
	await settled();
	const creates = f.calls.filter(([kind]) => kind === "create");
	assert.deepEqual(creates[0][1], creates[1][1]);
	assert.deepEqual(f.saved, []);
	f.setLink(async () => ({ id: "resume", applicationId: "new-job" }));
	f.button("Save and link this resume").props.onPress();
	await settled();
	assert.equal(f.calls.filter(([kind]) => kind === "create").length, 2);
	assert.equal(f.saved.length, 1);
});

test("native account, draft, lock or unmount change after create prevents link and context handoff", async () => {
	for (const change of ["switchAccount", "switchDocument", "lock", "unmount"]) {
		const f = fixture();
		f.setCreate(async () => {
			f[change]();
			return "new-job";
		});
		f.open();
		f.fill();
		f.button("Save and link this resume").props.onPress();
		await settled();
		assert.equal(f.calls.filter(([kind]) => kind === "link").length, 0, change);
		assert.deepEqual(f.saved, [], change);
	}
});

test("native failed draft flush cannot create an application", async () => {
	const f = fixture();
	f.setFlush(async () => {
		throw new Error("draft conflict");
	});
	f.open();
	f.fill();
	f.button("Save and link this resume").props.onPress();
	await settled();
	assert.equal(f.calls.filter(([kind]) => kind === "create").length, 0);
	assert.deepEqual(f.saved, []);
});
